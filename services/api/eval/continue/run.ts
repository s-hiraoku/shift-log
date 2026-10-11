/**
 * Eval runner for「続きやって」(POST /v1/agent/continue).
 *
 *   pnpm run eval:continue --variant baseline   (from services/api)
 *
 * Each prompt goes through the real endpoint (createApp + app.request) against a
 * store holding the shared memory library. Deterministic and free: no LLM call,
 * one rep. Output lands in .claude/hillclimb/continue/<variant>/ in the same layout
 * as the summarize eval.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContinueContextResponse } from "@shift-log/schema";
import { createApp } from "../../src/app.js";
import { storeFor } from "../../src/lib/store.js";
import { formatMeanCi, loadSplit, splitSummary } from "../stats.js";
import { CASES, libraryMemories, mostRecentId } from "./cases.js";
import { gradeCase, METRICS } from "./grade.js";

const here = dirname(fileURLToPath(import.meta.url));
const flowDir = resolve(here, "../../../../.claude/hillclimb/continue");

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const variant = get("variant") ?? "baseline";
  if (!/^(baseline|v\d+)$/.test(variant)) throw new Error("--variant must be baseline or v<N>");
  return { variant, outDir: get("out") ? resolve(get("out")!) : join(flowDir, variant) };
}

export async function runContinueEval() {
  process.env.SHIFTLOG_PERSIST = "0";
  process.env.SHIFTLOG_API_TOKEN = "eval-token";
  process.env.SHIFTLOG_RATE_LIMIT_PER_MIN = "100000";
  const store = storeFor("default");
  store.reset();
  for (const memory of libraryMemories()) store.putMemory(memory);
  const recent = mostRecentId();
  const app = createApp();

  const rows = [];
  // The API writes an audit line per request; keep the eval output readable.
  const log = console.log;
  console.log = () => {};
  try {
    for (const c of CASES) {
      const res = await app.request("/v1/agent/continue", {
        method: "POST",
        headers: { authorization: "Bearer eval-token", "content-type": "application/json" },
        body: JSON.stringify({ prompt: c.prompt }),
      });
      if (res.status !== 200) throw new Error(`${c.id}: HTTP ${res.status}`);
      const body = (await res.json()) as ContinueContextResponse;
      const { grade, explanation } = gradeCase(c, body.memories, recent);
      rows.push({
        prompt_id: c.id,
        rep: 0,
        prompt: c.prompt,
        tags: c.tags,
        status: "ok",
        grade,
        explanation,
        model: "deterministic",
        meta: { relevant: c.relevant, returned: body.memories.slice(0, 5).map((m) => [m.id, m.matched_by]) },
        trace: [
          { role: "user", content: c.prompt },
          {
            role: "tool_result",
            name: "continue",
            content: body.memories
              .map((m, i) => `${i + 1}. ${m.id} [${m.matched_by}] ${m.front_matter.title}`)
              .join("\n"),
          },
        ],
      });
    }
  } finally {
    console.log = log;
  }
  return rows;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const rows = await runContinueEval();
  // Replace only this runner's output; keep change.md / change.patch / snapshots.
  for (const name of ["results.jsonl", "summary.json", "traces"]) {
    rmSync(join(opts.outDir, name), { recursive: true, force: true });
  }
  mkdirSync(join(opts.outDir, "traces"), { recursive: true });
  for (const { trace, ...row } of rows) {
    writeFileSync(join(opts.outDir, "traces", `${row.prompt_id}_rep0.json`), JSON.stringify(trace, null, 2));
  }
  writeFileSync(
    join(opts.outDir, "results.jsonl"),
    rows.map(({ trace: _trace, ...row }) => JSON.stringify(row)).join("\n") + "\n",
  );
  const metricIds = METRICS.map((m) => m.id);
  const splits = splitSummary(rows, metricIds, loadSplit(flowDir));
  writeFileSync(join(opts.outDir, "summary.json"), JSON.stringify({ rows: rows.length, ...splits }, null, 2));
  for (const [name, s] of Object.entries(splits)) {
    console.log(`${opts.variant} ${name.padEnd(5)} ${metricIds.map((id) => `${id}=${formatMeanCi(s[id]!)}`).join("  ")}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
