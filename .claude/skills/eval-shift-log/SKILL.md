---
name: eval-shift-log
description: Measure and improve ShiftLog with the committed evals — the ten-minute LLM summary and 「続きやって」 memory ranking — using programmatic graders and fixed train/test splits. Use before and after changing the summary prompt, SHIFTLOG_LLM_MODEL, or the continue endpoint's keyword/ranking code, when hill-climbing either, or when adding eval cases.
---

# ShiftLog evals and hill-climb

Two flows have an eval, each with its own directory under `.claude/hillclimb/`:

- `summarize`: the ten-minute LLM summary (costs money in `llm` mode; below)
- `continue`: which memories 「続きやって」 puts first (deterministic and free; see the last section)

The ten-minute summary (`services/api/src/jobs/llm.ts`, `buildPrompt`) is the only LLM call in ShiftLog. This eval runs each case through the production path (`sanitizeWindowUpload` → `summarizeTenMinuteWindow`) and grades the stored memory. For UI and API end-to-end checks use `verify-shift-log` instead; this skill is about the content of the summary.

| File | What |
| --- | --- |
| `services/api/eval/summarize/cases.ts` | 24 synthetic windows, tagged by kind (`tags[0]`), with human-written expectations and an `oracle` ideal reply |
| `services/api/eval/summarize/grade.ts` | atomic graders: `pass` = schema ∧ grounded ∧ private ∧ topical; plus entity recall, continuity, llm_used |
| `services/api/eval/summarize/run.ts` | runner; writes `.claude/hillclimb/summarize/<variant>/` |
| `services/api/eval/summarize/grade.test.ts` | proves the graders: every oracle passes, generic/invented/leaking replies fail |
| `.claude/hillclimb/summarize/_state.json` | fixed train/test split, metrics, goal, scope, off-limits |
| `.claude/hillclimb/summarize/metrics.md` | what each metric means and its known blind spots |

## Run it

From `services/api` (the cloud SessionStart hook has already installed deps):

```bash
pnpm run eval:summarize --mode oracle --out /tmp/ev-oracle   # harness check, expect pass 100%
pnpm run eval:summarize --mode null --out /tmp/ev-null       # harness check, expect pass 0%
pnpm run eval:summarize --mode fallback --out /tmp/ev-fb     # what is stored with no LLM key
pnpm run eval:summarize --mode llm --variant baseline --reps 2   # real endpoint, costs money
```

`--mode llm` uses `SHIFTLOG_LLM_API_KEY` / `SHIFTLOG_LLM_BASE_URL` / `SHIFTLOG_LLM_MODEL` exactly as the API does. Ask the user before any `llm` run: it bills their key. The runner sets `SHIFTLOG_PERSIST=0`, so it never touches their database. Endpoint failures, timeouts, and a served model that differs from the requested one go to `errors.jsonl`, never into the scores. Resume is per (case, rep): rerun the same command after a crash.

Render the report with the builder that ships with the `claude-api` skill (load it with `/claude-api` first so it is extracted), never a hand-written page:

```bash
R="<claude-api skill base directory>/shared/evals/report"
B="$R/build-report.mjs"; [ -f "$B" ] || B="$R/build-report-lite.mjs"
node "$B" .claude/hillclimb/summarize/
```

## Read the numbers honestly

- The test split is 10 cases. At 2 reps a pass-rate moves about ±22 points by noise alone (`1/sqrt(n·reps)`). A change smaller than that is not a result. To see smaller effects, add cases (keep the split stratified) or reps, then re-baseline.
- `entities` mostly measures the deterministic extractor in `jobs/entities.ts`, which runs with or without the LLM. Treat it as a guardrail.
- `continuity` is a cue-word check and only means something on `continuation` cases; elsewhere it is 1.
- If the baseline `pass` reaches ~95%, the eval is saturated: add harder cases before climbing further.

## Hill-climb the prompt

Goal and limits live in `_state.json`: raise `pass` on test while `grounded`, `private`, `schema`, `llm_used` do not drop. In scope: the `buildPrompt` text, the system message, and `SHIFTLOG_LLM_MODEL`. Off limits: everything under `services/api/eval/`, `sanitize.ts`, `entities.ts`, and the README privacy promises.

1. Run `--mode llm --variant baseline --reps 2` once and record the score.
2. Each round, read only the traces of `train_ids` (`baseline|vN/traces/<id>_rep<k>.json` for ids in `_state.json.train_ids`). Never open test traces while choosing a change.
3. Propose one change big enough to clear the noise floor (a new rule or a rewritten section, not a reworded line). Write the reason to `vN/change.md` and the diff to `vN/change.patch`.
4. Apply it to `llm.ts`, run `--mode llm --variant vN --reps 2`, then decide:
   - train and test both improve → keep
   - train improves, test flat → revert (overfitting)
   - either drops, or a guardrail metric drops → revert
5. After 2–3 flat rounds, sort remaining train failures by cause. If a case is ambiguous or a grader is wrong, say so to the user; fixing it is a harness change, needs their OK, and means re-running the baseline.

Never paste case text, failing outputs, or the `topics` words into the prompt, and never add rules that only fit one case. That raises the score without making real summaries better.

A cost goal works the same way: swap `SHIFTLOG_LLM_MODEL`, hold `pass` within noise, and compare `usage` per case.

`/claude-api hillclimb` and `/claude-api build-eval` are written for apps calling Claude through the Anthropic SDK; ShiftLog calls an OpenAI-compatible endpoint, so follow this skill. The directory layout and report builders are the same.

## Add cases

Good sources, in order: a summary someone complained about (an issue or bug report), then a hand-written window for a situation the set lacks. Write expectations by hand, never from a model's output. Never copy real windows: rewrite them as synthetic events with no personal data. After adding cases, add them to `train_ids` or `test_ids` (keep `tags[0]` balanced), run `pnpm -r run test` so `grade.test.ts` proves the new oracle passes, and re-run the baseline.

## 「続きやって」 ranking eval

`services/api/eval/continue/` sends 31 prompts through the real `POST /v1/agent/continue` (`createApp` + `app.request`) against the summarize cases stored as memories. Kinds (`tags[0]`): `topic_ja`, `topic_en`, `generic` (no topic: the newest memory should come first), `nomatch` (nothing should match by keyword).

```bash
pnpm run eval:continue --variant v<N>   # from services/api; no LLM, no cost, 1 rep
```

Metrics: `hit1` (headline), `recall3`, `kw_precision` (guardrail). In scope: `services/api/src/lib/continue-context.ts` and the keyword loop in `app.ts`. Off limits: the eval files, the response shape and `context_only`, and `listMemories` semantics shared with the timeline. The hill-climb rules above apply unchanged; `.claude/hillclimb/continue/narrative.md` holds the round table and `vN/change.md` the reason for each round. Test is 13/13 since v2, so add harder prompts (paraphrases that share no words with the memory) before another round.
