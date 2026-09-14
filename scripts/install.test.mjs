import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "install.sh");

function git(cwd, args, extra = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "shiftlog-test",
      GIT_AUTHOR_EMAIL: "shiftlog-test@example.com",
      GIT_COMMITTER_NAME: "shiftlog-test",
      GIT_COMMITTER_EMAIL: "shiftlog-test@example.com",
    },
    ...extra,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function makeUpstream() {
  const root = mkdtempSync(join(tmpdir(), "shiftlog-upstream-"));
  git(root, ["init", "-b", "main"]);
  writeFileSync(join(root, ".env.example"), "SHIFTLOG_API_TOKEN=dev-token\n");
  writeFileSync(join(root, "README.md"), "upstream\n");
  git(root, ["add", ".env.example", "README.md"]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), "shiftlog-home-"));
  const stub = join(home, "bin");
  mkdirSync(stub);
  const log = join(home, "stub.log");
  writeFileSync(log, "");
  for (const name of ["pnpm", "corepack"]) {
    const file = join(stub, name);
    writeFileSync(
      file,
      `#!/usr/bin/env bash
printf '%s %s %s\\n' "${name}" "$(pwd)" "$*" >> "$SHIFTLOG_STUB_LOG"
exit 0
`,
    );
    chmodSync(file, 0o755);
  }
  return { home, stub, log };
}

function runInstall(home, stub, log, args, extraEnv = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      PATH: `${stub}:${process.env.PATH}`,
      SHIFTLOG_STUB_LOG: log,
      ...extraEnv,
    },
  });
}

function srcDir(home) {
  return join(home, ".local/share/shiftlog/src");
}

function dataDir(home) {
  return join(home, ".local/share/shiftlog");
}

describe("install.sh", () => {
  it("clones into ~/.local/share/shiftlog/src, installs, builds schema, and runs setup:launchd", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const result = runInstall(home, stub, log, [], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /shiftlog: source /);
    assert.equal(readFileSync(join(srcDir(home), ".git", "HEAD"), "utf8").includes("ref:"), true);
    assert.equal(
      readFileSync(join(srcDir(home), ".env"), "utf8"),
      "SHIFTLOG_API_TOKEN=dev-token\n",
    );
    assert.equal(statSync(join(srcDir(home), ".env")).mode & 0o777, 0o600);
    const stubLog = readFileSync(log, "utf8").trim().split("\n");
    assert.deepEqual(stubLog, [
      `corepack ${srcDir(home)} enable`,
      `pnpm ${srcDir(home)} install`,
      `pnpm ${srcDir(home)} --filter @shift-log/schema build`,
      `pnpm ${srcDir(home)} setup:launchd`,
    ]);
  });
  it("install on an existing checkout fetches the default branch", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const first = runInstall(home, stub, log, ["install"], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(first.status, 0, first.stderr || first.stdout);
    writeFileSync(join(upstream, "NEXT"), "from-main\n");
    git(upstream, ["add", "NEXT"]);
    git(upstream, ["commit", "-m", "next"]);
    const second = runInstall(home, stub, log, ["install"], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(readFileSync(join(srcDir(home), "NEXT"), "utf8"), "from-main\n");
  });

  it("update fetches the default branch and does not wipe db, .env, or credentials", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const first = runInstall(home, stub, log, ["install"], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    writeFileSync(join(srcDir(home), ".env"), "SHIFTLOG_API_TOKEN=keep-me\n");
    writeFileSync(join(dataDir(home), "shiftlog.db"), "sqlite-bytes");
    const credDir = join(home, ".config/shiftlog");
    mkdirSync(credDir, { recursive: true });
    writeFileSync(join(credDir, "credentials.json"), '{"token":"keychain-stand-in"}');

    writeFileSync(join(upstream, "NEXT"), "from-main\n");
    git(upstream, ["add", "NEXT"]);
    git(upstream, ["commit", "-m", "next"]);

    writeFileSync(log, "");
    const second = runInstall(home, stub, log, ["update"], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(readFileSync(join(srcDir(home), "NEXT"), "utf8"), "from-main\n");
    assert.equal(readFileSync(join(srcDir(home), ".env"), "utf8"), "SHIFTLOG_API_TOKEN=keep-me\n");
    assert.equal(readFileSync(join(dataDir(home), "shiftlog.db"), "utf8"), "sqlite-bytes");
    assert.equal(
      readFileSync(join(credDir, "credentials.json"), "utf8"),
      '{"token":"keychain-stand-in"}',
    );
    const stubLog = readFileSync(log, "utf8");
    assert.match(stubLog, /^pnpm .* install$/m);
    assert.match(stubLog, /--filter @shift-log\/schema build/m);
    assert.match(stubLog, /setup:launchd/m);
  });

  it("refuses a non-git install dir without deleting it", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const dest = srcDir(home);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "keep.txt"), "stay");
    const result = runInstall(home, stub, log, ["install"], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a git checkout/);
    assert.equal(readFileSync(join(dest, "keep.txt"), "utf8"), "stay");
  });

  it("rejects an unknown verb", () => {
    const { home, stub, log } = makeHome();
    const result = runInstall(home, stub, log, ["explode"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage: install.sh/);
  });

  it("reads verbs from bash -s when piped", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const script = readFileSync(SCRIPT);
    const result = spawnSync("bash", ["-s", "--", "install"], {
      encoding: "utf8",
      input: script,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${stub}:${process.env.PATH}`,
        SHIFTLOG_STUB_LOG: log,
        SHIFTLOG_REPO_URL: upstream,
      },
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(statSync(join(srcDir(home), ".git")).isDirectory(), true);
    assert.match(readFileSync(log, "utf8"), /setup:launchd/);
  });
});
