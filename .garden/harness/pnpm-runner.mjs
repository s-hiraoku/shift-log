// ガーデンの対象固有のハーネス共通ユーティリティ: packageManager で固定した pnpm を隔離キャッシュから解決する
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function readPinnedToolchain() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const pm = String(pkg.packageManager ?? "");
  const match = pm.match(/^pnpm@(.+)$/);
  const pnpmVersion = match ? match[1] : null;
  let nodeMajor = "24";
  try {
    nodeMajor = readFileSync(".nvmrc", "utf8").trim().replace(/^v/, "").split(".")[0];
  } catch {
    // default to 24
  }
  return { nodeMajor, pnpmVersion };
}

function getPnpmVersion(bin) {
  try {
    return execFileSync(bin, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function resolvePinnedPnpm(requiredVersion) {
  const globalVer = getPnpmVersion("pnpm");
  if (!requiredVersion && globalVer) {
    return { bin: "pnpm", version: globalVer, source: "path" };
  }
  if (requiredVersion && globalVer === requiredVersion) {
    return { bin: "pnpm", version: globalVer, source: "path" };
  }
  if (!requiredVersion) {
    return null;
  }

  const cacheDir = join(tmpdir(), `shiftlog-garden-pnpm-${requiredVersion}`);
  const binName = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const cachedBin = join(cacheDir, "node_modules", ".bin", binName);

  if (existsSync(cachedBin) && getPnpmVersion(cachedBin) === requiredVersion) {
    return { bin: cachedBin, version: requiredVersion, source: "tmp_cache" };
  }

  mkdirSync(cacheDir, { recursive: true });
  const install = spawnSync(
    "npm",
    ["install", "--prefix", cacheDir, "--no-audit", "--no-fund", `pnpm@${requiredVersion}`],
    { stdio: "inherit" },
  );
  if ((install.error ? 127 : install.status ?? 1) !== 0 || !existsSync(cachedBin)) {
    return null;
  }
  return {
    bin: cachedBin,
    version: getPnpmVersion(cachedBin) ?? requiredVersion,
    source: "tmp_cache",
  };
}
