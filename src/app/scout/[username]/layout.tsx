import { permanentRedirect } from "next/navigation";
import { parsePlatformUsername } from "@/lib/platform-utils";
import { getPlayerByFideId } from "@/lib/db";

/**
 * All /scout/* routes permanently redirect to /player/*.
 * The /scout route is deprecated — all players now live under /player.
 */
export default async function ScoutLayout({
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const { username: rawParam } = await params;
  const { platform, username } = parsePlatformUsername(rawParam);

  if (platform === "fide") {
    // FIDE numeric ID → resolve to slug first
    if (/^\d+$/.test(username)) {
      const player = await getPlayerByFideId(username);
      if (player) {
        permanentRedirect(`/player/${player.slug}`);
      }
    }
    // FIDE slug → redirect without prefix (canonical FIDE URL)
    permanentRedirect(`/player/${username}`);
  }

  // lichess, chesscom, pgn → redirect with platform prefix
  permanentRedirect(`/player/${platform}:${username}`);
}
