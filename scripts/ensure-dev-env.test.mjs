import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const script = fileURLToPath(new URL("./ensure-dev-env.sh", import.meta.url));

function run(env) {
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("ensure-dev-env.sh", () => {
  it("creates .env from the example and does not overwrite an existing file", () => {
    const root = mkdtempSync(join(tmpdir(), "shiftlog-ensure-env-"));
    writeFileSync(join(root, ".env.example"), "SHIFTLOG_API_TOKEN=from-example\n");
    let result = run({ SHIFTLOG_ROOT: root });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, ".env"), "utf8"), "SHIFTLOG_API_TOKEN=from-example\n");
    writeFileSync(join(root, ".env"), "SHIFTLOG_API_TOKEN=keep-me\n");
    result = run({ SHIFTLOG_ROOT: root });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, ".env"), "utf8"), "SHIFTLOG_API_TOKEN=keep-me\n");
    assert.match(result.stdout, /data dir/);
  });

  it("fails when .env.example is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "shiftlog-ensure-env-missing-"));
    mkdirSync(root, { recursive: true });
    const result = run({ SHIFTLOG_ROOT: root });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing \.env\.example/);
  });
});
