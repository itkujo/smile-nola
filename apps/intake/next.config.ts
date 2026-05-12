import type { NextConfig } from "next";

const config: NextConfig = {
  // Standalone output produces a self-contained .next/standalone/ directory
  // with a minimal node_modules tree, suitable for a small production
  // container. See apps/intake/Dockerfile for the multi-stage build.
  output: "standalone",
  // The standalone tracer needs to know where the workspace root is so it
  // can correctly resolve native modules. Without this set, Next emits a
  // warning saying "Next.js inferred your workspace root". Pointing it at
  // the apps/intake directory (the actual app root) silences that and
  // keeps native deps where we expect.
  outputFileTracingRoot: __dirname,
  // better-sqlite3 is a native module; mark as external so Next doesn't try to bundle it
  serverExternalPackages: ["better-sqlite3"],
  // PWA-friendly headers for the kiosk experience
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default config;
