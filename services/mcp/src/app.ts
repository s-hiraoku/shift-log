import { createHash, timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";
import {
  createMcpHandler,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import { BIND_HOST, MCP_PATH, type McpConfig, type McpToken } from "./config.js";
import { connectShiftLog } from "./shiftlog-api.js";
import { buildServer } from "./tools.js";

export type RunningServer = {
  readonly url: URL;
  close(): Promise<void>;
};

export function startMcpServer(config: McpConfig): Promise<RunningServer> {
  const callApi = connectShiftLog(config);
  const handler = createMcpHandler(() => buildServer(callApi), { legacy: "stateless" });

  const fetch = async (request: Request): Promise<Response> => {
    if (!presentsToken(request.headers.get("authorization"), config.token)) {
      return unauthorized();
    }
    const originRejected = originValidationResponse(request, localhostAllowedOrigins());
    if (originRejected) return originRejected;
    if (new URL(request.url).pathname !== MCP_PATH) {
      return new Response("not found", { status: 404 });
    }
    return handler.fetch(request);
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve(
      { fetch, hostname: BIND_HOST, port: config.port },
      (info) => {
        if (settled) return;
        settled = true;
        const running: RunningServer = {
          url: new URL(`http://${BIND_HOST}:${info.port}${MCP_PATH}`),
          close: () => closeServer(server, handler),
        };
        resolve(running);
      },
    );
    server.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function presentsToken(authorization: string | null, token: McpToken): boolean {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  if (!match?.[1]) return false;
  return hashesEqual(match[1], token);
}

function hashesEqual(presented: string, expected: string): boolean {
  const left = createHash("sha256").update(presented).digest();
  const right = createHash("sha256").update(expected).digest();
  return left.length === right.length && timingSafeEqual(left, right);
}

function unauthorized(): Response {
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="shiftlog-mcp"' } },
  );
}

async function closeServer(
  server: ServerType,
  handler: { close(): Promise<void> },
): Promise<void> {
  await handler.close();
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
