// ガーデンの対象固有のハーネス: AC-001（Node 24・固定 pnpm・依存復元・schema ビルド）
// 終了コード: 0 = 準備完了, 1 = ビルド失敗, 75 = 環境不備（INCONCLUSIVE）
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readPinnedToolchain, resolvePinnedPnpm } from "./pnpm-runner.mjs";

const evidenceDir = process.env.GARDEN_EVIDENCE_DIR ?? ".";

function writeEvidence(payload) {
  writeFileSync(
    join(evidenceDir, "toolchain-diagnostic.json"),
    JSON.stringify(payload, null, 2) + "\n",
    "utf8",
  );
}

const required = readPinnedToolchain();
const actualNode = process.versions.node;
const actualMajor = actualNode.split(".")[0];

if (actualMajor !== required.nodeMajor) {
  writeEvidence({
    ready: false,
    reason: "node_version_mismatch",
    required,
    actual: { node: actualNode },
    remedy: `Install Node.js ${required.nodeMajor}.x (see .nvmrc).`,
  });
  console.error(
    `node_version_mismatch: required Node ${required.nodeMajor}.x, actual ${actualNode}`,
  );
  process.exit(75);
}

const pnpmInfo = resolvePinnedPnpm(required.pnpmVersion);
if (!pnpmInfo) {
  writeEvidence({
    ready: false,
    reason: "pnpm_unavailable",
    required,
    actual: { node: actualNode, pnpm: null },
    remedy: `Ensure npm can install pnpm@${required.pnpmVersion} into a temporary cache.`,
  });
  console.error(`pnpm_unavailable: could not provision pnpm@${required.pnpmVersion}`);
  process.exit(75);
}

if (!existsSync("node_modules")) {
  const res = spawnSync(pnpmInfo.bin, ["install", "--frozen-lockfile"], {
    stdio: "inherit",
  });
  const code = res.error ? 127 : res.status ?? 1;
  if (code !== 0) {
    writeEvidence({
      ready: false,
      reason: "dependency_install_failed",
      exit_code: code,
      required,
      actual: { node: actualNode, pnpm: pnpmInfo.version, source: pnpmInfo.source },
      remedy: "Check network access to the npm registry and pnpm-lock.yaml.",
    });
    console.error(`dependency_install_failed: pnpm install exited with ${code}`);
    process.exit(75);
  }
}

const build = spawnSync(pnpmInfo.bin, ["--filter", "@shift-log/schema", "build"], {
  stdio: "inherit",
});
const buildCode = build.error ? 127 : build.status ?? 1;
if (buildCode !== 0) {
  writeEvidence({
    ready: false,
    reason: "schema_build_failed",
    exit_code: buildCode,
    required,
    actual: { node: actualNode, pnpm: pnpmInfo.version, source: pnpmInfo.source },
  });
  console.error(`schema_build_failed: @shift-log/schema build exited with ${buildCode}`);
  process.exit(1);
}

writeEvidence({
  ready: true,
  required,
  actual: { node: actualNode, pnpm: pnpmInfo.version, source: pnpmInfo.source },
});
console.log(
  `toolchain ready (node ${actualNode}, pnpm ${pnpmInfo.version} via ${pnpmInfo.source})`,
);
