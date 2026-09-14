import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  API_LABEL,
  COLLECTOR_LABEL,
  TEMPLATE_CONTEXT,
  assertDistArtifacts,
  bootstrapAgents,
  buildAgents,
  createLaunchdContext,
  distPaths,
  macJoin,
  parseArgs,
  renderPlist,
  setupLaunchd,
} from "./setup-launchd.mjs";

const FORBIDDEN = ["YOU", "replace-me", "pnpm", "/usr/bin/env"];

function fakeRepo() {
  const root = mkdtempSync(join(tmpdir(), "shiftlog-launchd-repo-"));
  const dist = distPaths(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "services/api/dist"), { recursive: true });
  mkdirSync(join(root, "apps/desktop/dist"), { recursive: true });
  writeFileSync(dist.envLoader, "export {}\n");
  writeFileSync(dist.api, "console.log('api')\n");
  writeFileSync(dist.collector, "console.log('collector')\n");
  return root;
}

function assertCleanPlist(xml, entry) {
  for (const token of FORBIDDEN) {
    assert.equal(xml.includes(token), false, `plist must not contain ${token}`);
  }
  assert.match(xml, /<key>ProgramArguments<\/key>/);
  assert.match(xml, /<string>\/opt\/node\/bin\/node<\/string>/);
  assert.match(xml, new RegExp(`<string>${entry.replaceAll("/", "\\/")}<\\/string>`));
  assert.match(xml, /<string>--import<\/string>/);
  assert.equal(xml.includes("SHIFTLOG_API_TOKEN"), false);
}

describe("buildAgents", () => {
  it("builds node + dist agents without a token or pnpm", () => {
    const ctx = createLaunchdContext({
      nodePath: "/opt/node/bin/node",
      repoRoot: "/Users/ada/shift-log",
      homeDir: "/Users/ada",
      apiOrigin: "http://localhost:8787",
    });
    const agents = buildAgents(ctx);
    assert.deepEqual(
      agents.map((agent) => agent.label),
      [API_LABEL, COLLECTOR_LABEL],
    );

    const api = agents[0];
    assert.deepEqual(api.programArguments, [
      "/opt/node/bin/node",
      "--import",
      "/Users/ada/shift-log/scripts/load-root-env.mjs",
      "/Users/ada/shift-log/services/api/dist/server.js",
    ]);
    assert.deepEqual(api.environment, {
      SHIFTLOG_DATA_DIR: "/Users/ada/.local/share/shiftlog",
    });
    assert.equal(api.standardOutPath, "/Users/ada/Library/Logs/shiftlog-api.log");

    const collector = agents[1];
    assert.deepEqual(collector.programArguments, [
      "/opt/node/bin/node",
      "--import",
      "/Users/ada/shift-log/scripts/load-root-env.mjs",
      "/Users/ada/shift-log/apps/desktop/dist/collector.js",
    ]);
    assert.deepEqual(collector.environment, {
      SHIFTLOG_API_ORIGIN: "http://localhost:8787",
    });
    assert.equal(
      collector.standardOutPath,
      "/Users/ada/Library/Logs/shiftlog-collector.log",
    );
  });
});

describe("renderPlist", () => {
  it("renders launchd XML the user can load", () => {
    const [api, collector] = buildAgents(
      createLaunchdContext({
        nodePath: "/opt/node/bin/node",
        repoRoot: "/Users/ada/shift-log",
        homeDir: "/Users/ada",
      }),
    );
    const apiXml = renderPlist(api);
    const collectorXml = renderPlist(collector);
    assertCleanPlist(apiXml, "/Users/ada/shift-log/services/api/dist/server.js");
    assertCleanPlist(
      collectorXml,
      "/Users/ada/shift-log/apps/desktop/dist/collector.js",
    );
    assert.match(apiXml, /<string>com.shiftlog.api<\/string>/);
    assert.match(collectorXml, /<string>com.shiftlog.collector<\/string>/);
    assert.match(apiXml, /<key>RunAtLoad<\/key>\n  <true\/>/);
    assert.equal(
      renderPlist({
        ...api,
        workingDirectory: "/tmp/a&b<c>",
      }).includes("/tmp/a&amp;b&lt;c&gt;"),
      true,
    );
  });
});

describe("packaging templates", () => {
  it("matches the renderer so YOU and replace-me cannot return", () => {
    for (const agent of buildAgents(TEMPLATE_CONTEXT)) {
      const expected = renderPlist(agent);
      const actual = readFileSync(
        join("packaging/macos", `${agent.label}.plist`),
        "utf8",
      );
      assert.equal(actual, expected);
      for (const token of FORBIDDEN) {
        assert.equal(actual.includes(token), false, `${agent.label} still has ${token}`);
      }
      assert.match(actual, /<string>{{NODE}}<\/string>/);
      assert.match(actual, /<string>{{REPO}}<\/string>/);
    }
  });
});

