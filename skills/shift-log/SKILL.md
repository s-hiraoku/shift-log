---
name: shift-log
description: >-
  Use ShiftLog as read-only working memory for cloud agents. Fetch recent
  activity memories, search the timeline, and handle "続きやって" / continue
  requests as context_only (never Computer Use). Use when the user asks to
  continue prior work, restore session context, search past activity, or
  integrate with ShiftLog / Computer History-compatible memory.
---

# ShiftLog Agent Skill

ShiftLog stores permission-based activity memories (Markdown) so agents can resume work. **v1 is observation + memory only** — never operate the user's computer from this skill.

## When to use

- User says 「続きやって」「続きから」「さっきの作業」など
- Need recent desk/mobile activity context before answering
- Search past memories by app / keyword
- Wire another agent to ShiftLog's agent API

## When not to use

- User wants you to click/type/control their machine → refuse; ShiftLog does not do Computer Use
- Collection is off / no token → tell them to enable in Settings or set `SHIFTLOG_API_TOKEN`
- Screenshots, keylogs, private-browsing content → never request or invent these

## Setup

```bash
# API (default)
export SHIFTLOG_API_ORIGIN="${SHIFTLOG_API_ORIGIN:-http://localhost:8787}"
export SHIFTLOG_API_TOKEN="${SHIFTLOG_API_TOKEN:-dev-token}"
```

Auth: `Authorization: Bearer $SHIFTLOG_API_TOKEN` on every `/v1/*` call.

## Core workflow: continue as context_only

1. Call continue (or recent).
2. Read `mode: "context_only"` and the `memories[]` list.
3. Summarize / continue the *task in chat* using that context.
4. **Do not** launch tools that control the OS/browser unless the user separately and explicitly approves a different capability.

```bash
curl -sS -X POST "$SHIFTLOG_API_ORIGIN/v1/agent/continue" \
  -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"続きやって","limit":12}'
```

Equivalent recent read:

```bash
curl -sS "$SHIFTLOG_API_ORIGIN/v1/agent/recent?limit=12" \
  -H "Authorization: Bearer $SHIFTLOG_API_TOKEN"
```

### Response contract

| Field | Meaning |
| --- | --- |
| `mode` | Always `context_only` in v1 |
| `memories` | Markdown memory records (front_matter + body) |
| `note` | Reminder: read-only; no Computer Use |
| `prompt` | Echo of continue prompt (continue endpoint only) |

Each memory `front_matter` typically has: `title`, `description`, `apps`, `device` (`desk` \| `mobile` \| `both`), `window_start`, `window_end`, `kind` (`ten_minute` \| `six_hour`), optional `skill_candidate`.

## Search / timeline

```bash
# Timeline
curl -sS "$SHIFTLOG_API_ORIGIN/v1/timeline?limit=20" \
  -H "Authorization: Bearer $SHIFTLOG_API_TOKEN"

# Search
curl -sS "$SHIFTLOG_API_ORIGIN/v1/search?q=Code&limit=20" \
  -H "Authorization: Bearer $SHIFTLOG_API_TOKEN"

# One memory
curl -sS "$SHIFTLOG_API_ORIGIN/v1/memories/<id>" \
  -H "Authorization: Bearer $SHIFTLOG_API_TOKEN"
```

## Privacy rules (hard constraints)

- Default-off collection; requires `enabled` + `memories_enabled`
- No screenshots, screen recording, mic, system audio, or full keylogs
- Private browsing permanently excluded
- Raw events expire 48h after **capture** `window_end`; memories remain until user deletes
- History delete removes matching windows **and** memories (`last_10_minutes` \| `last_hour` \| `last_day` \| `all`)

## Optional: local MVP seed

If the timeline is empty during local demo:

```bash
curl -sS -X POST "$SHIFTLOG_API_ORIGIN/v1/demo/seed" \
  -H "Authorization: Bearer $SHIFTLOG_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enable":true}'
```

## Agent checklist

- [ ] Authenticated with Bearer token
- [ ] Used `/v1/agent/continue` or `/v1/agent/recent` for resume
- [ ] Treated output as **context only**
- [ ] Did not claim to control the user's computer via ShiftLog
- [ ] Surfaced `skill_candidate` memories as hints only (SkillCheck is out of scope for v1)

## More detail

See [api-reference.md](api-reference.md) for the full v1 route table.
