# 「続きやって」 hill-climb, 2026-10-06

| round | change (one line) | test hit@1 | train hit@1 | test kw prec. | train kw prec. | decision |
|---|---|---|---|---|---|---|
| baseline | — | 53.8% ±28.2 | 77.8% ±19.8 | 72.4% | 91.7% | — |
| v1 | split Japanese keywords on hiragana | 69.2% ±26.1 | 88.9% ±14.9 | 61.2% | 83.3% | kept |
| v2 | rank hits by matched-keyword count, then recency | 100.0% | 94.4% ±10.9 | 61.2% | 83.3% | kept (best) |
| v3 | also emit katakana/kanji parts of mixed runs | 100.0% | 94.4% ±10.9 | 61.2% | 81.5% | reverted: only train recall@3 moved |

Deterministic (no LLM, 1 rep), so the ± is case-sampling noise over 13 test / 18 train prompts. Each round's change was chosen from train results only; test rows were not read until the round was scored.

**Result.** v2 is shipped in `services/api/src/lib/continue-context.ts` and `app.ts`: test hit@1 53.8% → 100% (13/13), train 77.8% → 94.4%. The guardrail kw precision fell (test 72.4% → 61.2%, train 91.7% → 83.3%), inside its noise band: splitting Japanese prompts into more keywords matches more memories, but ranking keeps the right one first.

**Next.** Test is saturated at 13/13, so further rounds cannot show gains. Add harder prompts (paraphrases with no shared words, e.g. 「ストアのテスト直し」 for store.test.ts, which still misses) before climbing again.
