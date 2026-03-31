import { NextRequest, NextResponse } from "next/server";
import { fetchLichessUser } from "@/lib/lichess";
import { fetchChesscomUser, fetchChesscomStats } from "@/lib/chesscom";
import { estimateFIDE } from "@/lib/fide-estimator";

const cache = new Map<string, { data: unknown; expires: number }>();
const TTL = 24 * 60 * 60 * 1000;

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (entry && entry.expires > Date.now()) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, expires: Date.now() + TTL });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const platform = request.nextUrl.searchParams.get("platform") || "lichess";
  const cacheKey = `basic:${platform}:${username.toLowerCase()}`;

  try {
    const cached = getCached(cacheKey);
    if (cached) return NextResponse.json(cached);

    let basicProfile;

    if (platform === "chesscom") {
      const [user, stats] = await Promise.all([
        fetchChesscomUser(username),
        fetchChesscomStats(username),
      ]);
      // Sum win+loss+draw across all time controls for total game count
      const totalGames = [stats.chess_bullet, stats.chess_blitz, stats.chess_rapid, stats.chess_daily]
        .reduce((sum, tc) => {
          if (!tc?.record) return sum;
          return sum + tc.record.win + tc.record.loss + tc.record.draw;
        }, 0);

      // Build a LichessUser-compatible shape for estimateFIDE
      const userLike = {
        id: user.username.toLowerCase(),
        username: user.username,
        perfs: {
          blitz: stats.chess_blitz ? { rating: stats.chess_blitz.last.rating, games: (stats.chess_blitz.record?.win ?? 0) + (stats.chess_blitz.record?.loss ?? 0) + (stats.chess_blitz.record?.draw ?? 0), rd: 0, prog: 0 } : undefined,
          rapid: stats.chess_rapid ? { rating: stats.chess_rapid.last.rating, games: (stats.chess_rapid.record?.win ?? 0) + (stats.chess_rapid.record?.loss ?? 0) + (stats.chess_rapid.record?.draw ?? 0), rd: 0, prog: 0 } : undefined,
          classical: stats.chess_daily ? { rating: stats.chess_daily.last.rating, games: (stats.chess_daily.record?.win ?? 0) + (stats.chess_daily.record?.loss ?? 0) + (stats.chess_daily.record?.draw ?? 0), rd: 0, prog: 0 } : undefined,
        },
        count: { all: totalGames, rated: totalGames },
      };
      basicProfile = {
        username: user.username,
        ratings: {
          bullet: stats.chess_bullet?.last?.rating,
          blitz: stats.chess_blitz?.last?.rating,
          rapid: stats.chess_rapid?.last?.rating,
          classical: stats.chess_daily?.last?.rating,
        },
        totalGames,
        fideEstimate: estimateFIDE(userLike),
      };
    } else {
      const user = await fetchLichessUser(username);
      basicProfile = {
        username: user.username,
        ratings: {
          bullet: user.perfs?.bullet?.prov ? undefined : user.perfs?.bullet?.rating,
          blitz: user.perfs?.blitz?.prov ? undefined : user.perfs?.blitz?.rating,
          rapid: user.perfs?.rapid?.prov ? undefined : user.perfs?.rapid?.rating,
          classical: user.perfs?.classical?.prov ? undefined : user.perfs?.classical?.rating,
        },
        totalGames: user.count?.rated ?? user.count?.all ?? 0,
        fideEstimate: estimateFIDE(user),
      };
    }

    setCache(cacheKey, basicProfile);
    return NextResponse.json(basicProfile);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }
    if (message.includes("Rate limited")) {
      return NextResponse.json({ error: message }, { status: 429 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
