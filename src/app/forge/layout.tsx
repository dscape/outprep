import Link from "next/link";
import type { ReactNode } from "react";
import { ForgeNav } from "./forge-nav";

export default function ForgeLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            &larr; Back
          </Link>
          <h1 className="text-lg font-semibold text-zinc-100">
            Forge Research Dashboard
          </h1>
          <div className="w-16" />
        </div>

        <ForgeNav />

        {children}
      </div>
    </div>
  );
}
