import type { NextConfig } from "next";

/**
 * Desktop (Tauri) builds a static export that talks to the API directly.
 * Web (Vercel) builds normally and keeps the server-side /api proxy.
 */
const isDesktop = process.env.SHIFTLOG_DESKTOP === "1";

const nextConfig: NextConfig = {
  transpilePackages: ["@shift-log/schema"],
  ...(isDesktop
    ? {
        output: "export" as const,
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
