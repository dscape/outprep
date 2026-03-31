/** Minimal profile info needed by the play page */
export interface PlayProfile {
  username: string;
  fideEstimate: { rating: number };
}

/**
 * Parse a profile API response that may be either:
 * - Standard JSON (in-memory cache hit)
 * - NDJSON stream (DB cache or fresh fetch)
 *
 * Extracts username + fideEstimate for the play page.
 */
export function parsePlayProfile(
  text: string,
  fallbackUsername: string,
): PlayProfile {
  const fallback: PlayProfile = { username: fallbackUsername, fideEstimate: { rating: 0 } };

  if (!text || !text.trim()) return fallback;

  // Try standard JSON first (in-memory cached path returns application/json)
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && data.fideEstimate) {
      return {
        username: data.username ?? fallbackUsername,
        fideEstimate: data.fideEstimate,
      };
    }
    // Wrapped in { type: "profile", profile: {...} } — single NDJSON line parsed as JSON
    if (data?.profile?.fideEstimate) {
      return {
        username: data.profile.username ?? fallbackUsername,
        fideEstimate: data.profile.fideEstimate,
      };
    }
    return fallback;
  } catch {
    // Not valid JSON — try NDJSON
  }

  try {
    const lines = text.trim().split("\n");
    let username = fallbackUsername;
    let fideEstimate: { rating: number } | null = null;

    for (const line of lines) {
      if (!line.trim()) continue;
      const chunk = JSON.parse(line);

      // The "openings" chunk has fideEstimate and username at the top level
      if (chunk.type === "openings") {
        if (chunk.fideEstimate) fideEstimate = chunk.fideEstimate;
        if (chunk.username) username = chunk.username;
      }

      // The "profile" chunk wraps the full PlayerProfile
      if (chunk.type === "profile" && chunk.profile) {
        if (chunk.profile.fideEstimate) fideEstimate = chunk.profile.fideEstimate;
        if (chunk.profile.username) username = chunk.profile.username;
      }
    }

    return { username, fideEstimate: fideEstimate ?? { rating: 0 } };
  } catch {
    return fallback;
  }
}