describe("setupLaunchd", () => {
  it("writes plists to dest and skips bootstrap when asked", () => {
    const repoRoot = fakeRepo();
    const homeDir = mkdtempSync(join(tmpdir(), "shiftlog-launchd-home-"));
    const destDir = join(homeDir, "Library/LaunchAgents");
    const calls = [];
    const result = setupLaunchd({
      ctx: {
        nodePath: "/opt/node/bin/node",
        repoRoot,
        homeDir,
        apiOrigin: "http://localhost:8787",
      },
      destDir,
      skipBuild: true,
      skipBootstrap: true,
      run: (file, args) => {
        calls.push([file, args]);
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.bootstrapped, false);
    assert.equal(calls.length, 0);
    const apiXml = readFileSync(join(destDir, "com.shiftlog.api.plist"), "utf8");
    const collectorXml = readFileSync(
      join(destDir, "com.shiftlog.collector.plist"),
      "utf8",
    );
    assertCleanPlist(apiXml, macJoin(repoRoot, "services/api/dist/server.js"));
    assertCleanPlist(
      collectorXml,
      macJoin(repoRoot, "apps/desktop/dist/collector.js"),
    );
    assert.equal(existsSync(join(homeDir, "Library/Logs")), true);
  });

  it("is idempotent when dest already has plists", () => {
    const repoRoot = fakeRepo();
    const homeDir = mkdtempSync(join(tmpdir(), "shiftlog-launchd-home-"));
    const destDir = join(homeDir, "Library/LaunchAgents");
    const opts = {
      ctx: {
        nodePath: "/opt/node/bin/node",
        repoRoot,
        homeDir,
        apiOrigin: "http://localhost:8787",
      },
      destDir,
      skipBuild: true,
      skipBootstrap: true,
    };
    const first = setupLaunchd(opts);
    const second = setupLaunchd(opts);
    assert.deepEqual(
      first.paths.map((file) => readFileSync(file, "utf8")),
      second.paths.map((file) => readFileSync(file, "utf8")),
    );
  });

  it("runs pnpm build unless skip-build", () => {
    const repoRoot = fakeRepo();
    const homeDir = mkdtempSync(join(tmpdir(), "shiftlog-launchd-home-"));
    const calls = [];
    setupLaunchd({
      ctx: {
        nodePath: "/opt/node/bin/node",
        repoRoot,
        homeDir,
        apiOrigin: "http://localhost:8787",
      },
      destDir: join(homeDir, "LaunchAgents"),
      skipBuild: false,
      skipBootstrap: true,
      run: (file, args) => {
        calls.push([file, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.deepEqual(calls[0], ["pnpm", "build"]);
  });

  it("fails closed when dist is missing", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "shiftlog-launchd-empty-"));
    assert.throws(
      () => assertDistArtifacts(repoRoot),
      /missing built entrypoints/,
    );
  });

  it("bootout then bootstrap each agent", () => {
    const dest = mkdtempSync(join(tmpdir(), "shiftlog-launchd-boot-"));
    const files = [
      join(dest, "com.shiftlog.api.plist"),
      join(dest, "com.shiftlog.collector.plist"),
    ];
    const calls = [];
    bootstrapAgents(
      files,
      (file, args) => {
        calls.push([file, ...args]);
        return { status: 0, stdout: "", stderr: "" };
      },
      501,
    );
    assert.deepEqual(calls, [
      ["launchctl", "bootout", "gui/501/com.shiftlog.api"],
      ["launchctl", "bootstrap", "gui/501", files[0]],
      ["launchctl", "bootout", "gui/501/com.shiftlog.collector"],
      ["launchctl", "bootstrap", "gui/501", files[1]],
    ]);
  });
});

describe("parseArgs", () => {
  it("defaults dest to ~/Library/LaunchAgents and skips bootstrap off macOS", () => {
    const opts = parseArgs(["--skip-build"], {
      homeDir: "/Users/ada",
      skipBootstrap: true,
    });
    assert.equal(opts.skipBuild, true);
    assert.equal(opts.destDir, "/Users/ada/Library/LaunchAgents");
    assert.equal(opts.skipBootstrap, true);
  });

  it("rejects unknown flags", () => {
    assert.throws(() => parseArgs(["--explode"]), /unknown argument: --explode/);
  });
});

describe("cli", () => {
  it("writes dest plists through pnpm setup:launchd flags", () => {
    const repoRoot = fakeRepo();
    const homeDir = mkdtempSync(join(tmpdir(), "shiftlog-launchd-cli-"));
    const destDir = join(homeDir, "LaunchAgents");
    const result = spawnSync(
      process.execPath,
      [
        "scripts/setup-launchd.mjs",
        "--skip-build",
        "--skip-bootstrap",
        "--node",
        "/opt/node/bin/node",
        "--repo",
        repoRoot,
        "--home",
        homeDir,
        "--dest",
        destDir,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote /);
    assert.match(result.stdout, /skipped launchctl bootstrap/);
    const xml = readFileSync(join(destDir, "com.shiftlog.api.plist"), "utf8");
    assertCleanPlist(xml, macJoin(repoRoot, "services/api/dist/server.js"));
  });
});
