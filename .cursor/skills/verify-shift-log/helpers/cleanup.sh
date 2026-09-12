#!/usr/bin/env bash
# Stop processes this verification run started. Keeps evidence.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/common.sh"
load_state

stop_pid() {
  local name="$1"
  local pid="$2"
  if [[ -z "$pid" ]]; then
    echo "cleanup: $name pid unset (skip)"
    return
  fi
  if ! alive "$pid"; then
    echo "cleanup: $name pid $pid already gone"
    return
  fi
  echo "cleanup: stopping $name pid $pid"
  kill "$pid" 2>/dev/null || true
  local i
  for i in $(seq 1 25); do
    alive "$pid" || break
    sleep 0.2
  done
  if alive "$pid"; then
    echo "cleanup: $name pid $pid still alive; sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
  fi
}

# Kill only PIDs recorded at launch / browser start — never by process name.
stop_pid chrome "${CHROME_PID:-}"
stop_pid web "${WEB_PID:-}"
stop_pid api "${API_PID:-}"

if [[ -n "${STATE_DIR:-}" && -d "$STATE_DIR" ]]; then
  echo "cleanup: removing scratch $STATE_DIR"
  rm -rf "$STATE_DIR"
fi

if [[ -L "$CURRENT_LINK" ]]; then
  target="$(readlink "$CURRENT_LINK" || true)"
  if [[ "$target" == "${STATE_DIR:-}/state.env" || ! -e "$CURRENT_LINK" ]]; then
    rm -f "$CURRENT_LINK"
  fi
fi

echo "cleanup: evidence kept at ${EVIDENCE_DIR:-<unset>}"
if [[ -n "${EVIDENCE_DIR:-}" && -d "$EVIDENCE_DIR" ]]; then
  ls -la "$EVIDENCE_DIR" || true
else
  echo "cleanup: warning — evidence dir missing" >&2
fi
