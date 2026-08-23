import { Chess } from "chess.js";
import {
  getEcoStartingMoves,
  getOpeningFamilyMoves,
} from "./eco-classifier";

/**
 * Resolve the minimum move sequence needed to enter an opening family.
 *
 * The opening name is authoritative because repertoire rows are grouped by
 * family. The ECO code is only a fallback for old/direct links that do not
 * include an opening name.
 */
export async function getOpeningMoves(
  eco: string,
  openingName?: string,
): Promise<string[]> {
  const familyMoves = openingName ? getOpeningFamilyMoves(openingName) : [];
  const sanMoves = familyMoves.length > 0
    ? familyMoves
    : getEcoStartingMoves(eco);

  return sanToUci(sanMoves);
}

function sanToUci(sanMoves: string[]): string[] {
  const chess = new Chess();
  const uciMoves: string[] = [];

  try {
    for (const san of sanMoves) {
      const move = chess.move(san);
      if (!move) return [];
      uciMoves.push(`${move.from}${move.to}${move.promotion ?? ""}`);
    }
  } catch {
    return [];
  }

  return uciMoves;
}
