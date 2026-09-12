import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyEnvValues, parseEnvFile, loadRootEnv } from "./load-root-env.mjs";

describe("parseEnvFile", () => {
  it("reads assignments and skips comments", () => {
    const values = parseEnvFile(
      ["# comment", "SHIFTLOG_API_TOKEN=dev-token", "EMPTY=", "BAD", " quoted = 'x' "].join(
        "\n",
      ),
    );
    assert.deepEqual(values, {
      SHIFTLOG_API_TOKEN: "dev-token",
      EMPTY: "",
      quoted: "x",
    });
  });
});

describe("applyEnvValues", () => {
  it("does not override a value already in the environment", () => {
    const env = { SHIFTLOG_API_TOKEN: "from-shell" };
    const applied = applyEnvValues({ SHIFTLOG_API_TOKEN: "from-file", OTHER: "1" }, env);
    assert.equal(applied, 1);
    assert.equal(env.SHIFTLOG_API_TOKEN, "from-shell");
    assert.equal(env.OTHER, "1");
  });
});

describe("loadRootEnv", () => {
  it("noops when .env is missing and loads it when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "shiftlog-env-"));
    assert.equal(loadRootEnv(dir).loaded, false);
    writeFileSync(join(dir, ".env"), "SHIFTLOG_DEMO_ONLY=from-file\n");
    const previous = process.env.SHIFTLOG_DEMO_ONLY;
    delete process.env.SHIFTLOG_DEMO_ONLY;
    const result = loadRootEnv(dir);
    assert.equal(result.loaded, true);
    assert.equal(process.env.SHIFTLOG_DEMO_ONLY, "from-file");
    if (previous === undefined) delete process.env.SHIFTLOG_DEMO_ONLY;
    else process.env.SHIFTLOG_DEMO_ONLY = previous;
  });
});
