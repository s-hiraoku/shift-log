#!/usr/bin/env bash
# Claude Code cloud session bootstrap: deps, schema build, .env, and a Chrome
# path for the verify-shift-log helpers. Idempotent; local sessions skip it.
set -euo pipefail

if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Use the pnpm pinned in packageManager (pnpm 9 skips optional native bindings
# and breaks tests). Not `corepack enable`: Node 22's corepack cannot run pnpm 12
# and its shim replaces a working global pnpm.
want="$(node -p "require('./package.json').packageManager.split('@')[1]")"
if [[ "$(pnpm -v 2>/dev/null || true)" != "$want" ]]; then
  npm install -g "pnpm@$want"
  hash -r
fi

pnpm install --frozen-lockfile
pnpm --filter @shift-log/schema build
scripts/ensure-dev-env.sh

# Cloud containers ship Playwright's Chromium, not google-chrome.
if [[ -z "${CHROME_PATH:-}" && -x /opt/pw-browsers/chromium && -n "${CLAUDE_ENV_FILE:-}" ]]; then
  echo 'export CHROME_PATH=/opt/pw-browsers/chromium' >>"$CLAUDE_ENV_FILE"
fi
