import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

if (!process.env.SHIFTLOG_DATA_DIR) {
  process.env.SHIFTLOG_DATA_DIR = path.resolve("data");
}

const app = createApp();
console.log(`ShiftLog data dir: ${process.env.SHIFTLOG_DATA_DIR}`);
const port = Number(process.env.PORT ?? 8787);

console.log(`ShiftLog API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
