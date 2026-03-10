"use client";

import { useEffect, useState } from "react";
import Toast from "@/components/Toast";

interface OrphanedBranch {
  branch: string;
  path: string;
  command: string;
}

export function OrphanedBranchToast() {
  const [orphaned, setOrphaned] = useState<OrphanedBranch[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Skip if recently dismissed (24h)
    const lastDismissed = localStorage.getItem("forge-orphaned-dismissed");
    if (lastDismissed && Date.now() - Number(lastDismissed) < 24 * 60 * 60 * 1000) {
      return;
    }

    fetch("/api/forge/orphaned-branches")
      .then((r) => r.json())
      .then((data) => {
        if (data.orphaned?.length > 0) {
          setOrphaned(data.orphaned);
        }
      })
      .catch(() => {});
  }, []);

  if (dismissed || orphaned.length === 0) return null;

  return (
    <Toast
      message={`Found ${orphaned.length} orphaned research branch${orphaned.length > 1 ? "es" : ""}. Run \`forge clean\` or remove manually:\n${orphaned.map((o) => o.command).join("\n")}`}
      onDismiss={() => {
        setDismissed(true);
        localStorage.setItem("forge-orphaned-dismissed", String(Date.now()));
      }}
    />
  );
}
