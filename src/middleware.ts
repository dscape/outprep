import { NextRequest, NextResponse } from "next/server";

/**
 * Redirect legacy ?source= URLs to the new platform:username format.
 *   /scout/gxdxsx?source=chesscom → /scout/chesscom:gxdxsx
 */
export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname.startsWith("/scout/")) {
    const source = searchParams.get("source");
    if (
      source &&
      (source === "chesscom" || source === "fide" || source === "pgn")
    ) {
      const username = pathname.slice("/scout/".length);
      const newUrl = request.nextUrl.clone();
      newUrl.pathname = `/scout/${source}:${username}`;
      newUrl.searchParams.delete("source");
      return NextResponse.redirect(newUrl, 301);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/scout/:path*",
};
