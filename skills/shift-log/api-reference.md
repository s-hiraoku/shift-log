# ShiftLog API reference (v1)

Base URL: `$SHIFTLOG_API_ORIGIN` (local default `http://localhost:8787`)

All `/v1/*` routes require:

```http
Authorization: Bearer <SHIFTLOG_API_TOKEN>
```

## Health

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | no | Liveness |

## Permissions

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| GET | `/v1/permissions` | — | Current config |
| PUT | `/v1/permissions` | `PermissionsConfig` JSON | Collection stays off until `enabled` and `memories_enabled` are true |

## Windows & memories

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| POST | `/v1/windows` | `WindowUpload` | Rejects if collection disabled (403) or capture older than 48h (410). Sanitizes private browsing + `keyText` |
| GET | `/v1/timeline` | `q?`, `limit?`, `cursor?` | Memory list |
| GET | `/v1/search` | `q`, `limit?` | Keyword search over title/description/body/apps |
| GET | `/v1/memories/:id` | — | Single memory |
| POST | `/v1/history/delete` | `{ "scope": "last_10_minutes"\|"last_hour"\|"last_day"\|"all" }` | Deletes overlapping windows **and** memories |

## Agent (read-only)

| Method | Path | Body / query | Notes |
| --- | --- | --- | --- |
| GET | `/v1/agent/recent` | `limit?` (max 36) | `{ mode: "context_only", memories, note }` |
| POST | `/v1/agent/continue` | `{ "prompt"?: string, "limit"?: number }` | Same mode; echoes `prompt` |

**Invariant:** agent endpoints never execute Computer Use.

## Demo (local MVP)

| Method | Path | Body | Notes |
| --- | --- | --- | --- |
| POST | `/v1/demo/seed` | `{ "enable"?: boolean }` | Enables collection (default) and seeds sample windows/memories |

## Minimal continue example (JS)

```js
const origin = process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787";
const token = process.env.SHIFTLOG_API_TOKEN ?? "dev-token";

const res = await fetch(`${origin}/v1/agent/continue`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ prompt: "続きやって", limit: 12 }),
});
const data = await res.json();
// data.mode === "context_only"
// use data.memories as working memory; do not control the OS
```
