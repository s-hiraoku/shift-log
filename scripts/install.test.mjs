import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

const PINNED_PNPM = "12.4.1";

function makeUpstream() {
  const root = mkdtempSync(join(tmpdir(), "shiftlog-upstream-"));
  git(root, ["init", "-b", "main"]);
  writeFileSync(join(root, ".env.example"), "SHIFTLOG_API_TOKEN=dev-token\n");
  writeFileSync(join(root, "README.md"), "upstream\n");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({ name: "shift-log", packageManager: `pnpm@${PINNED_PNPM}` }, null, 2)}\n`,
  );
  git(root, ["add", ".env.example", "README.md", "package.json"]);
  git(root, ["commit", "-m", "init"]);
  return root;
}

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), "shiftlog-home-"));
  const stub = join(home, "bin");
  mkdirSync(stub);
  const log = join(home, "stub.log");
  writeFileSync(log, "");

  const pnpm = join(stub, "pnpm");
  writeFileSync(
    pnpm,
    `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then
  echo "\${SHIFTLOG_STUB_PNPM_VERSION-${PINNED_PNPM}}"
  exit 0
fi
printf '%s %s %s\\n' "pnpm" "$(pwd)" "$*" >> "$SHIFTLOG_STUB_LOG"
exit 0
`,
  );
  chmodSync(pnpm, 0o755);

  // npm install --prefix DIR pnpm@X を、pnpm スタブを DIR へ置くことで模す
  const npm = join(stub, "npm");
  writeFileSync(
    npm,
    `#!/usr/bin/env bash
printf '%s %s %s\\n' "npm" "$(pwd)" "$*" >> "$SHIFTLOG_STUB_LOG"
prefix=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--prefix" ]]; then prefix="$2"; fi
  shift
done
if [[ -n "$prefix" ]]; then
  mkdir -p "$prefix/node_modules/.bin"
  cp "$SHIFTLOG_STUB_BIN/pnpm" "$prefix/node_modules/.bin/pnpm"
fi
exit 0
`,
  );
  chmodSync(npm, 0o755);
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
      SHIFTLOG_STUB_BIN: stub,
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
  it("clones into ~/.local/share/shiftlog/src, installs, and runs setup:launchd", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const result = runInstall(home, stub, log, [], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /shiftlog: source /);
    assert.equal(readFileSync(join(srcDir(home), ".git", "HEAD"), "utf8").includes("ref:"), true);
    assert.equal(statSync(join(srcDir(home), ".env")).mode & 0o777, 0o600);
    const stubLog = readFileSync(log, "utf8").trim().split("\n");
    assert.deepEqual(stubLog, [
      `pnpm ${srcDir(home)} install`,
      `pnpm ${srcDir(home)} --filter @shift-log/schema build`,
      `pnpm ${srcDir(home)} --filter @shift-log/desktop credentials set`,
      `pnpm ${srcDir(home)} setup:launchd`,
    ]);
  });

  it("replaces the public placeholder token with a per-install random one", () => {
    const upstream = makeUpstream();
    const first = makeHome();
    const second = makeHome();
    for (const home of [first, second]) {
      const result = runInstall(home.home, home.stub, home.log, [], {
        SHIFTLOG_REPO_URL: upstream,
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const tokenOf = (home) => {
      const env = readFileSync(join(srcDir(home), ".env"), "utf8");
      const match = env.match(/^SHIFTLOG_API_TOKEN=(.+)$/m);
      assert.ok(match, `no SHIFTLOG_API_TOKEN in ${env}`);
      return match[1];
    };
    const a = tokenOf(first.home);
    const b = tokenOf(second.home);
    assert.match(a, /^[0-9a-f]{48}$/);
    assert.notEqual(a, "dev-token");
    assert.notEqual(a, b);
  });

  it("warns instead of rewriting when an existing .env still holds dev-token", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const first = runInstall(home, stub, log, ["install"], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(first.status, 0, first.stderr || first.stdout);

    writeFileSync(join(srcDir(home), ".env"), "SHIFTLOG_API_TOKEN=dev-token\n");
    const second = runInstall(home, stub, log, ["update"], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stderr, /dev-token/);
    assert.equal(
      readFileSync(join(srcDir(home), ".env"), "utf8"),
      "SHIFTLOG_API_TOKEN=dev-token\n",
    );
  });
  it("uses the pnpm already on PATH when it matches packageManager", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const result = runInstall(home, stub, log, [], { SHIFTLOG_REPO_URL: upstream });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(readFileSync(log, "utf8"), /^npm /m);
    assert.equal(existsSync(join(dataDir(home), "toolchain")), false);
  });

  it("fetches the pinned pnpm when the one on PATH is a different version", () => {
    const upstream = makeUpstream();
    const { home, stub, log } = makeHome();
    const result = runInstall(home, stub, log, [], {
      SHIFTLOG_REPO_URL: upstream,
      SHIFTLOG_STUB_PNPM_VERSION: "9.12.2",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const toolchain = join(dataDir(home), "toolchain", `pnpm-${PINNED_PNPM}`);
    assert.match(
      readFileSync(log, "utf8"),
      new RegExp(`^npm .* --prefix ${toolchain} pnpm@${PINNED_PNPM}$`, "m"),
    );
    assert.equal(existsSync(join(toolchain, "node_modules/.bin/pnpm")), true);
    assert.match(result.stderr, /installing pnpm 12\.4\.1/);
    // 取り寄せた pnpm で残りの手順が続く
    assert.match(readFileSync(log, "utf8"), /^pnpm .* setup:launchd$/m);
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
    assert.match(stubLog, /--filter @shift-log\/desktop credentials set/m);
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
