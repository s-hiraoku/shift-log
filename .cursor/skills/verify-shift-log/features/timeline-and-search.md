# Timeline, search, and memory detail

Timeline lists Markdown memories newest-first. Search filters by title, body, or app name. Opening a row shows the full Markdown memory.

## Sub-features

- `timeline-empty` shows the empty copy when no memories exist.
- `timeline-list` shows title, `kind`, `device`, description, and window bounds for each memory.
- `search-match` keeps matching rows (title, body, or app) and drops the rest.
- `search-miss` yields the empty copy for a query that matches nothing.
- `memory-open` opens `/memories/:id` from the title link and shows `Markdown 記憶`.

## How to get to it (user POV)

- Choose nav `タイムライン` or the home/settings link `タイムラインへ`.
- Type in the search field and press Enter or choose `検索`.
- Choose a memory title link.

## Driving it with the ShiftLog helpers

Preconditions:

- Doctor reports healthy isolated origins.
- Demo memories are present (run `home-enable-and-seed` first, or this recipe's seed step).
- Search box is the input whose placeholder is `検索（タイトル・本文・アプリ）`.

- **Empty state (unseeded instance only).** Run `node helpers/browser.mjs goto /timeline`. The list reads `まだ記憶がありません。収集を有効化して窓をアップロードしてください。`
- **Seed if needed.** If the list is empty, complete `home-enable-and-seed` and return to `/timeline`.
- **List.** Run `node helpers/browser.mjs goto /timeline` and `wait --text "10分サマリ"`. Rows show badges `ten_minute` and `desk` / `both` / `mobile`.
- **Title/app match.** Run `node helpers/browser.mjs fill --placeholder "検索（タイトル・本文・アプリ）" --value "Code"` then `click --text "検索"`. Wait until `Code / Chrome — 10分サマリ` is visible and `Safari — 10分サマリ` is not. Second view: `curl -sS -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" "$SHIFTLOG_API_ORIGIN/v1/search?q=Code"` — every `items[].front_matter.apps` or title/body contains `Code`.
- **Body match.** Replace the query with `pnpm test` (demo dual-window summary includes `Ran pnpm test`). Run `fill --placeholder "検索（タイトル・本文・アプリ）" --value "pnpm test"` and `click --text "検索"`. `Terminal / Slack — 10分サマリ` remains.
- **Miss.** Run `fill --placeholder "検索（タイトル・本文・アプリ）" --value "volcano"` and `click --text "検索"`. The list shows `まだ記憶がありません。収集を有効化して窓をアップロードしてください。` API `q=volcano` returns `"items":[]`.
- **Open detail.** Clear back to a match, then `click --text "Code / Chrome — 10分サマリ"`. Heading is that title. Section `Markdown 記憶` contains `## Focus span` and a line mentioning `Code`. Back link `← タイムライン` returns to `/timeline`.
- **Proof.** Snapshot + screenshot of the `Code` search results, plus the search JSON. Record feature id `timeline-and-search` and the entry used (`検索` button vs Enter).

## Gotchas

- The search input has a placeholder and no accessible name. `click --text` will not find it; use `--placeholder`.
- Search runs only on `検索` or Enter, not on each keystroke. Filling without submitting leaves the previous list on screen.
- Empty search (`q` blank) loads `/v1/timeline`, not `/v1/search`.
- The empty-list sentence is reused for “no search hits”. Do not treat it as “unseeded” unless `/v1/timeline` is also empty.
- React controlled inputs ignore a raw `.value =` assignment. The helper uses the native value setter; do not replace it with a naive DOM write.
- Memory ids look like `mem_demo_desk_<iso>`. Do not hard-code an id from a previous run.
