const colors: Record<string, string> = {
  GM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  IM: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  FM: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  CM: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  WGM: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  WIM: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  WFM: "bg-blue-500/20 text-blue-400 border-blue-500/30",
};

export function TitleBadge({ title }: { title: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
        colors[title] || "bg-zinc-700/50 text-zinc-400 border-zinc-600/30"
      }`}
    >
      {title}
    </span>
  );
}
