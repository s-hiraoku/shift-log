import { execFile, spawn } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CREDENTIAL_SERVICE = "shift-log";
export const CREDENTIAL_ACCOUNT = "api-token";

/** `input` is written to stdin so secrets never appear in the process list. */
export type ExecFn = (
  file: string,
  args: string[],
  input?: string,
) => Promise<{ stdout: string; stderr: string }>;

function execWithInput(
  file: string,
  args: string[],
  input: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { timeout: 4000, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${file} exited with ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

const defaultExec: ExecFn = async (file, args, input) => {
  if (input !== undefined) return execWithInput(file, args, input);
  const { stdout, stderr } = await execFileAsync(file, args, {
    timeout: 4000,
    windowsHide: true,
  });
  return { stdout: String(stdout), stderr: String(stderr) };
};

/** Quote one argument for `security -i`, which splits its stdin like a shell. */
function securityQuote(value: string): string {
  return `"${value.replace(/["\\]/g, (c) => `\\${c}`)}"`;
}

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
  // `security -i` reads the command from stdin, so the token stays out of argv.
  const command = [
    "add-generic-password",
    "-U",
    "-s",
    CREDENTIAL_SERVICE,
    "-a",
    CREDENTIAL_ACCOUNT,
    "-w",
    securityQuote(token),
  ].join(" ");
  await exec("security", ["-i"], `${command}\n`);
  // `security -i` exits 0 even when the command inside fails; confirm the write.
  if ((await getMac(exec)) !== token) throw new Error("keychain write not confirmed");
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
  await exec(
    "secret-tool",
    [
      "store",
      "--label=ShiftLog API token",
      "service",
      CREDENTIAL_SERVICE,
      "account",
      CREDENTIAL_ACCOUNT,
    ],
    token,
  );
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
