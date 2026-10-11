import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "@shift-log/schema";
import { extractKeywords, rankKeywordHits } from "./continue-context.js";

function memory(id: string, windowStart: string): MemoryRecord {
  return {
    id,
    created_at: windowStart,
    updated_at: windowStart,
    front_matter: {
      title: id,
      description: "",
      apps: [],
      device: "desk",
      window_start: windowStart,
      window_end: windowStart,
      kind: "ten_minute",
      window_ids: [],
      skill_candidate: false,
    },
    body: "",
  };
}

describe("extractKeywords", () => {
  it("splits Japanese prompts on hiragana", () => {
    expect(extractKeywords("六時間サマリの仕様書の続きを書きたい")).toEqual(["六時間サマリ", "仕様書"]);
    expect(extractKeywords("デザインレビューの日程調整の続き")).toEqual(["デザインレビュー", "日程調整"]);
  });

  it("keeps ASCII tokens and drops stopwords", () => {
    expect(extractKeywords("store.ts の編集の続きやって")).toEqual(["store.ts", "編集"]);
    expect(extractKeywords("続きやって")).toEqual([]);
  });
});

describe("rankKeywordHits", () => {
  it("puts memories matching more keywords first, then the newest", () => {
    const older = memory("pr93-old", "2026-09-20T08:00:00.000Z");
    const newer = memory("pr93-new", "2026-09-20T08:10:00.000Z");
    const prOnly = memory("pr110", "2026-09-20T13:00:00.000Z");
    const ranked = rankKeywordHits([
      [prOnly, newer, older], // "pr"
      [newer, older], // "93"
    ]);
    expect(ranked.map((m) => m.id)).toEqual(["pr93-new", "pr93-old", "pr110"]);
  });
});
