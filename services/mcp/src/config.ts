export const BIND_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8790;
export const DEFAULT_API_ORIGIN = "http://127.0.0.1:8787";
export const MCP_PATH = "/mcp";

const RESERVED_PORTS = new Set([8787, 8788, 8765, 8791]);
const MIN_TOKEN_LENGTH = 32;
const DEV_TOKEN = "dev-token";

declare const mcpTokenBrand: unique symbol;
declare const apiTokenBrand: unique symbol;

/** What a remote MCP client presents. Only parseConfig mints one. */
export type McpToken = string & { readonly [mcpTokenBrand]: true };

/** What this server presents to the ShiftLog API. Never accepted inbound. */
export type ApiToken = string & { readonly [apiTokenBrand]: true };

export type McpConfig = {
  readonly token: McpToken;
  readonly apiToken: ApiToken;
  readonly apiOrigin: string;
  /** 0 asks the OS for a free port. Tests use it. */
  readonly port: number;
};

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

export function parseConfig(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): McpConfig {
  const token = readMcpToken(env);
  const apiToken = readApiToken(env, token);
  return {
    token,
    apiToken,
    apiOrigin: readOrigin(env),
    port: readPort(env, argv),
  };
}

function readMcpToken(env: Readonly<Record<string, string | undefined>>): McpToken {
  const raw = env.SHIFTLOG_MCP_TOKEN;
  if (!raw) {
    throw new ConfigError("SHIFTLOG_MCP_TOKEN must be set. Refusing to start.");
  }
  if (raw === DEV_TOKEN) {
    throw new ConfigError(
      "SHIFTLOG_MCP_TOKEN must not be the dev-token placeholder. Refusing to start.",
    );
  }
  if (raw.length < MIN_TOKEN_LENGTH) {
    throw new ConfigError(
      "SHIFTLOG_MCP_TOKEN must be at least 32 characters. Refusing to start.",
    );
  }
  return raw as McpToken;
}

function readApiToken(
  env: Readonly<Record<string, string | undefined>>,
  mcpToken: McpToken,
): ApiToken {
  const raw = env.SHIFTLOG_API_TOKEN;
  if (!raw) {
    throw new ConfigError("SHIFTLOG_API_TOKEN must be set. Refusing to start.");
  }
  if (raw === mcpToken) {
    throw new ConfigError(
      "SHIFTLOG_MCP_TOKEN must differ from SHIFTLOG_API_TOKEN. Refusing to start.",
    );
  }
  return raw as ApiToken;
}

function readOrigin(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.SHIFTLOG_API_ORIGIN || DEFAULT_API_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError("SHIFTLOG_API_ORIGIN must be an http(s) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("SHIFTLOG_API_ORIGIN must be http or https.");
  }
  if (url.username || url.password) {
    throw new ConfigError("SHIFTLOG_API_ORIGIN must not include credentials.");
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new ConfigError("SHIFTLOG_API_ORIGIN must not include a path.");
  }
  return url.origin;
}

function readPort(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): number {
  let flag: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg !== "--port") {
      throw new ConfigError(`unknown argument: ${arg}`);
    }
    if (flag !== undefined) {
      throw new ConfigError("duplicate --port");
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new ConfigError("--port requires a value");
    }
    flag = value;
    i += 1;
  }
  const raw = flag ?? (env.SHIFTLOG_MCP_PORT || undefined) ?? String(DEFAULT_PORT);
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError("SHIFTLOG_MCP_PORT must be an integer from 0 to 65535.");
  }
  const port = Number(raw);
  if (port > 65535) {
    throw new ConfigError("SHIFTLOG_MCP_PORT must be an integer from 0 to 65535.");
  }
  if (RESERVED_PORTS.has(port)) {
    throw new ConfigError(`port ${port} is reserved.`);
  }
  return port;
}
