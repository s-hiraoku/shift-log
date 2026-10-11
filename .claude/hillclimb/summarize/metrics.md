# Ten-minute summary metrics

All graders are programmatic (`services/api/eval/summarize/grade.ts`) and read the stored memory: title, description (the LLM summary when one was used), body, and entities.

| Metric | Passes when | Blind spot |
| --- | --- | --- |
| **pass** (headline) | schema ∧ grounded ∧ private ∧ topical | does not judge prose quality |
| topical | title or summary contains one of the case's `topics` words | a correct paraphrase with none of the words fails |
| grounded | no known app name, URL, or entity absent from the sanitized window (or the previous memory) | only knows the app names listed in `grade.ts` |
| private | none of the case's `forbidden` strings, and no claim of screenshots, keystrokes, or private browsing | only the listed strings and claim words |
| schema | the record validates and the title is 1–120 chars | — |
| entity recall | share of the case's expected entities present | mostly measures the deterministic extractor |
| continuity | with a previous memory, a continuation cue appears exactly when the work continues | cue words only; 1 on non-continuation cases |
| llm used | the memory carries the LLM summary (`## 要約`) | 0 in fallback mode by design |

Harness checks (`grade.test.ts`, and `--mode oracle` / `--mode null`): every hand-written oracle reply passes all metrics; a generic reply fails `topical`; an invented app, URL, or entity fails `grounded`; a sanitizer leak or a screenshot claim fails `private`; missing or false continuation cues fail `continuity`.

Fallback baseline (no LLM key), 2026-10-05: pass 29.2% (7/24), topical 29.2%, every other guardrail 100%, llm used 0%.

Not measured yet: whether the summary describes the work well, and whether `unfinished` is grounded. Both need an LLM judge with a rubric of checkable claims, calibrated against a few human-graded cases.
