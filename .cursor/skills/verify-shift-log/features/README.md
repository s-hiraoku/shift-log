# ShiftLog verification map

This directory is the maintained source for verifying the user-facing behavior of ShiftLog. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-shift-log/helpers/launch.sh` (isolated ports, `SHIFTLOG_DATA_DIR`, Bearer token).
- Run `.cursor/skills/verify-shift-log/helpers/doctor.sh` and require `doctor: HEALTHY`.
- Start unseeded unless a feature file says otherwise. Fresh launch has `enabled: false`, `memories_enabled: false`, empty timeline.
- Put the helpers on your command path as written (`helpers/browser.mjs`, `source /tmp/shiftlog-verify-current`).
- Never drive `localhost:3000` / `localhost:8787` unless this run's state file owns those ports.
- Never drive an instance this run did not start.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer visible button/link/label text and the search `placeholder` over CSS or coordinates.
- Treat every command as literal. Keep Japanese labels unchanged.
- Run browser actions through `node helpers/browser.mjs`.
- Run API second-view reads with `Authorization: Bearer $SHIFTLOG_API_TOKEN` against `$SHIFTLOG_API_ORIGIN`.
- Restore or discard instance state via cleanup (new launch), not by sharing the user's `./data` directory.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes a text snapshot and a screenshot with the ShiftLog brand visible.
- Mutation proof includes a read-only second view (`/v1/timeline`, `/v1/permissions`, or reopen the page).
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the ShiftLog helpers` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Enable collection and seed demo memories](./home-enable-and-seed.md) covers the home (and settings) seed button, the off→on badge, and the first timeline rows.
- [Timeline, search, and memory detail](./timeline-and-search.md) covers empty state, title/body/app search, opening a memory, and the miss path.
- [Settings collection and history delete](./settings-collection.md) covers the three collection checkboxes, save, and irreversible history delete.
- [App and site allowlist](./allowlist.md) covers exclude/include modes and persisting the lists.
- [Agent continue is context only](./agent-continue.md) covers `/v1/agent/continue` and `/v1/agent/recent` returning `mode: context_only` without acting.
