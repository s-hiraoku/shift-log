---
name: verify-shift-log
description: Drive the ShiftLog web UI (and its Bearer API) the way a user does — launch an isolated local pair, seed demo memories, exercise settings / allowlist / timeline / search, and capture proof. Use when verifying ShiftLog behavior, UI, or agent context_only responses.
---

# Verify ShiftLog

ShiftLog is a permission-based activity-memory app. A person uses the Next.js UI; cloud agents read the same memories over HTTP as `context_only` (no Computer Use). This skill drives the **web UI** as the primary surface and uses the API only as a second view of the same user-visible state.

Secondary surfaces (do not treat as the default drive target): desktop collector menu at `SHIFTLOG_CONTROL_PORT` (default `8791`), mobile collector stub, and the agent skill under `skills/shift-log/`.

Never drive `http://localhost:3000` or `http://localhost:8787` unless this run started them. Those are the documented user session ports.

## Launch

From the repo root, start an isolated API + web pair. The helper picks free ports near `18787` / `13000`, a disposable `SHIFTLOG_DATA_DIR`, and a unique Bearer token. It does **not** seed data.

```bash
STATE_FILE="$(.cursor/skills/verify-shift-log/helpers/launch.sh)"
# launch.sh also writes /tmp/shiftlog-verify-current → $STATE_FILE
# and prints: web=$WEB_ORIGIN  api=$SHIFTLOG_API_ORIGIN  evidence=$EVIDENCE_DIR
```

Ready when:

- API `GET $SHIFTLOG_API_ORIGIN/health` returns `{"ok":true,"service":"shift-log-api"}` (log line: `ShiftLog API listening on http://localhost:<port>`).
- Web `GET $WEB_ORIGIN/` contains `ShiftLog`.

`next dev` (16.3+) locks one process per `distDir` (`.next/dev/lock`). Launch sets `SHIFTLOG_NEXT_DIST_DIR=.next-verify-<run-id>` so an isolated web can run next to the documented user session on `:3000`. Cleanup deletes that directory only (never `apps/web/.next`).

Launch starts API/web in a new session so cleanup can `kill -- -$pid`. GNU `setsid` is **not** on macOS. `helpers/common.sh` `exec_in_new_session` uses `setsid` when present, otherwise `python3` + `os.setsid()` (EPERM ignored if the process is already a group leader — `pgid` still equals `$pid`). Do not call `setsid` as a bare command; a leftover launch on this Mac failed with `setsid: command not found`.

Env the helper sets (do not inherit `DATABASE_URL` or `SHIFTLOG_LLM_API_KEY`):

| Variable | Role |
| --- | --- |
| `SHIFTLOG_API_TOKEN` | Bearer for `/v1/*`. Fail-closed if unset in a real server. |
| `SHIFTLOG_API_ORIGIN` | Web BFF proxy target (`apps/web/app/api/[...path]/route.ts`). |
| `SHIFTLOG_DATA_DIR` | SQLite at `$SHIFTLOG_DATA_DIR/shiftlog.db`. |
| `PORT` | API listen port. |
| `SHIFTLOG_RATE_LIMIT_PER_MIN` | `300` for this instance so a drive does not 429 (product default is `60`). |

Launch also `unset`s `SHIFTLOG_LLM_API_KEY` so demo titles stay on the deterministic template.

Teardown is `helpers/cleanup.sh`. Two verification instances can run side by side if each has its own ports, data dir, and token. Do not point two webs at one API if either will mutate history.

`next dev` rewrites `apps/web/next-env.d.ts`. Next 16.3+ would also write `apps/web/AGENTS.md` / `CLAUDE.md`; this repo sets `agentRules: false` in `apps/web/next.config.ts`, so those files should not appear. Launch still snapshots `next-env.d.ts`; cleanup restores it and removes agent-rule files if a future Next version writes them. Do not commit those files from a verification run.

## Doctor

Run this first whenever anything looks off. It is read-only.

```bash
.cursor/skills/verify-shift-log/helpers/doctor.sh
```

Require all of:

