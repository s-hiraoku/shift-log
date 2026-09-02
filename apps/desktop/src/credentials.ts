import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CREDENTIAL_SERVICE = "shift-log";
export const CREDENTIAL_ACCOUNT = "api-token";

export type ExecFn = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFn = async (file, args) => {
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: 4000,
    windowsHide: true,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

function fallbackPath(): string {
  const dir =
    process.env.SHIFTLOG_CREDENTIALS_DIR ??
    path.join(homedir(), ".config", "shiftlog");
  return path.join(dir, "credentials.json");
}

function writeFallback(token: string): void {
  const file = fallbackPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ token }, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

function readFallback(): string | null {
  try {
    const raw = JSON.parse(readFileSync(fallbackPath(), "utf8")) as { token?: string };
    return raw.token || null;
  } catch {
    return null;
  }
}

function clearFallback(): void {
  try {
    unlinkSync(fallbackPath());
  } catch {
    // ignore
  }
}

async function setMac(token: string, exec: ExecFn): Promise<void> {
  await exec("security", [
    "add-generic-password",
    "-U",
    "-s",
    CREDENTIAL_SERVICE,
    "-a",
    CREDENTIAL_ACCOUNT,
    "-w",
    token,
  ]);
}

async function getMac(exec: ExecFn): Promise<string | null> {
  try {
    const { stdout } = await exec("security", [
      "find-generic-password",
      "-s",
      CREDENTIAL_SERVICE,
      "-a",
      CREDENTIAL_ACCOUNT,
      "-w",
    ]);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

async function clearMac(exec: ExecFn): Promise<void> {
  await exec("security", [
    "delete-generic-password",
    "-s",
    CREDENTIAL_SERVICE,
    "-a",
    CREDENTIAL_ACCOUNT,
  ]).catch(() => undefined);
}

async function setLinux(token: string, exec: ExecFn): Promise<void> {
  const quoted = JSON.stringify(token);
  await exec("bash", [
    "-lc",
    `printf %s ${quoted} | secret-tool store --label='ShiftLog API token' service ${CREDENTIAL_SERVICE} account ${CREDENTIAL_ACCOUNT}`,
  ]);
}

async function getLinux(exec: ExecFn): Promise<string | null> {
  try {
    const { stdout } = await exec("secret-tool", [
      "lookup",
      "service",
      CREDENTIAL_SERVICE,
      "account",
      CREDENTIAL_ACCOUNT,
    ]);
    const token = stdout.trim();
    return token || null;
  } catch {
    return null;
  }
}

async function clearLinux(exec: ExecFn): Promise<void> {
  await exec("secret-tool", [
    "clear",
    "service",
    CREDENTIAL_SERVICE,
    "account",
    CREDENTIAL_ACCOUNT,
  ]).catch(() => undefined);
}

/**
 * Store the API token in the OS keychain (macOS Keychain / Linux Secret Service).
 * Falls back to ~/.config/shiftlog/credentials.json (mode 0600) when the OS store is unavailable.
 */
export async function setApiToken(
  token: string,
  opts: { platform?: NodeJS.Platform; exec?: ExecFn } = {},
): Promise<"keychain" | "file"> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  if (!token) throw new Error("token must not be empty");
  try {
    if (platform === "darwin") {
      await setMac(token, exec);
      return "keychain";
    }
    if (platform === "linux") {
      await setLinux(token, exec);
      return "keychain";
    }
  } catch {
    // fall through
  }
  writeFallback(token);
  return "file";
}

export async function getApiToken(
  opts: { platform?: NodeJS.Platform; exec?: ExecFn } = {},
): Promise<string | null> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  try {
    if (platform === "darwin") {
      const t = await getMac(exec);
      if (t) return t;
    } else if (platform === "linux") {
      const t = await getLinux(exec);
      if (t) return t;
    }
  } catch {
    // fall through
  }
  return readFallback();
}

export async function clearApiToken(
  opts: { platform?: NodeJS.Platform; exec?: ExecFn } = {},
): Promise<void> {
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? defaultExec;
  if (platform === "darwin") await clearMac(exec);
  if (platform === "linux") await clearLinux(exec);
  clearFallback();
}

export function fallbackCredentialPath(): string {
  return fallbackPath();
}
