import { NextRequest, NextResponse } from "next/server";
import { slugContainsExcludedFideId } from "@/lib/player-exclusions";

const BOT_UA = /(?:googlebot|bingbot|slurp|duckduckbot|baiduspider|yandexbot|sogou|exabot|facebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|bytespider|ccbot|gptbot|anthropic-ai|claudebot|perplexitybot|applebot|ia_archiver|archive\.org_bot)/i;

/**
 * Lightweight edge guards for expensive SEO surfaces.
 *
 * The full game archive is intentionally not a search target: crawlers were
 * triggering millions of on-demand ISR writes while barely indexing anything.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Edge-level erasure guard prevents stale ISR/CDN artifacts from serving a
  // configured FIDE identity before a route or database lookup runs.
  if (slugContainsExcludedFideId(pathname)) {
    return excluded();
  }

  if (pathname.startsWith("/scout/")) {
    return redirectLegacyScoutUrl(request);
  }

  if (pathname === "/api/og/game") {
    return gone();
  }

  if (isRetiredSitemapShard(pathname)) {
    return gone();
  }

  if (pathname.startsWith("/game/") && BOT_UA.test(request.headers.get("user-agent") || "")) {
    return gone();
  }

  return NextResponse.next();
}

/**
 * Redirect all /scout/* URLs to /player/*.
 *   /scout/gxdxsx?source=chesscom → /player/chesscom:gxdxsx
 *   /scout/lichess:user → /player/lichess:user
 *   /scout/fide:slug → /player/slug
 *   /scout/bareUsername → /player/lichess:bareUsername
 */
function redirectLegacyScoutUrl(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const rawUsername = pathname.slice("/scout/".length);
  const source = searchParams.get("source");
  const newUrl = request.nextUrl.clone();
  newUrl.searchParams.delete("source");

  if (source && (source === "chesscom" || source === "fide" || source === "pgn")) {
    if (source === "fide") {
      newUrl.pathname = `/player/${rawUsername}`;
    } else {
      newUrl.pathname = `/player/${source}:${rawUsername}`;
    }
  } else if (rawUsername.startsWith("fide:")) {
    newUrl.pathname = `/player/${rawUsername.slice("fide:".length)}`;
  } else if (rawUsername.includes(":")) {
    newUrl.pathname = `/player/${rawUsername}`;
  } else {
    newUrl.pathname = `/player/lichess:${rawUsername}`;
  }

  return NextResponse.redirect(newUrl, 301);
}

function isRetiredSitemapShard(pathname: string): boolean {
  const match = pathname.match(/^\/sitemap\/(\d+)\.xml$/);
  return !!match && match[1] !== "0";
}

function excluded() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function gone() {
  return new NextResponse("Gone", {
    status: 410,
    headers: {
      "Cache-Control": "public, max-age=86400",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export const config = {
  matcher: [
    "/scout/:path*",
    "/player/:path*",
    "/play/:path*",
    "/game/:path*",
    "/api/fide-games/:path*",
    "/api/fide-practice/:path*",
    "/api/bot-data/:path*",
    "/api/og/game",
    "/sitemap/:path*",
  ],
};
