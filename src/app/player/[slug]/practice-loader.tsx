"use client";

import { useRouter } from "next/navigation";

interface PracticeLoaderProps {
  slug: string;
  playerName: string;
}

export default function PracticeLoader({
  slug,
  playerName,
}: PracticeLoaderProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => router.push(`/play/fide:${encodeURIComponent(slug)}`)}
        className="rounded-lg bg-green-600 px-6 py-3 text-lg font-medium text-white transition-colors hover:bg-green-500"
      >
        Practice Against {playerName}
      </button>
    </div>
  );
}
