# Timeline, search, and memory detail

Timeline lists Markdown memories newest-first. Search filters by title, the description shown on each row, body, app name, and entity values. Opening a row shows the full Markdown memory.

## Sub-features

- `timeline-empty` shows the empty copy when no memories exist.
- `timeline-list` shows title, `kind`, `device`, description, and window bounds for each memory.
- `search-match` keeps rows whose title, description, body, app name, or entity value contains the query, and drops the rest.
- `search-miss` shows `「{query}」に一致する記憶はありません。` for a query that matches nothing.
- `memory-open` opens `/memories/:id` from the title link and shows `Markdown 記憶`.

## How to get to it (user POV)

- Choose nav `タイムライン` or the home link `タイムラインへ`. Settings has no `タイムラインへ` link.
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
- **Description match.** Fill `events across` and choose `検索`. The demo rows stay. Each row's description is `N events across M apps`, and that phrase is not in the title, body, or app names. API `q=events%20across` returns those items with `front_matter.description` containing `events across`. This demo seed stores no entity values, so do not expect an entity-only hit; entity values are searched the same way when a memory has them.
- **Miss.** Run `fill --placeholder "検索（タイトル・本文・アプリ）" --value "volcano"` and `click --text "検索"`. The list shows `「volcano」に一致する記憶はありません。` API `q=volcano` returns `"items":[]`.
- **Open detail.** Clear back to a match, then `click --text "Code / Chrome — 10分サマリ"`. Heading is that title. Section `Markdown 記憶` contains `## Focus span` and a line mentioning `Code`. Demo Code / Terminal YAML includes `projects: ["shift-log"]`. Loaded-state back link `← タイムライン` returns to `/timeline`. The fetch-error card uses `タイムラインへ戻る` instead — do not wait for that string on a successful open.
- **Proof.** Snapshot + screenshot of the `Code` search results, plus the search JSON. Record feature id `timeline-and-search` and the entry used (`検索` button vs Enter).

## Gotchas

- The search input has a placeholder and no accessible name. `click --text` will not find it; use `--placeholder`.
- Search runs only on `検索` or Enter, not on each keystroke. Filling without submitting leaves the previous list on screen.
- A query can match `front_matter.description` or an entity value even when the title, body, and app names do not contain it. Demo descriptions look like `3 events across 2 apps`.
- Empty search (`q` blank) loads `/v1/timeline`, not `/v1/search`.
- A search miss is not the unseeded empty copy. Wait for `に一致する記憶はありません` (or the quoted query) before treating the list as empty-of-hits.
- React controlled inputs ignore a raw `.value =` assignment. The helper uses the native value setter; do not replace it with a naive DOM write.
- Memory ids look like `mem_demo_desk_<iso>`. Do not hard-code an id from a previous run.
- A successful detail page shows `← タイムライン`. `タイムラインへ戻る` appears only on the fetch-error card.
