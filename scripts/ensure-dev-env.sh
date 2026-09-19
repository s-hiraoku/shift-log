#!/usr/bin/env bash
# Idempotent local / Cloud Agent bootstrap: create .env from the example
# (never overwrite) and the SQLite data directory.
set -euo pipefail

ROOT="${SHIFTLOG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    echo "ensure-dev-env: missing .env.example in $ROOT" >&2
    exit 1
  fi
  cp .env.example .env
  echo "ensure-dev-env: created .env from .env.example"
else
  echo "ensure-dev-env: .env already present"
fi

mkdir -p "$ROOT/data"
echo "ensure-dev-env: data dir $ROOT/data"
