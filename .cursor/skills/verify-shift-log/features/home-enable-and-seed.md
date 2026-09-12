# Enable collection and seed demo memories

The home card lets a user turn collection on and insert three sample 10-minute memories so the timeline is not empty. Settings offers the same seed without leaving the settings page.

## Sub-features

- `home-off` shows `デフォルトオフ` when either `enabled` or `memories_enabled` is false.
- `home-seed` clicks `有効化してデモデータを投入` and waits for `準備完了`.
- `home-on` shows `収集オン` after a successful seed.
- `home-timeline` follows `タイムラインへ` and lists the three demo titles.
- `settings-seed` runs the same seed from Settings via `デモデータを投入`.

## How to get to it (user POV)

- Open `/` (nav `ホーム`) and choose `有効化してデモデータを投入`.
- Open `/settings` (nav `設定`) and choose `デモデータを投入`.
- From a terminal: `pnpm seed` (POST `/v1/demo/seed` with `{enable:true}`).

## Driving it with the ShiftLog helpers

Preconditions:

- Doctor reports healthy isolated origins.
- Timeline is empty (`まだ記憶がありません` on `/timeline`, or `GET /v1/timeline` → `{"items":[]}`).
- Home badge reads `デフォルトオフ`.

- **Open home.** Run `node helpers/browser.mjs goto /`. Heading `ShiftLog` and button `有効化してデモデータを投入` are visible. Badge is `デフォルトオフ`.
- **Capture empty API.** Run `curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/timeline"`. Body is `{"items":[],"next_cursor":null}`.
- **Seed from home.** Run `node helpers/browser.mjs click --text "有効化してデモデータを投入"`. Button may briefly read `処理中…`. Status includes `準備完了:` and `windows=` / `memories=`. Badge becomes `収集オン`.
- **Open timeline.** Run `node helpers/browser.mjs click --text "タイムラインへ"`. Heading `タイムライン` appears. The list includes `Code / Chrome — 10分サマリ`, `Terminal / Slack — 10分サマリ`, and `Safari — 10分サマリ`.
- **Confirm persistence.** Run `curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/timeline"` and `.../v1/permissions`. Timeline has at least three items with those titles. Permissions have `enabled: true`, `memories_enabled: true`, `paused: false`.
- **Settings entry (separate launch or accept extra rows).** Go to `/settings`, run `node helpers/browser.mjs click --text "デモデータを投入"`, wait for `デモ投入完了`. A second seed adds more windows; it does not replace the first three.
- **CLI entry.** Run `curl -sS -X POST -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" -H "Content-Type: application/json" -d '{"enable":true}' "$SHIFTLOG_API_ORIGIN/v1/demo/seed"`. Exit 0, JSON has `ok: true` and `permissions_enabled: true`. Do not count this as the home-button proof.
- **Proof.** Write snapshots/screenshots of home-after-seed and timeline-after-seed plus `proof.json` with the feature id `home-enable-and-seed` and entry `home button 有効化してデモデータを投入`. `helpers/prove-home-seed.sh` is the scripted form of this recipe.

## Gotchas

- Busy label `処理中…` disables the home button until the request finishes. Wait for `準備完了`, not a fixed sleep.
- `収集オン` requires both collection flags. Toggling only `ShiftLog を有効化` on Settings leaves the home badge off.
- Demo window ids embed timestamps. Re-seeding creates additional memories; assert “at least these titles”, not an exact count of 3, unless the instance was empty.
- Titles come from the deterministic summarizer (`Code / Chrome — 10分サマリ`). If `SHIFTLOG_LLM_API_KEY` is set on the API process, titles may differ — this verification launch unsets that path by not exporting the key.
- `pnpm seed` / curl is a documented CLI path. It is not a substitute for the home-button entry when the feature under test is the button.
