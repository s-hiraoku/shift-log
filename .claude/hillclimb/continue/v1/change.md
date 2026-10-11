Split Japanese prompt keywords on hiragana instead of keeping whole script runs.

Train failures ja_spec, ja_review_schedule, ja_store_kana returned only recent memories: extractKeywords turned each Japanese prompt into one long token (e.g. 「六時間サマリの仕様書の続きを書きたい」) that no memory contains. Keeping katakana/kanji runs of 2+ chars yields words like 仕様書, 日程調整, テスト that do appear in memories.
