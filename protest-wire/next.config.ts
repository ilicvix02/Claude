import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This app lives in a sub-folder of a bigger repository: build from here.
  turbopack: { root: process.cwd() },
  outputFileTracingRoot: process.cwd(),
  // PGlite (the zero-setup local database) ships WebAssembly; keep it and the Postgres driver out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  poweredByHeader: false,
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // YouTube embeds need at least the origin as referrer.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
