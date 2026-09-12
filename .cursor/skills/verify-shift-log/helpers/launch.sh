#!/usr/bin/env bash
# Start an isolated ShiftLog API + web pair for verification.
# Prints the state file path. Does not seed data.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"

cd "$REPO_ROOT"

if [[ ! -f packages/schema/dist/index.js ]]; then
  echo "verify-shift-log: building @shift-log/schema" >&2
  pnpm --filter @shift-log/schema build
fi

RUN_ID="${SHIFTLOG_VERIFY_RUN_ID:-$(date +%Y%m%dT%H%M%S)-$$}"
STATE_DIR="${SHIFTLOG_VERIFY_STATE_DIR:-/tmp/shiftlog-verify-${RUN_ID}}"
EVIDENCE_DIR="${SHIFTLOG_VERIFY_EVIDENCE_DIR:-/tmp/shiftlog-verify-evidence/${RUN_ID}}"
TOKEN="${SHIFTLOG_VERIFY_TOKEN:-verify-${RUN_ID}}"
API_PORT="${SHIFTLOG_VERIFY_API_PORT:-$(pick_port 18787)}"
WEB_PORT="${SHIFTLOG_VERIFY_WEB_PORT:-$(pick_port 13000)}"
CDP_PORT="${SHIFTLOG_VERIFY_CDP_PORT:-$(pick_port 19222)}"
WEB_ORIGIN="http://127.0.0.1:${WEB_PORT}"

mkdir -p "$STATE_DIR/data" "$EVIDENCE_DIR" "$STATE_DIR/logs"

# next dev (16.3) rewrites apps/web/next-env.d.ts and may add AGENTS.md / CLAUDE.md.
# Snapshot so cleanup can restore the repo tree. Do not commit those files.
NEXT_ENV_FILE="$REPO_ROOT/apps/web/next-env.d.ts"
WEB_AGENTS_EXISTED=0
WEB_CLAUDE_EXISTED=0
[[ -f "$REPO_ROOT/apps/web/AGENTS.md" ]] && WEB_AGENTS_EXISTED=1
[[ -f "$REPO_ROOT/apps/web/CLAUDE.md" ]] && WEB_CLAUDE_EXISTED=1
if [[ -f "$NEXT_ENV_FILE" ]]; then
  cp "$NEXT_ENV_FILE" "$STATE_DIR/next-env.d.ts.bak"
fi

# Isolation: never inherit a shared Postgres URL or the repo ./data directory.
unset DATABASE_URL VITEST
export SHIFTLOG_PERSIST=1
export SHIFTLOG_DATA_DIR="$STATE_DIR/data"
export SHIFTLOG_API_TOKEN="$TOKEN"
export SHIFTLOG_API_ORIGIN="http://127.0.0.1:${API_PORT}"
export SHIFTLOG_RATE_LIMIT_PER_MIN="${SHIFTLOG_RATE_LIMIT_PER_MIN:-300}"
export PORT="$API_PORT"
export SHIFTLOG_CORS_ORIGINS="http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}"

echo "verify-shift-log: starting API on :$API_PORT (data=$SHIFTLOG_DATA_DIR)" >&2
setsid env -u DATABASE_URL -u VITEST \
  PORT="$API_PORT" \
  SHIFTLOG_API_TOKEN="$TOKEN" \
  SHIFTLOG_DATA_DIR="$SHIFTLOG_DATA_DIR" \
  SHIFTLOG_RATE_LIMIT_PER_MIN="$SHIFTLOG_RATE_LIMIT_PER_MIN" \
  SHIFTLOG_CORS_ORIGINS="$SHIFTLOG_CORS_ORIGINS" \
  pnpm --filter @shift-log/api dev \
  >"$STATE_DIR/logs/api.log" 2>&1 &
API_PID=$!

echo "verify-shift-log: starting web on :$WEB_PORT -> $SHIFTLOG_API_ORIGIN" >&2
setsid env \
  NEXT_TELEMETRY_DISABLED=1 \
  SHIFTLOG_API_ORIGIN="$SHIFTLOG_API_ORIGIN" \
  SHIFTLOG_API_TOKEN="$TOKEN" \
  pnpm --filter @shift-log/web exec next dev --port "$WEB_PORT" --hostname 127.0.0.1 \
  >"$STATE_DIR/logs/web.log" 2>&1 &
WEB_PID=$!

STATE_FILE="$STATE_DIR/state.env"
cat >"$STATE_FILE" <<EOF
RUN_ID=$RUN_ID
STATE_DIR=$STATE_DIR
EVIDENCE_DIR=$EVIDENCE_DIR
REPO_ROOT=$REPO_ROOT
SKILL_DIR=$SKILL_DIR
API_PORT=$API_PORT
WEB_PORT=$WEB_PORT
CDP_PORT=$CDP_PORT
API_PID=$API_PID
WEB_PID=$WEB_PID
CHROME_PID=
SHIFTLOG_API_TOKEN=$TOKEN
SHIFTLOG_API_ORIGIN=http://127.0.0.1:${API_PORT}
SHIFTLOG_DATA_DIR=$STATE_DIR/data
WEB_ORIGIN=$WEB_ORIGIN
WEB_AGENTS_EXISTED=$WEB_AGENTS_EXISTED
WEB_CLAUDE_EXISTED=$WEB_CLAUDE_EXISTED
NEXT_ENV_BACKUP=$STATE_DIR/next-env.d.ts.bak
EOF

ln -sfn "$STATE_FILE" "$CURRENT_LINK"

cleanup_failed_launch() {
  echo "verify-shift-log: launch failed; stopping groups $API_PID $WEB_PID" >&2
  kill -- "-$API_PID" "-$WEB_PID" 2>/dev/null || kill "$API_PID" "$WEB_PID" 2>/dev/null || true
  wait "$API_PID" "$WEB_PID" 2>/dev/null || true
}
trap cleanup_failed_launch ERR

if ! kill -0 "$API_PID" 2>/dev/null; then
  echo "----- api.log -----" >&2
  cat "$STATE_DIR/logs/api.log" >&2 || true
  die "API process $API_PID exited immediately"
fi
if ! kill -0 "$WEB_PID" 2>/dev/null; then
  echo "----- web.log -----" >&2
  cat "$STATE_DIR/logs/web.log" >&2 || true
  die "web process $WEB_PID exited immediately"
fi

wait_http "http://127.0.0.1:${API_PORT}/health" '"service":"shift-log-api"' 45
wait_http "http://127.0.0.1:${WEB_PORT}/" "ShiftLog" 60
trap - ERR

echo "$STATE_FILE"
echo "verify-shift-log: ready  web=$WEB_ORIGIN  api=$SHIFTLOG_API_ORIGIN  evidence=$EVIDENCE_DIR" >&2
