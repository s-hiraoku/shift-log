#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${SHIFTLOG_REPO_URL:-https://github.com/s-hiraoku/shift-log.git}"
SRC_DIR="${SHIFTLOG_SRC_DIR:-$HOME/.local/share/shiftlog/src}"
DATA_DIR="$(dirname "$SRC_DIR")"

die() {
  echo "shiftlog: $*" >&2
  exit 1
}

usage() {
  echo "usage: install.sh [install|update]" >&2
  exit 2
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing $1"
}

default_branch() {
  if ! git -C "$SRC_DIR" rev-parse --verify --quiet origin/HEAD >/dev/null; then
    git -C "$SRC_DIR" remote set-head origin --auto
  fi
  local ref
  ref="$(git -C "$SRC_DIR" rev-parse --abbrev-ref origin/HEAD)"
  echo "${ref#origin/}"
}

sync_tree() {
  git -C "$SRC_DIR" fetch origin
  local branch
  branch="$(default_branch)"
  git -C "$SRC_DIR" checkout "$branch"
  git -C "$SRC_DIR" reset --hard "origin/$branch"
}

ensure_src() {
  SRC_EXISTED=0
  if [[ -d "$SRC_DIR/.git" ]]; then
    SRC_EXISTED=1
    return
  fi
  if [[ -e "$SRC_DIR" ]]; then
    die "$SRC_DIR exists and is not a git checkout; leaving it untouched"
  fi
  mkdir -p "$DATA_DIR"
  git clone "$REPO_URL" "$SRC_DIR"
}

generate_token() {
  node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))'
}

ensure_env() {
  if [[ -f "$SRC_DIR/.env" ]]; then
    if grep -q '^SHIFTLOG_API_TOKEN=dev-token$' "$SRC_DIR/.env"; then
      echo "shiftlog: warning: $SRC_DIR/.env still uses the public placeholder token 'dev-token'; replace SHIFTLOG_API_TOKEN" >&2
    fi
    return
  fi
  if [[ ! -f "$SRC_DIR/.env.example" ]]; then
    return
  fi
  # .env.example の dev-token は公開値なので、そのまま配ると全インストールが同じ鍵になる
  local token
  token="$(generate_token)"
  (umask 077 && sed "s|^SHIFTLOG_API_TOKEN=.*$|SHIFTLOG_API_TOKEN=$token|" "$SRC_DIR/.env.example" > "$SRC_DIR/.env")
}

store_credentials() {
  # トークンは引数ではなく .env 経由で渡す（プロセス一覧と shell 履歴に出さない）
  pnpm --filter @shift-log/desktop credentials set
}

bootstrap() {
  cd "$SRC_DIR"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null || true
  fi
  require_cmd pnpm
  pnpm install
  pnpm --filter @shift-log/schema build
  ensure_env
  store_credentials
  pnpm setup:launchd
}

action="${1:-install}"
if [[ $# -gt 1 ]]; then
  usage
fi
case "$action" in
  install | update) ;;
  *) usage ;;
esac

require_cmd git
require_cmd node

ensure_src
if [[ "$action" == "update" || "$SRC_EXISTED" -eq 1 ]]; then
  sync_tree
fi

bootstrap

echo "shiftlog: source $SRC_DIR"
echo "shiftlog: data   $DATA_DIR"
