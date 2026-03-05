export type Platform = "lichess" | "chesscom" | "fide" | "pgn";

/**
 * Parse a URL param like "chesscom:gxdxsx" or "lichess:user" into
 * { platform, username }. Bare usernames default to Lichess.
 */
export function parsePlatformUsername(rawParam: string): {
  platform: Platform;
  username: string;
} {
  const decoded = decodeURIComponent(rawParam);
  const colonIndex = decoded.indexOf(":");
  if (colonIndex > 0) {
    const prefix = decoded.substring(0, colonIndex).toLowerCase();
    const username = decoded.substring(colonIndex + 1);
    if (
      prefix === "chesscom" ||
      prefix === "lichess" ||
      prefix === "fide" ||
      prefix === "pgn"
    ) {
      return { platform: prefix as Platform, username };
    }
  }
  return { platform: "lichess", username: decoded };
}

/**
 * Build a scout URL for a given platform and username.
 * Lichess users get bare URLs for cleaner links.
 */
export function buildScoutUrl(
  platform: Platform | string,
  username: string,
): string {
  if (platform === "lichess" || !platform) {
    return `/scout/${encodeURIComponent(username)}`;
  }
  return `/scout/${platform}:${encodeURIComponent(username)}`;
}
