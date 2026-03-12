/**
 * Anthropic Sandbox Runtime integration.
 *
 * Wraps @anthropic-ai/sandbox-runtime to enforce OS-level filesystem
 * and network restrictions on agent subprocesses (eval workers, claude -p).
 * Translates SessionPermissions into SandboxRuntimeConfig.
 *
 * The package is loaded lazily via dynamic import so the agent process
 * doesn't crash if the package can't be resolved (e.g. monorepo hoisting).
 */

import type { SessionPermissions } from "../tools/permissions";

/* ── Minimal type for the subset of SandboxManager we use ─ */

interface SandboxManagerAPI {
  isSupportedPlatform(): boolean;
  initialize(config: Record<string, unknown>): Promise<void>;
  wrapWithSandbox(command: string): Promise<string>;
  reset(): Promise<void>;
}

/* ── State ──────────────────────────────────────────────── */

let initialized = false;

/* ── Lazy loader for optional sandbox dependency ────────── */

let _mgr: SandboxManagerAPI | null = null;
let _loadAttempted = false;

async function getSandboxManager(): Promise<SandboxManagerAPI | null> {
  if (_loadAttempted) return _mgr;
  _loadAttempted = true;
  try {
    const mod = await import("@anthropic-ai/sandbox-runtime");
    _mgr = mod.SandboxManager as SandboxManagerAPI;
  } catch {
    _mgr = null;
  }
  return _mgr;
}

/* ── Sensitive paths denied from reads ──────────────────── */

const SENSITIVE_READ_PATHS = [
  "~/.ssh",
  "~/.aws",
  "~/.gnupg",
  "~/.config/gcloud",
  "~/.docker",
  "~/.kube",
  "~/.npmrc",
  "~/.netrc",
];

/* ── Config translation ─────────────────────────────────── */

function toSandboxConfig(perms: SessionPermissions): Record<string, unknown> {
  return {
    filesystem: {
      denyRead: SENSITIVE_READ_PATHS,
      allowWrite: [...perms.filesystem.writeAllow, "/tmp"],
      denyWrite: [...perms.filesystem.writeDeny],
    },
    network: {
      allowedDomains: [...perms.network.allowedDomains],
      deniedDomains: [...perms.network.deniedDomains],
    },
    ignoreViolations: {
      "*": ["/usr/bin", "/System", "/usr/lib"],
    },
  };
}

/* ── Public API ─────────────────────────────────────────── */

/**
 * Initialize the sandbox runtime for this process.
 * Call once per agent session. Gracefully degrades if unsupported.
 */
export async function initSandboxRuntime(
  perms: SessionPermissions,
): Promise<void> {
  const mgr = await getSandboxManager();
  if (!mgr) {
    console.warn("  ⚠ Sandbox runtime: package not available, running without sandbox");
    return;
  }

  if (!mgr.isSupportedPlatform()) {
    console.warn("  ⚠ Sandbox runtime: platform not supported, running without sandbox");
    return;
  }

  const config = toSandboxConfig(perms);
  try {
    await mgr.initialize(config);
    initialized = true;
    console.log("  ✓ Sandbox runtime initialized");
  } catch (err) {
    console.warn(`  ⚠ Sandbox runtime init failed: ${err}. Running without sandbox.`);
    initialized = false;
  }
}

/**
 * Wrap a command string with sandbox restrictions.
 * Returns the original command unchanged if sandbox is not available.
 */
export async function wrapCommand(command: string): Promise<string> {
  if (!initialized) return command;
  try {
    const mgr = await getSandboxManager();
    if (!mgr) return command;
    return await mgr.wrapWithSandbox(command);
  } catch {
    return command;
  }
}

/**
 * Whether the sandbox runtime was successfully initialized.
 */
export function isSandboxAvailable(): boolean {
  return initialized;
}

/**
 * Clean up sandbox runtime resources. Call at session end.
 */
export async function resetSandboxRuntime(): Promise<void> {
  if (!initialized) return;
  try {
    const mgr = await getSandboxManager();
    if (mgr) await mgr.reset();
  } catch {
    // ignore cleanup errors
  }
  initialized = false;
}
