import type { ContinueMemory } from "@shift-log/schema";
import type { ContinueCase } from "./cases.js";

/**
 * - hit1:         the first memory is one the person means (topic prompts), or the
 *                 most recent memory (generic and nomatch prompts)
 * - recall3:      share of the relevant memories in the top 3 (capped at 3);
 *                 equals hit1 for generic and nomatch prompts
 * - kw_precision: share of keyword-matched memories that are relevant; a generic or
 *                 nomatch prompt scores 0 if anything was matched by keyword
 */
export const METRICS = [
  { id: "hit1", label: "hit@1", kind: "binary" },
  { id: "recall3", label: "recall@3", kind: "float", scale: 1 },
  { id: "kw_precision", label: "kw precision", kind: "float", scale: 1 },
] as const;

export type Grade = Record<(typeof METRICS)[number]["id"], number>;

export function gradeCase(
  c: ContinueCase,
  memories: ContinueMemory[],
  mostRecentId: string,
): { grade: Grade; explanation: Record<string, string> } {
  const explanation: Record<string, string> = {};
  const ids = memories.map((m) => m.id);
  const keywordIds = memories.filter((m) => m.matched_by === "keyword").map((m) => m.id);
  const topic = c.relevant.length > 0;
  const relevant = new Set(c.relevant);

  const hit1 = topic ? (relevant.has(ids[0] ?? "") ? 1 : 0) : ids[0] === mostRecentId ? 1 : 0;
  if (!hit1) explanation.hit1 = `first was ${ids[0] ?? "(none)"}`;

  const recall3 = topic
    ? ids.slice(0, 3).filter((id) => relevant.has(id)).length / Math.min(3, relevant.size)
    : hit1;

  let kw_precision: number;
  if (topic) {
    kw_precision =
      keywordIds.length === 0 ? 1 : keywordIds.filter((id) => relevant.has(id)).length / keywordIds.length;
  } else {
    kw_precision = keywordIds.length === 0 ? 1 : 0;
  }
  if (kw_precision < 1) {
    explanation.kw_precision = `keyword hits not relevant: ${keywordIds.filter((id) => !relevant.has(id)).join(", ")}`;
  }

  return { grade: { hit1, recall3, kw_precision }, explanation };
}
