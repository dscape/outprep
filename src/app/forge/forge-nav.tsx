"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/forge", label: "Sessions" },
  { href: "/forge/knowledge", label: "Knowledge" },
  { href: "/forge/data", label: "Data" },
];

export function ForgeNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-1 border-b border-zinc-800 pb-px">
      {tabs.map((tab) => {
        const active =
          tab.href === "/forge"
            ? pathname === "/forge" || (pathname.startsWith("/forge/") && !pathname.startsWith("/forge/knowledge") && !pathname.startsWith("/forge/data"))
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
              active
                ? "text-zinc-100 bg-zinc-800/50 border-b-2 border-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
