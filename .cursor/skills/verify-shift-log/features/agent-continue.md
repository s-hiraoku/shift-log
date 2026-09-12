# Agent continue is context only

Agents ask ShiftLog to resume prior work. v1 returns memories and `mode: "context_only"`. It does not click, type, or otherwise operate the computer.

## Sub-features

- `continue-context` POSTs `/v1/agent/continue` and receives `mode: "context_only"` plus `memories`.
- `continue-echo` echoes the request `prompt`.
- `continue-keyword` uses `prompt` tokens against title/body/apps/`entities` and tags `matched_by`.
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

Exit 0. JSON has `mode` exactly `context_only`, `prompt` exactly `続きやって`, a `memories` array with the demo titles, each item `matched_by` `recent` or `keyword`, and a `note` that says context only / do not operate the computer.

- **Range miss.** After seed, GET `$SHIFTLOG_API_ORIGIN/v1/timeline?since=2099-01-01T00:00:00.000Z&until=2099-01-01T01:00:00.000Z`. `items` is `[]`. POST continue with the same `since` / `until` also returns `memories: []`.

- **Recent read.** Run `curl -sS "$SHIFTLOG_API_ORIGIN/v1/agent/recent?limit=12" -H "Authorization: Bearer $SHIFTLOG_API_TOKEN"`. `mode` is `context_only`. There is no `prompt` field. `memories` is a list.
- **Empty instance.** On an unseeded launch, POST continue. `mode` is still `context_only` and `memories` is `[]`. That is success, not a failed resume.
- **Unauthorized miss.** `curl -sS -o /tmp/unauth.json -w "%{http_code}" "$SHIFTLOG_API_ORIGIN/v1/agent/recent"` without a Bearer header is `401` and `{"error":"unauthorized"}`. Do not retry with the instance token and call that the unauth proof.
- **Proof.** Save both JSON bodies under `$EVIDENCE_DIR/agent-continue/`. Record feature id `agent-continue` and the entry (`POST /v1/agent/continue`). There is no screenshot for this path unless you also keep the timeline visible as supporting context.

## Gotchas

- `mode` must be the string `context_only`. Do not infer “read-only” from a 200 status alone.
- Continue never launches the desktop collector, never opens Chrome except the verification driver, and never POSTs `/v1/windows`. If those side effects appear, the proof failed.
- `limit` defaults in schema; passing `"limit":12` matches the bundled skill. Do not send a Computer Use payload — the route does not accept one.
- This feature has no UI entry. Do not report it verified by looking at the timeline page alone.
