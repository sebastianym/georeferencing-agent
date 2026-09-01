import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // apps/web sits inside an npm workspaces monorepo, so dependencies like
  // `next` itself get hoisted to the repo root's node_modules — without
  // this, file tracing only looks inside apps/web and the standalone
  // output ends up missing hoisted packages at runtime.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
