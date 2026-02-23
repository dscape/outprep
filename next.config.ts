import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  // Allow SharedArrayBuffer for Stockfish WASM
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Cross-Origin-Embedder-Policy",
          value: "require-corp",
        },
        {
          key: "Cross-Origin-Opener-Policy",
          value: "same-origin",
        },
      ],
    },
  ],
};

export default nextConfig;
