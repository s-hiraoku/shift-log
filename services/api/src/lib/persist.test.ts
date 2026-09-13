import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PermissionsConfigSchema } from "@shift-log/schema";
import {
  ensureDefaultDataDir,
  findRepoRoot,
  resetPersistCache,
  resolveDataDir,
  resolveShiftLogDataDir,
} from "./persist.js";
import { MemoryStore } from "./store.js";

describe("ensureDefaultDataDir", () => {
  const keys = ["VITEST", "SHIFTLOG_PERSIST", "DATABASE_URL", "SHIFTLOG_DATA_DIR", "VERCEL"] as const;
  const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  afterEach(() => {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.env.VITEST = "true";
  });

  function clearPersistEnv(): void {
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  }

  it("sets ~/.local/share/shiftlog when self-hosted env is empty", () => {
    clearPersistEnv();
    ensureDefaultDataDir();
    expect(process.env.SHIFTLOG_DATA_DIR).toBe(
      path.join(homedir(), ".local", "share", "shiftlog"),
    );
  });

  it("does not set a data dir on Vercel", () => {
    clearPersistEnv();
    process.env.VERCEL = "1";
    ensureDefaultDataDir();
    expect(process.env.SHIFTLOG_DATA_DIR).toBeUndefined();
  });
});

describe("resolveDataDir", () => {
  const roots = { home: "/home/ada", repoRoot: "/src/shift-log" };

  it("defaults to ~/.local/share/shiftlog", () => {
    expect(resolveDataDir(undefined, roots)).toBe("/home/ada/.local/share/shiftlog");
    expect(resolveDataDir("   ", roots)).toBe("/home/ada/.local/share/shiftlog");
  });

  it("resolves relative paths from the repo root after chdir", () => {
    const prev = process.cwd();
    process.chdir(tmpdir());
    try {
      expect(resolveDataDir("./data", roots)).toBe("/src/shift-log/data");
      expect(resolveDataDir("data", roots)).toBe("/src/shift-log/data");
    } finally {
      process.chdir(prev);
    }
  });

  it("keeps absolute paths and expands ~", () => {
    expect(resolveDataDir("/var/lib/shiftlog", roots)).toBe("/var/lib/shiftlog");
    expect(resolveDataDir("~", roots)).toBe("/home/ada");
    expect(resolveDataDir("~/.local/share/shiftlog", roots)).toBe(
      "/home/ada/.local/share/shiftlog",
    );
  });

  it("resolveShiftLogDataDir stays on this repo root after chdir", () => {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const repoRoot = findRepoRoot(moduleDir);
    expect(repoRoot).toBeTruthy();
    const prev = process.cwd();
    process.chdir(tmpdir());
    try {
      expect(resolveShiftLogDataDir("./data")).toBe(path.join(repoRoot!, "data"));
    } finally {
      process.chdir(prev);
    }
  });
});

describe("findRepoRoot", () => {
  it("walks up to pnpm-workspace.yaml", () => {
    const root = mkdtempSync(path.join(tmpdir(), "shiftlog-repo-"));
    try {
      mkdirSync(path.join(root, "services", "api", "src", "lib"), { recursive: true });
      writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages: []\n");
      expect(findRepoRoot(path.join(root, "services", "api", "src", "lib"))).toBe(
        path.resolve(root),
      );
      expect(findRepoRoot(path.join(tmpdir(), "shiftlog-missing-root"))).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

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

  it("creates shiftlog.db as 0600", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "shiftlog-persist-mode-"));
    dirs.push(dir);
    delete process.env.VITEST;
    process.env.SHIFTLOG_PERSIST = "1";
    process.env.SHIFTLOG_DATA_DIR = dir;
    resetPersistCache();

    const store = new MemoryStore("alice");
    store.setPermissions(
      PermissionsConfigSchema.parse({ enabled: true, memories_enabled: true }),
    );

    const mode = statSync(path.join(dir, "shiftlog.db")).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
