// ガーデンの対象固有のハーネス: AC-002 / INV-001（全ワークスペーステスト・スクリプトテスト・型検査）
// 終了コード: 0 = 全段階合格, 1 = 挙動不一致（UNSATISFIED）, 75 = 環境不備（INCONCLUSIVE）
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envWithPnpm, readPinnedToolchain, resolvePinnedPnpm } from "./pnpm-runner.mjs";

const evidenceDir = process.env.GARDEN_EVIDENCE_DIR ?? ".";

function writeEvidence(payload) {
  writeFileSync(
    join(evidenceDir, "workspace-verify-result.json"),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8",
  );
}

const required = readPinnedToolchain();
const pnpmInfo = resolvePinnedPnpm(required.pnpmVersion);

if (!existsSync("node_modules") || !pnpmInfo) {
  writeEvidence({
    passed: false,
    reason: !existsSync("node_modules") ? "node_modules_missing" : "pnpm_unavailable",
    stages: [],
  });
  console.error("environment not ready: run check-toolchain.mjs first");
  process.exit(75);
}

const scriptTests = readdirSync("scripts")
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => join("scripts", name));

const stages = [
  { id: "workspace_tests", cmd: pnpmInfo.bin, args: ["-r", "run", "test"] },
  { id: "script_tests", cmd: "node", args: ["--test", ...scriptTests] },
  { id: "typecheck", cmd: pnpmInfo.bin, args: ["-r", "run", "typecheck"] },
];

const childEnv = envWithPnpm(pnpmInfo);
const results = [];
let failedStage = null;

for (const stage of stages) {
  const started = Date.now();
  const res = spawnSync(stage.cmd, stage.args, {
    stdio: "inherit",
    env: childEnv,
  });
  const durationMs = Date.now() - started;
  const exitCode = res.error ? 127 : res.status ?? 1;
  results.push({
    id: stage.id,
    command: [stage.cmd, ...stage.args],
    exit_code: exitCode,
    passed: exitCode === 0,
    duration_ms: durationMs,
  });
  if (exitCode !== 0) {
    failedStage = stage.id;
    break;
  }
}

writeEvidence({
  passed: failedStage === null,
  failed_stage: failedStage,
  stages: results,
});

if (failedStage !== null) {
  console.error(`workspace verification failed at stage: ${failedStage}`);
  process.exit(1);
}

console.log(`workspace verification passed (${results.length} stages)`);
