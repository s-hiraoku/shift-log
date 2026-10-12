# Read-only MCP server

External agents read ShiftLog memories over a loopback Streamable HTTP MCP server. The server exposes five read-only tools and does not write permissions, windows, or history. Inbound Bearer is `SHIFTLOG_MCP_TOKEN`, which is a different value from `SHIFTLOG_API_TOKEN`.

## Sub-features

- `mcp-unauthorized` rejects a missing bearer with HTTP 401 and `{"error":"unauthorized"}`.
- `mcp-api-token-rejected` rejects the API token presented as the MCP bearer with the same 401.
- `mcp-list-tools` lists exactly `continue_context`, `get_memory`, `recent_memories`, `search_memories`, and `timeline`, each with `readOnlyHint: true`.
- `mcp-recent` calls `recent_memories` and returns `mode: "context_only"` plus memories.
- `mcp-search` calls `search_memories`. `q` matches title, description, body, apps, and `entities[].value` (not entity kind). A miss returns no items.
- `mcp-get-memory` calls `get_memory` with an id from search and returns that memory.
- `mcp-continue` calls `continue_context` and returns `mode: "context_only"`. Keyword rows come before newer non-matches, same as `/v1/agent/continue`.

## How to get to it (user POV)

- An external agent connects to `http://127.0.0.1:8790/mcp` with `Authorization: Bearer $SHIFTLOG_MCP_TOKEN`. The operator starts it with `pnpm --filter @shift-log/schema build`, `pnpm --filter @shift-log/mcp build`, and `pnpm --filter @shift-log/mcp start`.
- There is no web-UI button for MCP. Do not treat the timeline page as this feature.
- On macOS, `pnpm setup:launchd` registers LaunchAgent `com.shiftlog.mcp` only when `.env` contains `SHIFTLOG_MCP_TOKEN`. The plist does not embed the token. Removing that line and running setup again unloads the agent.

## Driving it with the ShiftLog helpers

Preconditions:

- Doctor reports healthy isolated origins for the API and web.
- Demo memories are present for search and continue (`home-enable-and-seed`). `mcp-unauthorized` does not need them.
- `helpers/launch-mcp.sh` has been run against this instance. It binds a free port near `18790`, not the user's `8790`.
- Re-run doctor after launch-mcp. It checks `MCP_PID` and a Bearer initialize only when that pid is in the state file.

- **Start MCP.** Run `.cursor/skills/verify-shift-log/helpers/launch-mcp.sh`. Stdout is the state file. Stderr includes `mcp ready` and `mcp=http://127.0.0.1:<port>/mcp`. `source` the state file again so `SHIFTLOG_MCP_TOKEN` and `SHIFTLOG_MCP_ORIGIN` are set.
- **Missing bearer.** Run `node .cursor/skills/verify-shift-log/helpers/mcp.mjs unauthorized`. Exit 0. JSON is `{"status":401,"body":{"error":"unauthorized"}}`.
- **API token rejected.** Run `node .cursor/skills/verify-shift-log/helpers/mcp.mjs api-token`. Exit 0 and the same 401 body. The helper sends `Authorization: Bearer $SHIFTLOG_API_TOKEN` to the MCP URL.
- **List tools.** Run `node .cursor/skills/verify-shift-log/helpers/mcp.mjs list`. The names sort to `continue_context`, `get_memory`, `recent_memories`, `search_memories`, `timeline`. Every `readOnlyHint` is `true`. Descriptions for `search_memories`, `timeline`, and `continue_context` name title, description, body, apps, and `entities[].value`.
- **Recent.** Run `node .cursor/skills/verify-shift-log/helpers/mcp.mjs call recent_memories '{"limit":12}'`. `mode` is `context_only`. After a demo seed the memories include the three `10分サマリ` titles.
- **Search hit and description.** Run `node .cursor/skills/verify-shift-log/helpers/mcp.mjs call search_memories '{"q":"Code"}'`. Items include `Code / Chrome — 10分サマリ` and `Terminal / Slack — 10分サマリ`, and omit `Safari — 10分サマリ`. Then `call search_memories '{"q":"events across"}'`. All three demo rows return, because that phrase is only in `front_matter.description`. This demo seed stores no entity values, so do not expect an entity-only hit.
- **Search miss.** Run `call search_memories '{"q":"volcano"}'`. `items` is `[]`.
- **Get one memory.** Take `id` from the Code search result and run `call get_memory '{"id":"<id>"}'`. `front_matter.title` is `Code / Chrome — 10分サマリ`.
- **Continue rank.** Run `call continue_context '{"prompt":"Slack","limit":12}'`. `mode` is `context_only`, `prompt` is `Slack`, the first memory is `Terminal / Slack — 10分サマリ` with `matched_by` `keyword`, and `Safari — 10分サマリ` is later with `matched_by` `recent`.
- **LaunchAgent (do not drive on Linux).** `com.shiftlog.mcp` needs macOS `launchctl` and a user LaunchAgents directory. This recipe does not run `pnpm setup:launchd`. On Linux that entry is unreachable: unmet prerequisite is macOS. Do not report it verified.
- **Proof.** Save the 401 JSON, the tool list, and the search / get / continue JSON under `$EVIDENCE_DIR/mcp-read-only/`. Feature id `mcp-read-only`. Entry is `POST $SHIFTLOG_MCP_ORIGIN/mcp` with the MCP bearer. There is no screenshot for this path.

## Gotchas

- `SHIFTLOG_MCP_TOKEN` is not `SHIFTLOG_API_TOKEN`. The MCP process uses the API token only when it calls the API. Presenting the API token to MCP is a 401, not a successful read.
- The MCP token must be at least 32 characters and must not be `dev-token`. `launch-mcp.sh` generates 64 hex characters.
- The server binds `127.0.0.1` only. Verification uses a port near `18790`. Port `8790` is the user's default MCP. Do not drive a listener this run did not start.
- `launch.sh` does not start MCP. A doctor run before `launch-mcp.sh` stays healthy without `MCP_PID`. After `launch-mcp.sh`, doctor requires that process and initialize HTTP 200.
- `.env` does not override variables the helper already exported. A parent `SHIFTLOG_MCP_PORT=8790` must not win: the helper passes `--port`.
- There is no MCP tool for `POST /v1/windows`, `PUT /v1/permissions`, `POST /v1/history/delete`, or `POST /v1/demo/seed`. Do not invent one.
- `search_memories` requires `q`. Entity kind is not part of the haystack.
- `continue_context` does not take a `mode` argument. `mode` is only in the response.
- Cleanup stops `MCP_PID` when the state file has one. It does not unload `com.shiftlog.mcp`, because this helper never registers it.
