import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const API_LABEL = "com.shiftlog.api";
export const COLLECTOR_LABEL = "com.shiftlog.collector";

export const TEMPLATE_CONTEXT = Object.freeze({
  nodePath: "{{NODE}}",
  repoRoot: "{{REPO}}",
  homeDir: "{{HOME}}",
  apiOrigin: "http://localhost:8787",
});

export function macJoin(root, ...parts) {
  return [String(root).replace(/\/$/, ""), ...parts].join("/");
}

export function distPaths(repoRoot) {
  return {
    envLoader: macJoin(repoRoot, "scripts/load-root-env.mjs"),
    api: macJoin(repoRoot, "services/api/dist/server.js"),
    collector: macJoin(repoRoot, "apps/desktop/dist/collector.js"),
  };
}

export function createLaunchdContext({
  nodePath = process.execPath,
  repoRoot = REPO_ROOT,
  homeDir = homedir(),
  apiOrigin = process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787",
} = {}) {
  return {
    nodePath,
    repoRoot: resolve(repoRoot),
    homeDir,
    apiOrigin,
  };
}

function nodeProgramArguments(ctx, entry) {
  return [ctx.nodePath, "--import", distPaths(ctx.repoRoot).envLoader, entry];
}

export function buildAgents(ctx) {
  const dist = distPaths(ctx.repoRoot);
  const logs = macJoin(ctx.homeDir, "Library/Logs");
  return [
    {
      label: API_LABEL,
      workingDirectory: ctx.repoRoot,
      programArguments: nodeProgramArguments(ctx, dist.api),
      environment: {
        SHIFTLOG_DATA_DIR: macJoin(ctx.homeDir, ".local/share/shiftlog"),
      },
      standardOutPath: macJoin(logs, "shiftlog-api.log"),
      standardErrorPath: macJoin(logs, "shiftlog-api.log"),
    },
    {
      label: COLLECTOR_LABEL,
      workingDirectory: ctx.repoRoot,
      programArguments: nodeProgramArguments(ctx, dist.collector),
      environment: {
        SHIFTLOG_API_ORIGIN: ctx.apiOrigin,
      },
      standardOutPath: macJoin(logs, "shiftlog-collector.log"),
      standardErrorPath: macJoin(logs, "shiftlog-collector.log"),
    },
  ];
}

export function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderStringDict(entries, indent) {
  const pad = " ".repeat(indent);
  return Object.entries(entries)
    .map(
      ([key, value]) =>
        `${pad}<key>${xmlEscape(key)}</key>\n${pad}<string>${xmlEscape(value)}</string>`,
    )
    .join("\n");
}

export function renderPlist(agent) {
  const args = agent.programArguments
    .map((value) => `    <string>${xmlEscape(value)}</string>`)
    .join("\n");
  const env = renderStringDict(agent.environment, 4);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(agent.label)}</string>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(agent.workingDirectory)}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(agent.standardOutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(agent.standardErrorPath)}</string>
</dict>
</plist>
`;
}

export function plistFileName(label) {
  return `${label}.plist`;
}

export function writeLaunchAgents(agents, destDir) {
  mkdirSync(destDir, { recursive: true });
  return agents.map((agent) => {
    const file = resolve(destDir, plistFileName(agent.label));
    writeFileSync(file, renderPlist(agent));
    return file;
  });
}

export function assertDistArtifacts(repoRoot) {
  const dist = distPaths(repoRoot);
  const missing = [dist.api, dist.collector].filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `missing built entrypoints:\n${missing.join("\n")}\nRun pnpm build first.`,
    );
  }
}

export function parseArgs(argv, defaults = {}) {
  const opts = {
    skipBuild: false,
    skipBootstrap: process.platform !== "darwin",
    destDir: undefined,
    writeTemplates: false,
    nodePath: process.execPath,
    repoRoot: REPO_ROOT,
    homeDir: homedir(),
    apiOrigin: process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787",
    ...defaults,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--skip-build") opts.skipBuild = true;
    else if (arg === "--skip-bootstrap") opts.skipBootstrap = true;
    else if (arg === "--write-templates") opts.writeTemplates = true;
    else if (arg === "--dest") opts.destDir = argv[++i];
    else if (arg === "--node") opts.nodePath = argv[++i];
    else if (arg === "--repo") opts.repoRoot = argv[++i];
    else if (arg === "--home") opts.homeDir = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!opts.nodePath) throw new Error("missing --node path");
  if (opts.destDir === undefined) {
    opts.destDir = macJoin(opts.homeDir, "Library/LaunchAgents");
  }
  return opts;
}

function runPnpmBuild(repoRoot, run) {
  const result = run("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error("pnpm build failed");
  }
}

export function bootstrapAgents(plistPaths, run, uid = process.getuid?.()) {
  if (uid == null) {
    throw new Error("launchctl bootstrap needs a user id");
  }
  const domain = `gui/${uid}`;
  for (const file of plistPaths) {
    const label = file.replace(/^.*\//, "").replace(/\.plist$/, "");
    run("launchctl", ["bootout", `${domain}/${label}`], { stdio: "ignore" });
    const loaded = run("launchctl", ["bootstrap", domain, file], {
      encoding: "utf8",
    });
    if (loaded.status !== 0) {
      throw new Error(
        `launchctl bootstrap failed for ${label}: ${loaded.stderr || loaded.stdout || loaded.status}`,
      );
    }
  }
}

export function setupLaunchd({
  ctx,
  destDir,
  skipBuild = false,
  skipBootstrap = true,
  writeTemplates = false,
  templatesDir = resolve(REPO_ROOT, "packaging/macos"),
  run = spawnSync,
} = {}) {
  if (!skipBuild) runPnpmBuild(ctx.repoRoot, run);
  assertDistArtifacts(ctx.repoRoot);
  const agents = buildAgents(ctx);
  mkdirSync(macJoin(ctx.homeDir, "Library/Logs"), { recursive: true });
  const paths = writeLaunchAgents(agents, destDir);
  if (writeTemplates) {
    writeLaunchAgents(buildAgents(TEMPLATE_CONTEXT), templatesDir);
  }
  if (!skipBootstrap) bootstrapAgents(paths, run);
  return { agents, paths, bootstrapped: !skipBootstrap };
}

export async function main(argv = process.argv.slice(2), run = spawnSync) {
  const opts = parseArgs(argv);
  const ctx = createLaunchdContext({
    nodePath: opts.nodePath,
    repoRoot: opts.repoRoot,
    homeDir: opts.homeDir,
    apiOrigin: opts.apiOrigin,
  });
  const result = setupLaunchd({
    ctx,
    destDir: opts.destDir,
    skipBuild: opts.skipBuild,
    skipBootstrap: opts.skipBootstrap,
    writeTemplates: opts.writeTemplates,
    run,
  });
  for (const file of result.paths) {
    console.log(`wrote ${file}`);
  }
  if (result.bootstrapped) {
    console.log("launchctl bootstrap complete");
  } else if (process.platform !== "darwin") {
    console.log("skipped launchctl bootstrap (not macOS)");
  } else {
    console.log("skipped launchctl bootstrap");
  }
  return result;
}

const invokedAsCli =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedAsCli) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
