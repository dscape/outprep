/**
 * Anthropic Sandbox Runtime integration.
 *
 * Wraps @anthropic-ai/sandbox-runtime to enforce OS-level filesystem
 * and network restrictions on agent subprocesses (eval workers, claude -p).
 * Translates SessionPermissions into SandboxRuntimeConfig.
 */

import {
  SandboxManager,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import type { SessionPermissions } from "../tools/permissions";

/* ── State ──────────────────────────────────────────────── */

let initialized = false;

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

function toSandboxConfig(perms: SessionPermissions): SandboxRuntimeConfig {
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
  if (!SandboxManager.isSupportedPlatform()) {
    console.warn("  ⚠ Sandbox runtime: platform not supported, running without sandbox");
    return;
  }

  const config = toSandboxConfig(perms);
  try {
    await SandboxManager.initialize(config);
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
    return await SandboxManager.wrapWithSandbox(command);
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
    await SandboxManager.reset();
  } catch {
    // ignore cleanup errors
  }
  initialized = false;
}
