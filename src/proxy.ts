import { NextRequest, NextResponse } from "next/server";

/**
 * Redirect all /scout/* URLs to /player/*.
 *   /scout/gxdxsx?source=chesscom → /player/chesscom:gxdxsx
 *   /scout/lichess:user → /player/lichess:user
 *   /scout/fide:slug → /player/slug
 *   /scout/bareUsername → /player/lichess:bareUsername
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname.startsWith("/scout/")) {
    const rawUsername = pathname.slice("/scout/".length);
    const source = searchParams.get("source");
    const newUrl = request.nextUrl.clone();
    newUrl.searchParams.delete("source");

    if (source && (source === "chesscom" || source === "fide" || source === "pgn")) {
      // Legacy ?source= format
      if (source === "fide") {
        newUrl.pathname = `/player/${rawUsername}`;
      } else {
        newUrl.pathname = `/player/${source}:${rawUsername}`;
      }
    } else if (rawUsername.startsWith("fide:")) {
      // /scout/fide:slug → /player/slug (strip fide prefix for canonical URL)
      newUrl.pathname = `/player/${rawUsername.slice("fide:".length)}`;
    } else if (rawUsername.includes(":")) {
      // /scout/lichess:user or /scout/chesscom:user → /player/lichess:user
      newUrl.pathname = `/player/${rawUsername}`;
    } else {
      // /scout/bareUsername → /player/lichess:bareUsername
      newUrl.pathname = `/player/lichess:${rawUsername}`;
    }

    return NextResponse.redirect(newUrl, 301);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/scout/:path*",
};
