import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Note: COEP/COOP headers removed — the stockfish.js build is single-threaded
  // (no SharedArrayBuffer) so cross-origin isolation is not needed, and COEP
  // blocks Worker creation from static files in Turbopack dev.
};

export default nextConfig;
