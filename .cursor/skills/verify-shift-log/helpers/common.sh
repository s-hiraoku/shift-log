#!/usr/bin/env bash
# Shared paths and state loading for verify-shift-log helpers.
set -euo pipefail

HELPERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$HELPERS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
CURRENT_LINK="${SHIFTLOG_VERIFY_CURRENT:-/tmp/shiftlog-verify-current}"

die() {
  echo "verify-shift-log: $*" >&2
  exit 1
}

state_file() {
  if [[ -n "${SHIFTLOG_VERIFY_STATE:-}" ]]; then
    printf '%s\n' "$SHIFTLOG_VERIFY_STATE"
    return
  fi
  if [[ -L "$CURRENT_LINK" || -f "$CURRENT_LINK" ]]; then
    printf '%s\n' "$CURRENT_LINK"
    return
  fi
  die "no state file. Run helpers/launch.sh first, or set SHIFTLOG_VERIFY_STATE."
}

load_state() {
  local file
  file="$(state_file)"
  # shellcheck disable=SC1090
  set -a
  source "$file"
  set +a
  [[ -n "${WEB_ORIGIN:-}" && -n "${SHIFTLOG_API_ORIGIN:-}" ]] || die "state file $file is incomplete"
}

alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

port_in_use() {
  local port="$1"
  python3 - "$port" <<'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(("127.0.0.1", port))
except OSError:
    raise SystemExit(1)
finally:
    s.close()
raise SystemExit(0)
PY
}

pick_port() {
  local port="$1"
  local i
  for i in $(seq 0 40); do
    if ! port_in_use $((port + i)); then
      echo $((port + i))
      return
    fi
  done
  die "no free port near $port"
}

wait_http() {
  local url="$1"
  local needle="${2:-}"
  local timeout_s="${3:-45}"
  local started now body
  started="$(date +%s)"
  while true; do
    if body="$(curl -sS -m 2 "$url" 2>/dev/null)"; then
      if [[ -z "$needle" || "$body" == *"$needle"* ]]; then
        return 0
      fi
    fi
    now="$(date +%s)"
    if (( now - started >= timeout_s )); then
      die "timed out waiting for $url (need ${needle:-any HTTP body})"
    fi
    sleep 0.4
  done
}

shiftlog_api() {
  local method="$1"
  local path="$2"
  shift 2
  curl -sS -X "$method" \
    -H "Authorization: Bearer ${SHIFTLOG_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "${SHIFTLOG_API_ORIGIN}${path}" \
    "$@"
}
