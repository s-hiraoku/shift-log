Also keep the katakana and kanji parts of a Japanese run that mixes scripts.

Train failure ja_store_kana (the only remaining train miss) matched nothing: 「テスト直し」 split on hiragana leaves 「テスト直」, which no memory contains, while 「テスト」 does. Emitting the single-script parts as extra keywords (テスト直 → テスト, 六時間サマリ → 六時間, サマリ) keeps the whole run and lets the match-count ranking from v2 reward memories that share more parts.

Reverted: hit@1 flat on train (94.4%) and test (100%); only train recall@3 rose (94.4% → 100%). Train-only gains are treated as overfitting, so this change is not kept.
