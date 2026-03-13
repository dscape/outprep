"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/", label: "Sessions" },
  { href: "/agents", label: "Agents" },
  { href: "/requests", label: "Requests" },
  { href: "/tasks", label: "Tasks" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/data", label: "Data" },
];

export function ForgeNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-1 border-b border-zinc-800 pb-px">
      {tabs.map((tab) => {
        const active =
          tab.href === "/"
            ? pathname === "/" || (!pathname.startsWith("/knowledge") && !pathname.startsWith("/data") && !pathname.startsWith("/agents") && !pathname.startsWith("/requests") && !pathname.startsWith("/tasks"))
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
