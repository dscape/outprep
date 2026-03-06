"use client";

import { ReactNode } from "react";
import PlayerCard from "@/components/PlayerCard";
import { useScout } from "./scout-context";

interface PlayerCardHydratorProps {
  children: ReactNode;
  title?: string | null;
  federation?: string;
  fideId?: string;
  winRate?: number;
  drawRate?: number;
  lossRate?: number;
  recentEvents?: string[];
  eventSlugs?: Record<string, string>;
}

export default function PlayerCardHydrator({
  children,
  title,
  federation,
  fideId,
  winRate,
  drawRate,
  lossRate,
  recentEvents,
  eventSlugs,
}: PlayerCardHydratorProps) {
  const { profile, filteredData } = useScout();

  // Until client profile resolves, show SSR children
  if (!profile || !filteredData) return <>{children}</>;

  return (
    <PlayerCard
      profile={profile}
      filteredGames={filteredData.games}
      title={title}
      federation={federation}
      fideId={fideId}
      winRate={winRate}
      drawRate={drawRate}
      lossRate={lossRate}
      recentEvents={recentEvents}
      eventSlugs={eventSlugs}
    />
  );
}
