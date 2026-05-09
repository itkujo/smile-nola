import type { NextConfig } from "next";

const config: NextConfig = {
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
