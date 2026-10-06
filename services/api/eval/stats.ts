import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type MeanCi = { mean: number; ci95: number; n: number };

/** Mean with a normal-approximation 95% half-width. */
export function meanCi(xs: number[]): MeanCi {
  const n = xs.length;
  if (n === 0) return { mean: NaN, ci95: NaN, n };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, ci95: 1.96 * Math.sqrt(variance / n), n };
}

export function formatMeanCi(s: MeanCi): string {
  return `${(s.mean * 100).toFixed(1)}% ±${(s.ci95 * 100).toFixed(1)} (n=${s.n})`;
}

/** The fixed train/test split recorded in `<flowDir>/_state.json`. */
export function loadSplit(flowDir: string): { train: Set<string>; test: Set<string> } | null {
  const p = join(flowDir, "_state.json");
  if (!existsSync(p)) return null;
  const s = JSON.parse(readFileSync(p, "utf8"));
  return { train: new Set(s.train_ids ?? []), test: new Set(s.test_ids ?? []) };
}

/** Per-split means of each metric over result rows (`{ prompt_id, grade }`). */
export function splitSummary(
  rows: { prompt_id: string; grade: Record<string, number> }[],
  metricIds: readonly string[],
  split: { train: Set<string>; test: Set<string> } | null,
): Record<string, Record<string, MeanCi>> {
  const out: Record<string, Record<string, MeanCi>> = {};
  const subsets: [string, Set<string> | null][] = [["all", null]];
  if (split) subsets.push(["train", split.train], ["test", split.test]);
  for (const [name, ids] of subsets) {
    const subset = ids ? rows.filter((r) => ids.has(r.prompt_id)) : rows;
    out[name] = Object.fromEntries(metricIds.map((id) => [id, meanCi(subset.map((r) => r.grade[id]!))]));
  }
  return out;
}
