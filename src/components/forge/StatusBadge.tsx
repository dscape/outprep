import type { SessionStatus } from "@/lib/forge-types";

const styles: Record<SessionStatus, string> = {
  active: "bg-emerald-900/50 text-emerald-400 border-emerald-800",
  paused: "bg-amber-900/50 text-amber-400 border-amber-800",
  completed: "bg-blue-900/50 text-blue-400 border-blue-800",
  abandoned: "bg-red-900/50 text-red-400 border-red-800",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}
