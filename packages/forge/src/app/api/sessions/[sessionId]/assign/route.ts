import { NextRequest, NextResponse } from "next/server";
import { loadForgeState } from "@/lib/forge";
import fs from "fs";
import path from "path";

const FORGE_ROOT = process.env.FORGE_DATA_DIR || process.cwd();
const STATE_PATH = path.join(FORGE_ROOT, "forge-state.json");
const PIDS_DIR = path.join(FORGE_ROOT, ".pids");

function isAgentProcessRunning(agentId: string): boolean {
  try {
    const raw = fs.readFileSync(path.join(PIDS_DIR, `agent-${agentId}.pid`), "utf-8");
    const pid = parseInt(raw.trim(), 10);
    if (!Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const body = await request.json();
  const { agentId } = body as { agentId: string };

  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }

  const state = loadForgeState();
  const session = state.sessions.find((s) => s.id === sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const agent = state.agents.find((a) => a.id === agentId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  // Check session isn't locked by a running agent
  if (session.agentId && session.agentId !== agentId) {
    const ownerAgent = state.agents.find((a) => a.id === session.agentId);
    if (ownerAgent && isAgentProcessRunning(ownerAgent.id)) {
      return NextResponse.json(
        { error: `Session is active on running agent "${ownerAgent.name}"` },
        { status: 409 },
      );
    }
  }

  // Assign
  session.agentId = agentId;
  agent.currentSessionId = sessionId;
  agent.updatedAt = new Date().toISOString();
  session.updatedAt = new Date().toISOString();

  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  return NextResponse.json({ ok: true });
}
