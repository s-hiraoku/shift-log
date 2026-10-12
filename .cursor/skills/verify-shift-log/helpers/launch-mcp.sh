#!/usr/bin/env bash
# Start the read-only ShiftLog MCP server against the isolated API from launch.sh.
# Prints the state file path. Does not seed data and does not bind port 8790.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
load_state

cd "$REPO_ROOT"

STATE_FILE="$STATE_DIR/state.env"
[[ -f "$STATE_FILE" ]] || die "state file missing at $STATE_FILE"

if [[ -n "${MCP_PID:-}" ]] && alive "$MCP_PID"; then
  echo "verify-shift-log: MCP already running pid=$MCP_PID origin=${SHIFTLOG_MCP_ORIGIN:-}" >&2
  echo "$STATE_FILE"
  exit 0
fi

MCP_PORT="${SHIFTLOG_VERIFY_MCP_PORT:-$(pick_port 18790)}"
case "$MCP_PORT" in
  8790|8787|8788|8765|8791)
    die "refusing MCP port $MCP_PORT (user default 8790 or a reserved port)"
    ;;
esac

MCP_TOKEN="$(openssl rand -hex 32)"
if [[ "${#MCP_TOKEN}" -lt 32 ]]; then
  die "generated SHIFTLOG_MCP_TOKEN is shorter than 32 characters"
fi
if [[ "$MCP_TOKEN" == "${SHIFTLOG_API_TOKEN}" ]]; then
  die "generated SHIFTLOG_MCP_TOKEN matches SHIFTLOG_API_TOKEN"
fi

if [[ ! -f packages/schema/dist/index.js ]]; then
  echo "verify-shift-log: building @shift-log/schema" >&2
  pnpm --filter @shift-log/schema build
fi
echo "verify-shift-log: building @shift-log/mcp" >&2
pnpm --filter @shift-log/mcp build

SHIFTLOG_MCP_ORIGIN="http://127.0.0.1:${MCP_PORT}"
mkdir -p "$STATE_DIR/logs"

echo "verify-shift-log: starting MCP on :$MCP_PORT -> $SHIFTLOG_API_ORIGIN" >&2
# Explicit env wins over .env (load-root-env only fills unset variables).
# --port keeps a parent SHIFTLOG_MCP_PORT=8790 from binding the user port.
exec_in_new_session env -u SHIFTLOG_LLM_API_KEY \
  SHIFTLOG_MCP_TOKEN="$MCP_TOKEN" \
  SHIFTLOG_API_TOKEN="$SHIFTLOG_API_TOKEN" \
  SHIFTLOG_API_ORIGIN="$SHIFTLOG_API_ORIGIN" \
  pnpm --filter @shift-log/mcp start -- --port "$MCP_PORT" \
  >"$STATE_DIR/logs/mcp.log" 2>&1 &
MCP_PID=$!

fail_mcp() {
  echo "verify-shift-log: $*" >&2
  echo "----- mcp.log -----" >&2
  cat "$STATE_DIR/logs/mcp.log" >&2 || true
  kill -- "-$MCP_PID" 2>/dev/null || kill "$MCP_PID" 2>/dev/null || true
  exit 1
}

if ! kill -0 "$MCP_PID" 2>/dev/null; then
  fail_mcp "MCP process $MCP_PID exited immediately"
fi

init_body='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"verify-shift-log","version":"0"}}}'
started="$(date +%s)"
while true; do
  code="$(curl -sS -m 2 -o /dev/null -w "%{http_code}" -X POST "${SHIFTLOG_MCP_ORIGIN}/mcp" \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -H "Authorization: Bearer ${MCP_TOKEN}" \
    -d "$init_body" || true)"
  if [[ "$code" == "200" ]]; then
    break
  fi
  if ! kill -0 "$MCP_PID" 2>/dev/null; then
    fail_mcp "MCP process $MCP_PID exited while waiting (last HTTP ${code:-none})"
  fi
  now="$(date +%s)"
  if (( now - started >= 45 )); then
    fail_mcp "timed out waiting for MCP initialize (last HTTP ${code:-none})"
  fi
  sleep 0.4
done

upsert() {
  local key="$1" value="$2" tmp
  tmp="$(mktemp)"
  grep -v "^${key}=" "$STATE_FILE" >"$tmp" || true
  printf '%s=%s\n' "$key" "$value" >>"$tmp"
  mv "$tmp" "$STATE_FILE"
}
upsert MCP_PORT "$MCP_PORT"
upsert MCP_PID "$MCP_PID"
upsert SHIFTLOG_MCP_TOKEN "$MCP_TOKEN"
upsert SHIFTLOG_MCP_ORIGIN "$SHIFTLOG_MCP_ORIGIN"

echo "$STATE_FILE"
echo "verify-shift-log: mcp ready  mcp=${SHIFTLOG_MCP_ORIGIN}/mcp  upstream=$SHIFTLOG_API_ORIGIN" >&2
