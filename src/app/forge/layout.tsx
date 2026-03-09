import type { ReactNode } from "react";
import { ForgeNav } from "./forge-nav";

export default function ForgeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-6 text-lg font-semibold text-zinc-100">
          Forge Research Dashboard
        </h1>

        <ForgeNav />

        {children}
      </div>
    </div>
  );
}
