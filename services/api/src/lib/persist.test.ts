import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PermissionsConfigSchema } from "@shift-log/schema";
import { resetPersistCache } from "./persist.js";
import { MemoryStore } from "./store.js";

describe("sqlite persist", () => {
  const dirs: string[] = [];

  afterEach(() => {
    delete process.env.SHIFTLOG_DATA_DIR;
    process.env.VITEST = "true";
    process.env.SHIFTLOG_PERSIST = "0";
    resetPersistCache();
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("round-trips a tenant through sqlite", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shiftlog-persist-"));
    dirs.push(dir);
    delete process.env.VITEST;
    process.env.SHIFTLOG_PERSIST = "1";
    process.env.SHIFTLOG_DATA_DIR = dir;
    resetPersistCache();

    const a = new MemoryStore("alice");
    a.setPermissions(
      PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true }),
    );
    expect(a.permissions.enabled).toBe(true);

    resetPersistCache();
    const b = new MemoryStore("alice");
    expect(b.permissions.enabled).toBe(true);
    expect(b.permissions.memories_enabled).toBe(true);

    const carol = new MemoryStore("carol");
    expect(carol.permissions.enabled).toBe(false);
  });
});
