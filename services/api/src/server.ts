import path from "node:path";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertAuthConfigured } from "./middleware/auth.js";
import { purgeAllTenants } from "./lib/store.js";

assertAuthConfigured();

if (!process.env.SHIFTLOG_DATA_DIR && !process.env.DATABASE_URL) {
  process.env.SHIFTLOG_DATA_DIR = path.resolve("data");
}

const app = createApp();
if (process.env.SHIFTLOG_DATA_DIR) {
  console.log(`ShiftLog data dir: ${process.env.SHIFTLOG_DATA_DIR}`);
}
if (process.env.DATABASE_URL) {
  console.log("ShiftLog persist: DATABASE_URL (Postgres)");
}

const removed = purgeAllTenants();
if (removed > 0) {
  console.log(`[retention] purged ${removed} raw window(s) older than 48h`);
}
const sweepMs = Number(process.env.SHIFTLOG_RETENTION_SWEEP_MS ?? 60 * 60 * 1000);
setInterval(() => {
  const n = purgeAllTenants();
  if (n > 0) console.log(`[retention] purged ${n} raw window(s) older than 48h`);
}, sweepMs).unref();

const port = Number(process.env.PORT ?? 8787);
console.log(`ShiftLog API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
