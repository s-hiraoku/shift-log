import type { ContinueMemory, MemoryRecord } from "@shift-log/schema";

const STOPWORDS = new Set([
  "and",
  "continue",
  "for",
  "from",
  "please",
  "the",
  "today",
  "tomorrow",
  "with",
  "yesterday",
  "から",
  "さっき",
  "ください",
  "やって",
  "今日",
  "午前",
  "午後",
  "作業",
  "明日",
  "昨日",
  "続き",
]);

export function extractKeywords(prompt: string): string[] {
  const tokens =
    prompt.match(/[A-Za-z0-9][A-Za-z0-9_./#-]{1,}|[\u3040-\u30ff\u4e00-\u9fff]{2,}/gu) ?? [];
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (STOPWORDS.has(key) || STOPWORDS.has(token) || seen.has(key)) continue;
    seen.add(key);
    keywords.push(key);
  }
  return keywords;
}

export function mergeContinueMemories(input: {
  recent: MemoryRecord[];
  keywordHits: MemoryRecord[];
  limit: number;
}): ContinueMemory[] {
  const memories: ContinueMemory[] = [];
  const seen = new Set<string>();
  for (const memory of input.keywordHits) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    memories.push({ ...memory, matched_by: "keyword" });
    if (memories.length >= input.limit) return memories;
  }
  for (const memory of input.recent) {
    if (seen.has(memory.id)) continue;
    seen.add(memory.id);
    memories.push({ ...memory, matched_by: "recent" });
    if (memories.length >= input.limit) return memories;
  }
  return memories;
}
