# Settings collection and history delete

Settings is where a user turns ShiftLog on or off, pauses collection, and permanently deletes history. Capture badges on this page stay off (`screenshots`, `screen_recording`, `microphone`, `system_audio`, `full_keylog`).

## Sub-features

- `settings-load` shows the three collection checkboxes from the current permissions.
- `settings-save` persists checkbox changes via `保存` and status `保存しました`.
- `settings-pause` sets `paused` without clearing `enabled` / `memories_enabled`.
- `settings-delete-all` removes every window and memory through `全部`.
- `settings-privacy-badges` keep showing capture off and `private_browsing: permanently excluded`.

## How to get to it (user POV)

- Choose nav `設定` or the home link `設定へ`.
- Toggle `ShiftLog を有効化`, `Memories 相当を有効化（必須）`, or `一時停止（メニューバー / コントロールセンター相当）`, then `保存`.
- Under `履歴削除`, choose `直近十分`, `一時間`, `一日`, or `全部`.

## Driving it with the ShiftLog helpers

Preconditions:

- Doctor reports healthy isolated origins.
- For delete proof, seed first (`home-enable-and-seed` or Settings `デモデータを投入`) so there is something to remove.

- **Open settings.** Run `node helpers/browser.mjs goto /settings`. Wait for heading `設定` (not `読み込み中…`). Privacy badges `screenshots: off` and `private_browsing: permanently excluded` are visible.
- **Enable both flags.** Run `node helpers/browser.mjs check --text "ShiftLog を有効化" --checked true` and `check --text "Memories 相当を有効化（必須）" --checked true`. Run `click --text "保存"`. Wait for `保存しました`.
- **Confirm save.** Run `curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/permissions"`. `enabled` and `memories_enabled` are `true`. Reload `/` and expect badge `収集オン`.
- **Pause.** Return to `/settings`. Run `check --text "一時停止（メニューバー / コントロールセンター相当）" --checked true` and `click --text "保存"`. Permissions show `paused: true` while the two enable flags stay true. Home badge stays `収集オン` (ready is enable+memories, not pause).
- **Unpause.** `check --text "一時停止（メニューバー / コントロールセンター相当）" --checked false` and `保存`. `paused` is `false`.
- **Delete all.** After a seed, on `/settings` run `click --text "全部"`. Status is `削除完了: windows=N, memories=N` with N ≥ 1. `GET /v1/timeline` is `{"items":[],"next_cursor":null}`. `/timeline` shows `まだ記憶がありません。収集を有効化して窓をアップロードしてください。`
- **Proof.** Screenshot of Settings after save (badges + `保存しました`) and the timeline empty state after `全部`, plus the permissions/timeline JSON. Feature id `settings-collection`.

## Gotchas

- Checkbox labels wrap a `<span class="row">`. Click the label text via `check --text`, not coordinates.
- `保存` and `デモデータを投入` are both unlabeled `button`s. Match on exact visible text.
- History delete is immediate and has no confirm dialog. Prefer `全部` on a disposable instance. `直近十分` / `一時間` / `一日` only remove memories whose `window_start` falls in that window — demo rows from 12–40 minutes ago may survive `直近十分`.
- Enabling collection without `Memories 相当を有効化（必須）` still shows `デフォルトオフ` on home.
- Do not treat the static `screenshots: off` badges as proof that a toggle saved; they never change.
