---
name: eval-shift-log
description: Measure and improve ShiftLog's ten-minute LLM summary with the committed eval (24 cases, programmatic graders, fixed train/test split). Use before and after changing the summary prompt or SHIFTLOG_LLM_MODEL, when hill-climbing the prompt, or when adding eval cases.
---

# ShiftLog summary eval and hill-climb

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
