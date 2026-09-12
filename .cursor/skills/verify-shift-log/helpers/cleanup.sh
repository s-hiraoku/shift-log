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
  echo "cleanup: stopping $name pid $pid (process group)"
  # launch.sh starts each service with setsid, so -$pid is the group.
  if alive "$pid"; then
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  else
    kill -- "-$pid" 2>/dev/null || true
  fi
  local i
  for i in $(seq 1 25); do
    alive "$pid" || break
    sleep 0.2
  done
  if alive "$pid"; then
    echo "cleanup: $name pid $pid still alive; sending SIGKILL to group"
    kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
  fi
}

# Kill only PIDs recorded at launch / browser start — never by process name.
stop_pid chrome "${CHROME_PID:-}"
stop_pid web "${WEB_PID:-}"
stop_pid api "${API_PID:-}"

# Revert Next dest side effects in the repo (not evidence).
if [[ -n "${REPO_ROOT:-}" && -d "$REPO_ROOT/apps/web" ]]; then
  if [[ -n "${NEXT_ENV_BACKUP:-}" && -f "$NEXT_ENV_BACKUP" ]]; then
    cp "$NEXT_ENV_BACKUP" "$REPO_ROOT/apps/web/next-env.d.ts"
    echo "cleanup: restored apps/web/next-env.d.ts"
  fi
  if [[ "${WEB_AGENTS_EXISTED:-1}" == "0" && -f "$REPO_ROOT/apps/web/AGENTS.md" ]]; then
    if grep -q "BEGIN:nextjs-agent-rules" "$REPO_ROOT/apps/web/AGENTS.md"; then
      rm -f "$REPO_ROOT/apps/web/AGENTS.md"
      echo "cleanup: removed apps/web/AGENTS.md written by next dest"
    fi
  fi
  if [[ "${WEB_CLAUDE_EXISTED:-1}" == "0" && -f "$REPO_ROOT/apps/web/CLAUDE.md" ]]; then
    rm -f "$REPO_ROOT/apps/web/CLAUDE.md"
    echo "cleanup: removed apps/web/CLAUDE.md written by next dest"
  fi
fi

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
