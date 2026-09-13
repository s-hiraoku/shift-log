import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertAuthConfigured } from "./middleware/auth.js";
import { resolveShiftLogDataDir } from "./lib/persist.js";
import { purgeAllTenants } from "./lib/store.js";

assertAuthConfigured();

if (!process.env.DATABASE_URL) {
  process.env.SHIFTLOG_DATA_DIR = resolveShiftLogDataDir(process.env.SHIFTLOG_DATA_DIR);
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
  console.log(`[retention] purged ${removed} expired raw window(s) or ten-minute memor(ies)`);
}
const sweepMs = Number(process.env.SHIFTLOG_RETENTION_SWEEP_MS ?? 60 * 60 * 1000);
setInterval(() => {
  const n = purgeAllTenants();
  if (n > 0) {
    console.log(`[retention] purged ${n} expired raw window(s) or ten-minute memor(ies)`);
  }
}, sweepMs).unref();

const port = Number(process.env.PORT ?? 8787);
console.log(`ShiftLog API listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
