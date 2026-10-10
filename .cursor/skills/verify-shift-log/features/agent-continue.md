# Agent continue is context only

Agents ask ShiftLog to resume prior work. v1 returns memories and `mode: "context_only"`. It does not click, type, or otherwise operate the computer.

## Sub-features

- `continue-context` POSTs `/v1/agent/continue` and receives `mode: "context_only"` plus `memories`.
- `continue-echo` echoes the request `prompt`.
- `continue-keyword` uses `prompt` tokens against title/body/apps/`entities` and tags `matched_by`.
- `continue-rank` lists every `matched_by: keyword` row before any `recent` row. More keyword hits come first; equal hit counts, and the recent tail, use newer `window_start` first.
- `continue-range` accepts `since` / `until` (ISO 8601) and drops rows whose `window_start` is outside that inclusive range. The same pair is on `/v1/timeline` and `/v1/search`.
- `recent-context` GETs `/v1/agent/recent` with the same `mode` and a read-only note.
- `continue-empty` still returns `context_only` when the timeline is empty (`memories: []`).

## How to get to it (user POV)

- In chat, ask 「続きやって」 / 「続きから」 — the bundled skill `skills/shift-log/SKILL.md` calls this API.
- From a terminal, POST `/v1/agent/continue` or GET `/v1/agent/recent` with the Bearer token.
- There is no web-UI button for continue.

## Driving it with the ShiftLog helpers

Preconditions:

- Doctor reports healthy isolated origins.
- For a non-empty body, seed first (`home-enable-and-seed`). For `continue-empty`, use a fresh unseeded launch.

- **Continue after seed.** Run:

```bash
curl -sS -X POST "$SHIFTLOG_API_ORIGIN/v1/agent/continue" \
  -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"続きやって","limit":12}'
```

Exit 0. JSON has `mode` exactly `context_only`, `prompt` exactly `続きやって`, and a `note` that says context only / do not operate the computer. `続き` / `やって` are stopwords, so this prompt has no keywords and tags every row `recent`. With no keywords the list is newest `window_start` first: `Safari — 10分サマリ`, `Terminal / Slack — 10分サマリ`, `Code / Chrome — 10分サマリ`.

- **Keyword.** POST the same URL with `{"prompt":"Safari","limit":12}`. The first memory is `Safari — 10分サマリ` with `matched_by` `keyword`. The other two stay `recent`, still newest first (`Terminal / Slack — 10分サマリ`, then `Code / Chrome — 10分サマリ`). This order also matches recency, because the keyword row is the newest demo window.

- **Rank.** POST the same URL with `{"prompt":"Slack","limit":12}`. Order is `Terminal / Slack — 10分サマリ` (`keyword`), then `Safari — 10分サマリ` (`recent`), then `Code / Chrome — 10分サマリ` (`recent`). Safari's `window_start` is newer than Terminal's, and it still comes second. That is the ranking a `Safari` prompt cannot show.
- **Rank by hit count.** POST `{"prompt":"Code Chrome","limit":12}`. `Code / Chrome — 10分サマリ` is first (`keyword`; it matches both tokens). `Terminal / Slack — 10分サマリ` is second (`keyword`; apps include `Code` only) even though that window is newer. `Safari — 10分サマリ` is last (`recent`). Prompt `Code` alone is the equal-count case: both keyword rows match once, so the newer one (`Terminal / Slack — 10分サマリ`) comes before `Code / Chrome — 10分サマリ`, and Safari stays last as `recent`.

- **Range miss.** After seed, GET `$SHIFTLOG_API_ORIGIN/v1/timeline?since=2099-01-01T00:00:00.000Z&until=2099-01-01T01:00:00.000Z`. `items` is `[]`. POST continue with the same `since` / `until` also returns `memories: []`.

- **Recent read.** Run `curl -sS "$SHIFTLOG_API_ORIGIN/v1/agent/recent?limit=12" -H "Authorization: Bearer $SHIFTLOG_API_TOKEN"`. `mode` is `context_only`. There is no `prompt` field. `memories` is a list.
- **Empty instance.** On an unseeded launch, POST continue. `mode` is still `context_only` and `memories` is `[]`. That is success, not a failed resume.
- **Unauthorized miss.** `curl -sS -o /tmp/unauth.json -w "%{http_code}" "$SHIFTLOG_API_ORIGIN/v1/agent/recent"` without a Bearer header is `401` and `{"error":"unauthorized"}`. Do not retry with the instance token and call that the unauth proof.
- **Proof.** Save both JSON bodies under `$EVIDENCE_DIR/agent-continue/`. Record feature id `agent-continue` and the entry (`POST /v1/agent/continue`). There is no screenshot for this path unless you also keep the timeline visible as supporting context.

## Gotchas

- `mode` must be the string `context_only`. Do not infer “read-only” from a 200 status alone.
- Prompt `Safari` does not prove ranking. Its only keyword row is also the newest demo window, so the list looks like recency. Prompt `Slack` matches the older `Terminal / Slack — 10分サマリ` row and still places it first.
- Continue never launches the desktop collector, never opens Chrome except the verification driver, and never POSTs `/v1/windows`. If those side effects appear, the proof failed.
- `limit` defaults in schema; passing `"limit":12` matches the bundled skill. Do not send a Computer Use payload — the route does not accept one.
- This feature has no UI entry. Do not report it verified by looking at the timeline page alone.
