import { NextResponse } from "next/server";
import { listGamePlayers } from "@/lib/forge";
import { spawn } from "child_process";
import path from "path";

const PROJECT_ROOT = process.cwd();
const FORGE_CLI = path.join(PROJECT_ROOT, "packages", "forge", "src", "cli.ts");

export async function GET() {
  const players = listGamePlayers();
  return NextResponse.json(players);
}

export async function POST(request: Request) {
  try {
    const { username } = await request.json();

    if (!username || typeof username !== "string" || !username.trim()) {
      return NextResponse.json(
        { error: "username is required" },
        { status: 400 }
      );
    }

    const trimmed = username.trim();

    const result = await new Promise<string>((resolve, reject) => {
      const args = ["tsx", FORGE_CLI, "fetch", trimmed];
      const child = spawn("npx", args, {
        cwd: PROJECT_ROOT,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || `Process exited with code ${code}`));
        }
      });

      child.on("error", reject);
    });

    // The last line of stdout is the JSON metadata
    const lines = result.trim().split("\n");
    const jsonLine = lines[lines.length - 1];
    const playerData = JSON.parse(jsonLine);

    return NextResponse.json(playerData);
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}
