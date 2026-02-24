import { MoveEval, PlayerProfile, KeyMoment, MomentTag } from "../types";
import { PositionContext } from "./position-classifier";

export function tagMoments(
  moves: MoveEval[],
  contexts: PositionContext[],
  profile: PlayerProfile,
  playerColor: "white" | "black"
): KeyMoment[] {
  const moments: KeyMoment[] = [];
  const contextMap = new Map(contexts.map((c) => [c.ply, c]));

  // Get opponent's known openings
  const opponentOpenings = playerColor === "white"
    ? profile.openings.black
    : profile.openings.white;

  // Get opponent's weaknesses as a Set for fast lookup
  const weaknessAreas = new Set(profile.weaknesses.map((w) => w.area.toLowerCase()));

  for (const move of moves) {
    // Only look at critical moments (eval swing > 50cp)
    if (Math.abs(move.evalDelta) < 50) continue;

    const context = contextMap.get(move.ply);
    const moveNum = Math.ceil(move.ply / 2);
    const isPlayerMove = (playerColor === "white" && move.ply % 2 === 1) ||
                          (playerColor === "black" && move.ply % 2 === 0);

    let tag: MomentTag;
    let description: string;
    let weaknessContext: string | undefined;

    if (!isPlayerMove) {
      // Opponent's move
      if (context?.phase === "opening" && isKnownOpening(move.ply, opponentOpenings)) {
        tag = "EXPECTED";
        description = `Opponent played a known opening line (move ${moveNum}).`;
      } else if (move.classification === "blunder" || move.classification === "mistake") {
        const matchedWeakness = matchWeakness(context, profile, weaknessAreas);
        if (matchedWeakness) {
          tag = "PREDICTED";
          description = `Opponent's ${move.classification} on move ${moveNum}: ${move.san}. Best was ${move.bestMoveSan || move.bestMove}.`;
          weaknessContext = `Consistent with their ${matchedWeakness} weakness`;
        } else if (context?.tacticalMotifs && context.tacticalMotifs.length > 0) {
          tag = "EXPECTED";
          description = `Opponent's ${move.classification} on move ${moveNum}: ${move.san}. Best was ${move.bestMoveSan || move.bestMove}.`;
          weaknessContext = `Missed tactic in the ${context?.phase || "middlegame"}`;
        } else if (context?.phase === "endgame") {
          tag = "EXPECTED";
          description = `Opponent's ${move.classification} on move ${moveNum}: ${move.san}. Best was ${move.bestMoveSan || move.bestMove}.`;
          weaknessContext = "Endgame technique error";
        } else {
          tag = "EXPECTED";
          description = `Opponent's ${move.classification} on move ${moveNum}: ${move.san}. Best was ${move.bestMoveSan || move.bestMove}.`;
          weaknessContext = `Uncharacteristic ${move.classification}`;
        }
      } else {
        tag = "EXPECTED";
        description = `Opponent played ${move.san} on move ${moveNum}.`;
      }
    } else {
      // Player's move
      if (move.classification === "blunder" || move.classification === "mistake") {
        tag = "YOUR ERROR";
        description = `Your ${move.classification} on move ${moveNum}: ${move.san}. Best was ${move.bestMoveSan || move.bestMove}.`;
      } else if (move.evalDelta <= -30 && exploitsWeakness(context, profile, weaknessAreas)) {
        tag = "PREP HIT";
        description = `Great move! You exploited the opponent's known weakness on move ${moveNum}.`;
      } else if (move.evalDelta <= -30 && context?.phase !== "opening") {
        tag = "EXPLOITED";
        description = `Strong move ${move.san} on move ${moveNum} gained a significant advantage.`;
      } else {
        // Inaccuracy (50-100cp loss) — NOT "YOUR ERROR"
        tag = "INACCURACY";
        description = `Inaccuracy on move ${moveNum}: ${move.san}. Best was ${move.bestMoveSan || move.bestMove}.`;
      }
    }

    moments.push({
      moveNum,
      ply: move.ply,
      san: move.san,
      bestMoveSan: (tag === "YOUR ERROR" || tag === "INACCURACY" ||
        move.classification === "blunder" || move.classification === "mistake")
        ? (move.bestMoveSan || move.bestMove)
        : undefined,
      description,
      tag,
      eval: move.eval,
      evalDelta: move.evalDelta,
      weaknessContext,
    });
  }

  // Limit to most important moments
  return moments
    .sort((a, b) => Math.abs(b.evalDelta) - Math.abs(a.evalDelta))
    .slice(0, 10)
    .sort((a, b) => a.moveNum - b.moveNum);
}

function isKnownOpening(ply: number, openings: { eco: string; games: number }[]): boolean {
  // In the opening phase, check if the line played matches known repertoire
  return ply <= 20 && openings.length > 0;
}

function matchWeakness(
  context: PositionContext | undefined,
  profile: PlayerProfile,
  weaknessAreas: Set<string>
): string | null {
  if (!context) return null;

  // Quick check: if no weakness areas match the context at all, bail early
  const hasEndgameWeakness = weaknessAreas.has("endgame conversion");
  const hasTacticalWeakness = weaknessAreas.has("tactical vulnerability");
  const hasPositionalWeakness = weaknessAreas.has("positional understanding");

  if (context.phase === "endgame" && hasEndgameWeakness) {
    return "Endgame Conversion";
  }
  if (hasTacticalWeakness && context.tacticalMotifs.length > 0) {
    return "Tactical Vulnerability";
  }
  if (hasPositionalWeakness && context.pawnStructure !== "standard") {
    return "Positional Understanding";
  }

  // Fall through to check opening-specific weaknesses
  for (const weakness of profile.weaknesses) {
    const area = weakness.area.toLowerCase();
    if (context.phase === "endgame" && area.includes("endgame")) {
      return weakness.area;
    }
    if (area.includes("tactical") && context.tacticalMotifs.length > 0) {
      return weakness.area;
    }
    if (area.includes("positional") && context.pawnStructure !== "standard") {
      return weakness.area;
    }
  }

  return null;
}

function exploitsWeakness(
  context: PositionContext | undefined,
  profile: PlayerProfile,
  weaknessAreas: Set<string>
): boolean {
  if (!context) return false;

  // Fast path using the Set
  if (context.phase === "endgame" && weaknessAreas.has("endgame conversion")) return true;
  if (context.tacticalMotifs.length > 0 && weaknessAreas.has("tactical vulnerability")) return true;

  // Check all weaknesses for opening-specific ones
  for (const weakness of profile.weaknesses) {
    const area = weakness.area.toLowerCase();
    if (context.phase === "endgame" && area.includes("endgame")) return true;
    if (area.includes("tactical") && context.tacticalMotifs.length > 0) return true;
  }

  return false;
}
