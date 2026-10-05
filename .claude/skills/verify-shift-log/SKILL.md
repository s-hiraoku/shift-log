---
name: verify-shift-log
description: Verify ShiftLog behavior in a Claude Code session (cloud or local) — launch an isolated API + web pair, drive the Japanese web UI with headless Chromium, seed demo memories, and capture proof. Use when checking a ShiftLog change, UI, or agent context_only response end to end.
---

# Verify ShiftLog (Claude Code)

The maintained skill lives at [`.cursor/skills/verify-shift-log/SKILL.md`](../../../.cursor/skills/verify-shift-log/SKILL.md). Read it, then the feature map in `.cursor/skills/verify-shift-log/features/`, before driving the app. This file only adds what differs in Claude Code. Do not copy the helpers here; run them from `.cursor/`.

## Cloud session prerequisites

`.claude/hooks/session-start.sh` runs on every cloud session start (`CLAUDE_CODE_REMOTE=true`):

- installs the `packageManager` pnpm with `npm install -g` when the global one differs (not `corepack enable`: Node 22's corepack cannot run pnpm 12, and its shim replaces a working pnpm),
- `pnpm install --frozen-lockfile` and `pnpm --filter @shift-log/schema build`,
- `scripts/ensure-dev-env.sh` (creates `.env` from `.env.example`, never overwrites),
- exports `CHROME_PATH=/opt/pw-browsers/chromium`. Cloud containers have Playwright's Chromium, not `google-chrome`, so `browser.mjs chrome-path` finds nothing without it.

If `CHROME_PATH` is unset in your shell (hook skipped, local Linux), export it before `doctor.sh`.

## Fast checks (same as CI)

```bash
pnpm -r run test
node --test scripts/*.test.mjs
pnpm typecheck
```

`pnpm lint` passes, but in `apps/web` it is only a typecheck: `next lint` no longer exists in Next 16 and the script falls back to `tsc`.

To measure the content of the LLM summary rather than the UI, use the `eval-shift-log` skill.

## End-to-end run

```bash
H=.cursor/skills/verify-shift-log/helpers
STATE_FILE="$($H/launch.sh)"          # isolated ports near 18787 / 13000, no seed
$H/doctor.sh                          # require: doctor: HEALTHY
$H/prove-home-seed.sh                 # empty home → seed button → 3 timeline titles
# other features: follow features/<id>.md with `node $H/browser.mjs ...`
$H/cleanup.sh                         # keeps $EVIDENCE_DIR
```

Evidence lands in `/tmp/shiftlog-verify-evidence/<run-id>/`. Read the PNG screenshots with the Read tool to check the page visually; the text snapshot is authoritative for Japanese labels. To hand screenshots to a person, copy them somewhere they can open first; `/tmp` is not visible to them.

Run each Bash call from the repo root. `launch.sh` backgrounds API and web in their own sessions, so they survive between tool calls; always finish with `cleanup.sh`, and never `pkill` by name.
