import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Allow SharedArrayBuffer for Stockfish WASM on routes that use it.
  // Scoped to avoid blocking Google's renderer on public/SEO pages.
  headers: async () => {
    const coepCoopHeaders = [
      {
        key: "Cross-Origin-Embedder-Policy",
        value: "require-corp",
      },
      {
        key: "Cross-Origin-Opener-Policy",
        value: "same-origin",
      },
    ];
    return [
      { source: "/player/:path*", headers: coepCoopHeaders },
      { source: "/game/:path*", headers: coepCoopHeaders },
      { source: "/analysis/:path*", headers: coepCoopHeaders },
      { source: "/play/:path*", headers: coepCoopHeaders },
      {
        source: "/stockfish.wasm",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/stockfish.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
