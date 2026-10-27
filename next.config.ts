import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The app is fully dynamic and per-user (authenticated), so Cache Components /
  // partial prefetching are intentionally not enabled.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
