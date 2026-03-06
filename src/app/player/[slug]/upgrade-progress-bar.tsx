"use client";

import { useScout } from "./scout-context";

export default function UpgradeProgressBar() {
  const { isUpgrading, upgradeProgress } = useScout();

  if (!isUpgrading || !upgradeProgress) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-zinc-800">
      <div
        className="h-full bg-green-500 transition-[width] duration-500"
        style={{ width: `${upgradeProgress.pct}%` }}
      />
    </div>
  );
}