- `API_PID` and `WEB_PID` still running.
- `/health` body includes `"service":"shift-log-api"`.
- `GET /v1/permissions` with the instance token returns JSON containing `enabled` and `memories_enabled`.
- `GET $WEB_ORIGIN/` contains `ShiftLog`.
- Ports are **not** `8787` / `3000` (shared user session).
- Chrome/Chromium binary exists (`node helpers/browser.mjs chrome-path` — macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
- Final line: `doctor: HEALTHY`.

If doctor fails, read `$STATE_DIR/logs/api.log` and `$STATE_DIR/logs/web.log`, then cleanup and relaunch. Do not continue.

## Drive

No Playwright/Cypress harness exists in this repo. Drive the UI through the skill-owned Chrome CDP helper (Linux `google-chrome` / Chromium, or the macOS Google Chrome app bundle, headless). Confirm mutations with a second user-facing read: either the next screen or `curl` against this instance's API.

```bash
B=.cursor/skills/verify-shift-log/helpers/browser.mjs
# Optional: node $B start
node $B goto /
node $B click --text "有効化してデモデータを投入"
node $B wait --text "準備完了"
node $B click --text "タイムラインへ"
node $B fill --placeholder "検索（タイトル・本文・アプリ）" --value "Code"
node $B click --text "検索"
node $B check --text "ShiftLog を有効化" --checked true
node $B snapshot --path "$EVIDENCE_DIR/page.txt"
node $B screenshot --path "$EVIDENCE_DIR/page.png"
```

API second view (same token/origin as the launched instance):

```bash
source /tmp/shiftlog-verify-current
curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/timeline"
curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/search?q=Code"
curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/permissions"
```

Stable handles observed in `apps/web` (Japanese UI, `lang=ja`):

| Control | Handle |
| --- | --- |
| Nav | links `ホーム` `/`, `設定` `/settings`, `許可リスト` `/permissions`, `タイムライン` `/timeline` |
| Home seed | button `有効化してデモデータを投入` (busy label `処理中…`; status `デモデータを投入中…`) |
| Home after seed | status `準備完了: windows=N, memories=N. タイムラインを開いてください。` |
| Home badges | `デフォルトオフ` → `収集オン` after both `enabled` and `memories_enabled`. Static `screenshots: off` and `keylog: forbidden` stay on home. |
| Home jumps | links `タイムラインへ`, `設定へ`. Settings has no `タイムラインへ` (use nav `タイムライン`). |
| Settings toggles | labels `ShiftLog を有効化`, `Memories 相当を有効化（必須）`, `一時停止（メニューバー / コントロールセンター相当）` |
| Settings save | button `保存` → status `保存しました` |
| Settings seed | button `デモデータを投入` → `デモ投入完了: windows=N, memories=N` |
| History delete | danger buttons `直近十分`, `一時間`, `一日`, `全部` → `削除完了: windows=N, memories=N` |
| Allowlist | labels `アプリモード`, `除外アプリ（1行1件）`, `許可のみアプリ（include_only 時）`, `タイトル非記録アプリ（1行1件）`, `サイトモード`, `除外サイト`, `許可のみサイト`; button `保存` → `許可リストを保存しました`. Load failure: error text + `再読み込み` (not `読み込み中…`) |
| Timeline search | `input[placeholder="検索（タイトル・本文・アプリ）"]` (no accessible name) + button `検索` (Enter also submits) |
| Timeline empty | `まだ記憶がありません。収集を有効化して窓をアップロードしてください。` (unseeded / blank search only) |
| Timeline search miss | `「{query}」に一致する記憶はありません。` |
| Memory row | link whose text is `front_matter.title` (demo titles like `Code / Chrome — 10分サマリ`) |
| Memory detail | heading = title; section `Markdown 記憶`; back link `← タイムライン` (loaded). Error-state link is `タイムラインへ戻る`. |

Collection is default-off. Home badge `収集オン` requires `enabled` and `memories_enabled` (pause does not change that badge). The product `canCollect` helper also requires `paused === false`. The home seed button POSTs `/v1/demo/seed` with `{enable:true}` through the same-origin BFF (`/api/...`); the Next route injects the Bearer token server-side.

Read `features/README.md` and the matching feature file before driving. Start from a freshly launched (unseeded) instance unless the file says otherwise.

## Evidence

Default location: `$EVIDENCE_DIR` from the state file (`/tmp/shiftlog-verify-evidence/<run-id>/`). Cleanup deletes `$STATE_DIR` only. **Never delete `$EVIDENCE_DIR`.**

Proof standards:

- Exercise the real user path (nav + the labeled button/link/checkbox). Do not call internal store setters. `/v1/demo/seed` is a documented user path (home/settings buttons and `pnpm seed`); prefer the **button**, use curl only as a second view or the CLI entry in a feature file.
- Capture the action and the resulting state (before + after), not only the final screen.
- Verify side effects: `GET /v1/timeline`, `GET /v1/permissions`, or reopen the screen. For search, a matching title must appear and a miss must not.
- Record `feature` id and entry point on every artifact (`proof.json` in the feature evidence folder).
- UI proof: page text snapshot **and** a screenshot that shows the `ShiftLog` brand in the top bar. Treat the text snapshot as authoritative for Japanese labels; headless Chrome may substitute fallback glyphs. `snapshot` writes `document.body.innerText` (which omits `<textarea>` values) plus a `--- form fields ---` block of labeled `textarea` / `select` / `input` values. Grep allowlist values in that block, or read `.value` via `eval`.
- API proof: request URL, status, and body (json file).
- Demo titles (deterministic template, no `SHIFTLOG_LLM_API_KEY`): `Code / Chrome — 10分サマリ`, `Terminal / Slack — 10分サマリ`, `Safari — 10分サマリ`. Window ids include timestamps, so a second seed adds more rows rather than replacing them.

## Cleanup

```bash
.cursor/skills/verify-shift-log/helpers/cleanup.sh
```

Stops only the process groups for `CHROME_PID`, `WEB_PID`, and `API_PID` from the state file (SIGTERM, then SIGKILL). Launch starts API/web in a new session (`setsid`, or Python `os.setsid` on macOS — see Launch) so children (`tsx watch`, `next dev`) die with the recorded PID. Removes `$STATE_DIR` (logs, SQLite, Chrome profile) and restores `apps/web/next-env.d.ts` plus any Next-generated `AGENTS.md` / `CLAUDE.md`. Leaves `$EVIDENCE_DIR`. After cleanup, confirm the evidence files still exist.

Do not `pkill -f next` / `pkill -f tsx` / kill-by-name.

## Helpers

All scripts are executable. `launch.sh` prints the state file path on stdout; other helpers read `SHIFTLOG_VERIFY_STATE`, then `SHIFTLOG_VERIFY_CURRENT` (default `/tmp/shiftlog-verify-current`). Set `SHIFTLOG_VERIFY_CURRENT` to a unique path when another verify run might own the default symlink. `browser.mjs` honors the same two variables.

| Command | What it does |
| --- | --- |
| `.cursor/skills/verify-shift-log/helpers/launch.sh` | Isolated API + web. No seed. Uses `exec_in_new_session` (not bare `setsid`). |
| `.cursor/skills/verify-shift-log/helpers/doctor.sh` | Read-only health + isolation + Chrome binary check. |
| `node .cursor/skills/verify-shift-log/helpers/browser.mjs chrome-path` | Print the Chrome/Chromium binary (no instance required). |
| `node .cursor/skills/verify-shift-log/helpers/browser.mjs <cmd>` | Chrome CDP: `start`, `goto`, `click --text`, `fill --placeholder --value`, `check --text --checked`, `wait --text`, `snapshot --path` (innerText plus `--- form fields ---`), `screenshot --path`, `eval --js`. |
| `.cursor/skills/verify-shift-log/helpers/prove-home-seed.sh` | One mapped feature: empty home → seed button → timeline titles + API proof. |
| `.cursor/skills/verify-shift-log/helpers/cleanup.sh` | Kill recorded PIDs; keep evidence. |

Chrome search order: `CHROME_PATH`, Linux `/usr/bin/google-chrome*`, then macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (then Chromium / Edge / Brave app bundles).

Feature map: `features/`. After the app changes, run `/maintain-verification-skill`.
