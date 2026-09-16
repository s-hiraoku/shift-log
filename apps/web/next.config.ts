import type { NextConfig } from "next";
import "../../scripts/load-root-env.mjs";

/** Next.js requires distDir to stay inside the app directory (no absolute / `..`). */
function resolveDistDir(): string {
  const raw = process.env.SHIFTLOG_NEXT_DIST_DIR?.trim();
  if (!raw) return ".next";
  if (raw.startsWith("/") || raw.split(/[\\/]/).includes("..")) {
    throw new Error(
      "SHIFTLOG_NEXT_DIST_DIR must be a relative path inside apps/web (no ..).",
    );
  }
  return raw;
}

const nextConfig: NextConfig = {
  transpilePackages: ["@shift-log/schema"],
  distDir: resolveDistDir(),
  // Next 16.3 otherwise writes apps/web/AGENTS.md + CLAUDE.md on every `next dev`.
  agentRules: false,
};

export default nextConfig;
