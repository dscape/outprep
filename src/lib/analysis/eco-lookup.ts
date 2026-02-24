/**
 * ECO code → opening move sequence lookup.
 * Uses the Lichess opening explorer API to find the standard moves
 * that lead to a given ECO code.
 */

/**
 * Get the seed moves for an ECO code range.
 * ECO codes map to standard first-move families:
 * - A00-A39: Various non-e4/d4 openings (Nf3, g3, c4, etc.)
 * - A40-A99: 1. d4 (non-QGD)
 * - B00-B99: 1. e4 (non-1...e5)
 * - C00-C99: 1. e4 e5
 * - D00-D99: 1. d4 d5
 * - E00-E99: 1. d4 Nf6 2. c4
 */
function getSeedMoves(eco: string): string[] {
  const letter = eco[0]?.toUpperCase() || "";
  const num = parseInt(eco.substring(1)) || 0;

  if (letter === "A") {
    if (num < 10) return ["g1f3"]; // Reti and English-like
    if (num < 20) return ["c2c4"]; // English Opening
    if (num < 40) return ["g1f3"]; // Various Nf3 systems
    return ["d2d4"]; // A40+ = 1. d4 (Indian systems, etc.)
  }
  if (letter === "B") return ["e2e4"]; // Sicilian, Caro-Kann, etc.
  if (letter === "C") return ["e2e4", "e7e5"]; // Open games
  if (letter === "D") return ["d2d4", "d7d5"]; // Queen's Gambit, Slav, etc.
  if (letter === "E") return ["d2d4", "g8f6", "c2c4"]; // Indian defenses

  return [];
}

/**
 * Look up the standard move sequence for an ECO code using the Lichess
 * opening explorer. Iteratively follows the most popular moves from the
 * seed position until the opening's ECO matches the target.
 *
 * @returns UCI moves array, or empty array if not found
 */
export async function getOpeningMoves(eco: string): Promise<string[]> {
  // Check sessionStorage cache first
  try {
    const cached = sessionStorage.getItem(`eco-moves:${eco}`);
    if (cached) return JSON.parse(cached);
  } catch {
    // Ignore — SSR or storage unavailable
  }

  try {
    const moves = getSeedMoves(eco);
    if (moves.length === 0) return [];

    // Check if the seed moves already match
    const initial = await queryExplorer(moves);
    if (initial?.opening?.eco === eco) {
      cacheEcoMoves(eco, moves);
      return moves;
    }

    // Iteratively follow the most popular moves
    for (let depth = 0; depth < 12; depth++) {
      const data = await queryExplorer(moves);
      if (!data) break;

      // Check if we've reached the target ECO
      if (data.opening?.eco === eco) {
        cacheEcoMoves(eco, moves);
        return moves;
      }

      // Follow the most popular next move
      if (!data.moves || data.moves.length === 0) break;

      // Try each candidate move to see if it gets us to the target ECO
      let found = false;
      for (const candidate of data.moves.slice(0, 3)) {
        const testMoves = [...moves, candidate.uci];
        const testData = await queryExplorer(testMoves);
        if (testData?.opening?.eco === eco) {
          moves.push(candidate.uci);
          cacheEcoMoves(eco, moves);
          return moves;
        }
        // If the ECO letter matches, this might be on the right path
        if (
          testData?.opening?.eco &&
          testData.opening.eco[0] === eco[0] &&
          !found
        ) {
          moves.push(candidate.uci);
          found = true;
          break;
        }
      }

      // If no candidate matched, follow the most popular move
      if (!found) {
        moves.push(data.moves[0].uci);
      }
    }

    // Final check
    const finalData = await queryExplorer(moves);
    if (finalData?.opening?.eco === eco) {
      cacheEcoMoves(eco, moves);
      return moves;
    }

    // Return whatever moves we have — they're likely close to the target
    cacheEcoMoves(eco, moves);
    return moves;
  } catch {
    return [];
  }
}

/** Cache ECO → moves mapping in sessionStorage */
function cacheEcoMoves(eco: string, moves: string[]): void {
  try {
    sessionStorage.setItem(`eco-moves:${eco}`, JSON.stringify(moves));
  } catch {
    // Storage full or SSR — non-fatal
  }
}

interface ExplorerResponse {
  opening?: { eco: string; name: string };
  moves: Array<{ uci: string; san: string; white: number; draws: number; black: number }>;
}

async function queryExplorer(uciMoves: string[]): Promise<ExplorerResponse | null> {
  try {
    const play = uciMoves.join(",");
    const url = `https://explorer.lichess.ovh/masters?play=${play}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}
