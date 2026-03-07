import { copyFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "stockfish", "bin");
const dest = join(root, "public");

const files = [
  ["stockfish-18-single.js", "stockfish.js"],
  ["stockfish-18-single.wasm", "stockfish.wasm"],
];

for (const [from, to] of files) {
  const target = join(dest, to);
  if (existsSync(target)) continue;
  const source = join(src, from);
  if (!existsSync(source)) {
    console.warn(`stockfish: ${source} not found, skipping`);
    continue;
  }
  copyFileSync(source, target);
  console.log(`stockfish: copied ${from} → public/${to}`);
}

// Optional: optimize WASM with wasm-opt if available (install via: brew install binaryen)
const wasmFile = join(dest, "stockfish.wasm");
if (existsSync(wasmFile)) {
  try {
    execSync("wasm-opt --version", { stdio: "ignore" });
    console.log("stockfish: running wasm-opt -Os (this may take a minute)...");
    execSync(`wasm-opt -Os "${wasmFile}" -o "${wasmFile}"`, {
      stdio: "inherit",
    });
    console.log("stockfish: wasm-opt optimization complete");
  } catch {
    // wasm-opt not installed — skip silently
  }
}
