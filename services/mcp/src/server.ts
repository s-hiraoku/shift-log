import { ConfigError, parseConfig } from "./config.js";
import { startMcpServer, type RunningServer } from "./app.js";

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.env, process.argv.slice(2));
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[mcp] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const running = await startMcpServer(config);
  console.log(
    `ShiftLog MCP listening on ${running.url} (read-only; upstream ${config.apiOrigin})`,
  );
  let closing = false;
  const shutdown = (server: RunningServer) => {
    if (closing) return;
    closing = true;
    void server.close().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown(running));
  process.on("SIGTERM", () => shutdown(running));
}

void main();
