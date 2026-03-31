import type { OTBProfile } from "@/lib/types";
import type { ErrorProfile, OpeningTrie, GameRecord, StyleMetrics } from "@outprep/engine";
import { buildOpeningTrie, matchesPlayerName } from "@outprep/engine";

export interface BotData {
  errorProfile: ErrorProfile;
  whiteTrie: OpeningTrie;
  blackTrie: OpeningTrie;
  styleMetrics: StyleMetrics;
}

/**
 * Build BotData client-side from PGN-imported OTB games stored in sessionStorage.
 * Used for PGN players who have no server-side data.
 */
export function buildBotDataFromPGN(username: string): BotData | null {
  try {
    const stored = sessionStorage.getItem(`pgn-import:${username}`);
    if (!stored) return null;

    return buildBotDataFromProfile(JSON.parse(stored), username);
  } catch {
    return null;
  }
}

/**
 * Build BotData from an already-parsed OTBProfile.
 * Pure function — no sessionStorage access, testable without browser APIs.
 */
export function buildBotDataFromProfile(otb: OTBProfile, username: string): BotData | null {
  try {
    const gameRecords: GameRecord[] = (otb.games || [])
      .filter((g) => g.moves)
      .map((g) => {
        const isWhite = matchesPlayerName(g.white, username);
        const isBlack = matchesPlayerName(g.black, username);
        const playerIsWhite = isWhite && !isBlack ? true
          : isBlack && !isWhite ? false
          : isWhite;
        return {
          moves: g.moves,
          playerColor: (playerIsWhite ? "white" : "black") as "white" | "black",
          result: g.result === "1-0" ? "white" as const
            : g.result === "0-1" ? "black" as const
            : "draw" as const,
        };
      });

    if (gameRecords.length === 0) return null;

    const whiteTrie = buildOpeningTrie(gameRecords, "white");
    const blackTrie = buildOpeningTrie(gameRecords, "black");

    // Empty error profile — no eval data from PGN
    const emptyPhase = { totalMoves: 0, mistakes: 0, blunders: 0, avgCPL: 0, errorRate: 0, blunderRate: 0 };
    const errorProfile: ErrorProfile = {
      opening: { ...emptyPhase },
      middlegame: { ...emptyPhase },
      endgame: { ...emptyPhase },
      overall: { ...emptyPhase },
      gamesAnalyzed: 0,
    };

    const styleMetrics: StyleMetrics = {
      aggression: 50,
      tactical: 50,
      positional: 50,
      endgame: 50,
      sampleSize: 0,
    };

    return { errorProfile, whiteTrie, blackTrie, styleMetrics };
  } catch {
    return null;
  }
}
