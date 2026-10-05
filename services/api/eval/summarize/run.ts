/**
 * Eval runner for the ten-minute summary flow.
 *
 *   pnpm --filter @shift-log/api eval:summarize -- --mode fallback --variant baseline
 *
 * Each case goes through the production path (sanitizeWindowUpload →
 * summarizeTenMinuteWindow) against a fresh in-memory store. The LLM call is the
 * real one in src/jobs/llm.ts; this runner only observes global fetch so it can
 * record the request, reply, usage, and served model per case.
 *
 * Modes:
 *   llm       real endpoint from SHIFTLOG_LLM_* (costs money; needs a key)
 *   fallback  no LLM, i.e. what production stores when no key is set
 *   oracle    a fake endpoint replies with each case's hand-written ideal → expect ~100%
 *   null      a fake endpoint replies with a generic, valid answer → expect ~0% on pass
 *
 * Output (the layout /claude-api hillclimb and its report builders read):
 *   .claude/hillclimb/summarize/<variant>/results.jsonl   one row per (case, rep), appended
 *   .claude/hillclimb/summarize/<variant>/traces/<id>_rep<k>.json
 *   .claude/hillclimb/summarize/<variant>/errors.jsonl    attempts with no scorable output
 *   .claude/hillclimb/summarize/<variant>/summary.json
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemoryRecord } from "@shift-log/schema";
import { summarizeTenMinuteWindow } from "../../src/jobs/summarize.js";
import { sanitizeWindowUpload } from "../../src/lib/sanitize.js";
import { MemoryStore } from "../../src/lib/store.js";
import { CASES, type EvalCase } from "./cases.js";
import { gradeCase, METRICS } from "./grade.js";

type Mode = "llm" | "fallback" | "oracle" | "null";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const flowDir = join(repoRoot, ".claude/hillclimb/summarize");

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args.set(a.slice(2), "true");
    else args.set(a.slice(2), argv[++i]!);
  }
  const mode = (args.get("mode") ?? "fallback") as Mode;
  if (!["llm", "fallback", "oracle", "null"].includes(mode)) throw new Error(`unknown --mode ${mode}`);
  const variant = args.get("variant") ?? "baseline";
  if (!/^(baseline|v\d+)$/.test(variant)) throw new Error("--variant must be baseline or v<N>");
  return {
    mode,
    variant,
    reps: Number(args.get("reps") ?? (mode === "llm" ? 2 : 1)),
    concurrency: Number(args.get("concurrency") ?? 4),
    timeoutS: Number(args.get("timeout-s") ?? 90),
    only: args.get("only")?.split(",") ?? null,
    outDir: args.get("out") ? resolve(args.get("out")!) : join(flowDir, variant),
  };
}

// ── fetch observation ──────────────────────────────────────────────────────
type Call = {
  request: unknown;
  status: number;
  reply?: string;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
  attempts: number;
  latency_s: number;
  model_mismatch?: boolean;
};
const callStore = new AsyncLocalStorage<{ c: EvalCase; calls: Call[] }>();
const realFetch = globalThis.fetch;
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

function fakeReply(body: unknown): Response {
  return new Response(
    JSON.stringify({
      model: "eval-fake",
      choices: [{ message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const NULL_REPLY = { title: "作業", summary: "作業をしていた。", unfinished: "", entities: [] };

function installFetch(mode: Mode): void {
  globalThis.fetch = async (input, init) => {
    const ctx = callStore.getStore();
    if (!ctx) return realFetch(input, init);
    const request = init?.body ? JSON.parse(String(init.body)) : undefined;
    const requestedModel = (request as { model?: string } | undefined)?.model;
    let attempts = 0;
    let res: Response;
    const t0 = performance.now();
    for (;;) {
      attempts++;
      const started = performance.now();
      res =
        mode === "oracle"
          ? fakeReply(ctx.c.oracle)
          : mode === "null"
            ? fakeReply(NULL_REPLY)
            : await realFetch(input, init);
      if (!RETRYABLE.has(res.status) || attempts >= 4) {
        const text = await res.clone().text();
        let reply: string | undefined;
        let model: string | undefined;
        let usage: Call["usage"];
        try {
          const data = JSON.parse(text);
          reply = data.choices?.[0]?.message?.content;
          model = data.model;
          if (data.usage) {
            usage = {
              input_tokens: data.usage.prompt_tokens ?? 0,
              output_tokens: data.usage.completion_tokens ?? 0,
            };
          }
        } catch {
          reply = text;
        }
        const model_mismatch =
          mode === "llm" && res.ok && Boolean(requestedModel && model && !model.startsWith(requestedModel));
        ctx.calls.push({
          model_mismatch,
          request,
          status: res.status,
          reply,
          model,
          usage,
          attempts,
          latency_s: (performance.now() - started) / 1000,
        });
        return res;
      }
      const backoff = Math.min(30_000, 1000 * 2 ** attempts) * (0.5 + Math.random());
      await new Promise((r) => setTimeout(r, backoff));
      if (performance.now() - t0 > 120_000) attempts = 4;
    }
  };
}

function configureEnv(mode: Mode): void {
  // Never read or write the user's ShiftLog database from an eval run.
  process.env.SHIFTLOG_PERSIST = "0";
  if (mode === "fallback") {
    delete process.env.SHIFTLOG_LLM_API_KEY;
  } else if (mode === "oracle" || mode === "null") {
    process.env.SHIFTLOG_LLM_API_KEY = "eval-fake";
    process.env.SHIFTLOG_LLM_BASE_URL = "http://eval.invalid/v1";
  } else if (!process.env.SHIFTLOG_LLM_API_KEY) {
    throw new Error("--mode llm needs SHIFTLOG_LLM_API_KEY (and optionally SHIFTLOG_LLM_BASE_URL / SHIFTLOG_LLM_MODEL)");
  }
}

// ── one case ───────────────────────────────────────────────────────────────
function previousRecord(c: EvalCase): MemoryRecord | undefined {
  if (!c.previous) return undefined;
  const start = c.previous.window_start;
  const end = new Date(Date.parse(start) + 10 * 60_000).toISOString();
  return {
    id: `mem_prev_${c.id}`,
    created_at: end,
    updated_at: end,
    front_matter: {
      title: c.previous.title,
      description: "",
      apps: [],
      device: "desk",
      window_start: start,
      window_end: end,
      kind: "ten_minute",
      window_ids: [],
      skill_candidate: false,
    },
    body: c.previous.body,
  };
}

async function runCase(c: EvalCase) {
  const store = new MemoryStore(`eval_${c.id}`);
  const prev = previousRecord(c);
  if (prev) store.putMemory(prev);
  const sanitized = sanitizeWindowUpload(c.upload, store.permissions);
  const calls: Call[] = [];
  const t0 = performance.now();
  const record = await callStore.run({ c, calls }, () => summarizeTenMinuteWindow(store, sanitized));
  return { record, sanitized, calls, wall_s: (performance.now() - t0) / 1000 };
}

function withTimeout<T>(p: Promise<T>, s: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const ceiling = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${s}s`)), s * 1000);
  });
  return Promise.race([p, ceiling]).finally(() => clearTimeout(timer));
}

// ── stats ─────────────────────────────────────────────────────────────────
function meanCi(xs: number[]): { mean: number; ci95: number; n: number } {
  const n = xs.length;
  if (n === 0) return { mean: NaN, ci95: NaN, n };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  return { mean, ci95: 1.96 * Math.sqrt(variance / n), n };
}

function loadSplit(): { train: Set<string>; test: Set<string> } | null {
  const p = join(flowDir, "_state.json");
  if (!existsSync(p)) return null;
  const s = JSON.parse(readFileSync(p, "utf8"));
  return { train: new Set(s.train_ids ?? []), test: new Set(s.test_ids ?? []) };
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  configureEnv(opts.mode);
  installFetch(opts.mode);
  mkdirSync(join(opts.outDir, "traces"), { recursive: true });
  const resultsPath = join(opts.outDir, "results.jsonl");
  const errorsPath = join(opts.outDir, "errors.jsonl");

  const done = new Set<string>();
  if (existsSync(resultsPath)) {
    for (const line of readFileSync(resultsPath, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line);
      done.add(`${row.prompt_id}#${row.rep}`);
    }
  }

  const cases = opts.only ? CASES.filter((c) => opts.only!.includes(c.id)) : CASES;
  const jobs = cases.flatMap((c) =>
    Array.from({ length: opts.reps }, (_, rep) => ({ c, rep })).filter(
      ({ rep }) => !done.has(`${c.id}#${rep}`),
    ),
  );

  let next = 0;
  let errors = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const { c, rep } = jobs[next++]!;
      try {
        const out = await withTimeout(runCase(c), opts.timeoutS);
        const failedCall = out.calls.find((k) => k.status !== 200 || k.model_mismatch);
        if (opts.mode !== "fallback" && (out.calls.length === 0 || failedCall)) {
          // The app fell back because the endpoint failed: plumbing, not a model result.
          throw Object.assign(new Error(
            failedCall?.model_mismatch
              ? `served model ${failedCall.model} != requested`
              : `llm endpoint status ${failedCall?.status ?? "no call"}`,
          ), {
            cls: failedCall?.model_mismatch ? "model_mismatch" : "serving_error",
            call: failedCall,
          });
        }
        const { grade, explanation } = gradeCase(c, out.record, out.sanitized);
        const call = out.calls[out.calls.length - 1];
        const trace = [
          ...(call
            ? [
                ...((call.request as { messages?: { role: string; content: string }[] })?.messages ?? []).map(
                  (m) => ({ role: m.role, content: m.content }),
                ),
                { role: "assistant", content: call.reply ?? "" },
              ]
            : [{ role: "user", content: JSON.stringify(out.sanitized, null, 2) }]),
          {
            role: "tool_result",
            name: "stored_memory",
            content: `${out.record.front_matter.title}\n${out.record.front_matter.description}\n\n${out.record.body}`,
          },
        ];
        writeFileSync(join(opts.outDir, "traces", `${c.id}_rep${rep}.json`), JSON.stringify(trace, null, 2));
        const row = {
          prompt_id: c.id,
          rep,
          prompt: JSON.stringify(c.upload.events.map((e) => [e.app, e.type, e.summary, e.urlPath].filter(Boolean).join(" · "))),
          tags: c.tags,
          status: "ok",
          stop_reason: call ? "end_turn" : "fallback",
          grade,
          explanation,
          model: call?.model ?? (opts.mode === "fallback" ? "deterministic" : undefined),
          usage: call?.usage,
          latency_s: call?.latency_s ?? out.wall_s,
          meta: { mode: opts.mode, attempts: call?.attempts ?? 0, title: out.record.front_matter.title },
        };
        appendFileSync(resultsPath, `${JSON.stringify(row)}\n`);
      } catch (err) {
        errors++;
        const e = err as Error & { cls?: string; call?: Call };
        appendFileSync(
          errorsPath,
          `${JSON.stringify({
            prompt_id: c.id,
            rep,
            class: e.cls ?? (e.message.startsWith("timeout") ? "timeout" : "harness_error"),
            message: e.message,
            attempts: e.call?.attempts,
            model: e.call?.model,
            usage: e.call?.usage,
          })}\n`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));

  // Summary over every row on disk for this variant (so resumed runs count fully).
  const rows = existsSync(resultsPath)
    ? readFileSync(resultsPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
  const split = loadSplit();
  const pick = (ids: Set<string> | null) => (ids ? rows.filter((r) => ids.has(r.prompt_id)) : rows);
  const summary: Record<string, unknown> = { mode: opts.mode, rows: rows.length, errors };
  for (const [name, ids] of [
    ["all", null],
    ["train", split?.train ?? null],
    ["test", split?.test ?? null],
  ] as const) {
    if (name !== "all" && !ids) continue;
    const subset = pick(ids);
    summary[name] = Object.fromEntries(
      METRICS.map((m) => [m.id, meanCi(subset.map((r) => r.grade[m.id] as number))]),
    );
  }
  writeFileSync(join(opts.outDir, "summary.json"), JSON.stringify(summary, null, 2));

  const fmt = (s: { mean: number; ci95: number; n: number }) =>
    `${(s.mean * 100).toFixed(1)}% ±${(s.ci95 * 100).toFixed(1)} (n=${s.n})`;
  for (const name of ["all", "train", "test"]) {
    const s = summary[name] as Record<string, { mean: number; ci95: number; n: number }> | undefined;
    if (!s) continue;
    console.log(
      `${opts.variant} ${opts.mode} ${name.padEnd(5)} ` +
        METRICS.map((m) => `${m.id}=${fmt(s[m.id]!)}`).join("  "),
    );
  }
  if (errors > 0) console.log(`${errors} attempt(s) not scored, see ${errorsPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
