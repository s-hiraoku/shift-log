#!/usr/bin/env bash
# Read-only: is this verification instance worth driving?
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
load_state

fail=0
ok() { echo "ok  $*"; }
bad() { echo "FAIL $*"; fail=1; }

if alive "${API_PID:-}"; then
  ok "API_PID $API_PID is running"
else
  bad "API_PID ${API_PID:-unset} is not running"
fi

if alive "${WEB_PID:-}"; then
  ok "WEB_PID $WEB_PID is running"
else
  bad "WEB_PID ${WEB_PID:-unset} is not running"
fi

health="$(curl -sS -m 3 "${SHIFTLOG_API_ORIGIN}/health" || true)"
if [[ "$health" == *'"ok":true'* && "$health" == *'"service":"shift-log-api"'* ]]; then
  ok "API /health $health"
else
  bad "API /health unexpected: ${health:-<empty>}"
fi

perms="$(shiftlog_api GET /v1/permissions || true)"
if [[ "$perms" == *'"enabled"'* && "$perms" == *'"memories_enabled"'* ]]; then
  ok "API auth valid; /v1/permissions returned config"
else
  bad "API /v1/permissions failed (auth or process): ${perms:-<empty>}"
fi

home="$(curl -sS -m 5 "${WEB_ORIGIN}/" || true)"
if [[ "$home" == *ShiftLog* ]]; then
  ok "web ${WEB_ORIGIN}/ contains ShiftLog"
else
  bad "web ${WEB_ORIGIN}/ did not contain ShiftLog"
fi

if [[ -d "${SHIFTLOG_DATA_DIR:-}" ]]; then
  ok "data dir $SHIFTLOG_DATA_DIR"
else
  bad "data dir missing: ${SHIFTLOG_DATA_DIR:-unset}"
fi

# Refuse to claim ownership of the user's default session ports unless we started them.
if [[ "${API_PORT}" == "8787" || "${WEB_PORT}" == "3000" ]]; then
  bad "instance uses default ports (API 8787 / web 3000). Do not drive a shared user session."
else
  ok "isolated ports api=$API_PORT web=$WEB_PORT"
fi

echo "---"
echo "RUN_ID=$RUN_ID"
echo "WEB_ORIGIN=$WEB_ORIGIN"
echo "SHIFTLOG_API_ORIGIN=$SHIFTLOG_API_ORIGIN"
echo "SHIFTLOG_DATA_DIR=$SHIFTLOG_DATA_DIR"
echo "EVIDENCE_DIR=$EVIDENCE_DIR"
echo "permissions=$perms"

if (( fail )); then
  echo "doctor: UNHEALTHY" >&2
  exit 1
fi
echo "doctor: HEALTHY"
