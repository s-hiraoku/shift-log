import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CREDENTIAL_ACCOUNT,
  CREDENTIAL_SERVICE,
  clearApiToken,
  getApiToken,
  setApiToken,
  type ExecFn,
} from "./credentials.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.SHIFTLOG_CREDENTIALS_DIR;
});

function tempCredDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "shiftlog-cred-"));
  dirs.push(dir);
  process.env.SHIFTLOG_CREDENTIALS_DIR = dir;
  return dir;
}

describe("credentials", () => {
  it("stores via macOS Keychain when security succeeds", async () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (file, args) => {
      calls.push([file, ...args]);
      return { stdout: "stored-token\n", stderr: "" };
    };
    const where = await setApiToken("stored-token", { platform: "darwin", exec });
    expect(where).toBe("keychain");
    expect(calls[0]?.[0]).toBe("security");
    expect(calls[0]).toContain(CREDENTIAL_SERVICE);
    expect(calls[0]).toContain(CREDENTIAL_ACCOUNT);

    const token = await getApiToken({ platform: "darwin", exec });
    expect(token).toBe("stored-token");
  });

  it("falls back to a 0600 file when the OS store is missing", async () => {
    tempCredDir();
    const exec: ExecFn = async () => {
      throw new Error("secret-tool: not found");
    };
    const where = await setApiToken("file-token", { platform: "linux", exec });
    expect(where).toBe("file");
    expect(await getApiToken({ platform: "linux", exec })).toBe("file-token");
    await clearApiToken({ platform: "linux", exec });
    expect(await getApiToken({ platform: "linux", exec })).toBeNull();
  });
});
