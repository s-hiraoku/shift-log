import type { NextConfig } from "next";

const apiOrigin = process.env.SHIFTLOG_API_ORIGIN ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  transpilePackages: ["@shift-log/schema"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin}/:path*`,
      },
    ];
  },
};

export default nextConfig;
