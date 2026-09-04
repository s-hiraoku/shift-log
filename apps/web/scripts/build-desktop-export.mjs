#!/usr/bin/env node
/**
 * Build the Next.js UI as a static export for the Tauri desktop app.
 *
 * The desktop app talks to the API directly, so the server-side `/api`
 * proxy route handler is not needed — and route handlers are incompatible
 * with `output: "export"`. We therefore move `app/api` aside for the export
 * and always restore it afterwards (even on failure), so the normal web
 * build is never affected.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const webDir = process.cwd();
const apiDir = path.join(webDir, "app", "api");
const stashedDir = path.join(webDir, "app", "_api.desktop-disabled");

async function main() {
  const hasApi = existsSync(apiDir);
  if (hasApi) {
    await rename(apiDir, stashedDir);
  }
  try {
    const result = spawnSync("next", ["build"], {
      stdio: "inherit",
      env: { ...process.env, SHIFTLOG_DESKTOP: "1" },
      shell: process.platform === "win32",
    });
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } finally {
    if (hasApi && existsSync(stashedDir)) {
      await rename(stashedDir, apiDir);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
