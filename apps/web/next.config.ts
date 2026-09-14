import type { NextConfig } from "next";
import "../../scripts/load-root-env.mjs";

const nextConfig: NextConfig = {
  transpilePackages: ["@shift-log/schema"],
};

export default nextConfig;
