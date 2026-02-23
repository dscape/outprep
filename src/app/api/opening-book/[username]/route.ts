import { NextRequest, NextResponse } from "next/server";
import { fetchLichessGames } from "@/lib/lichess";
import { generateOpeningBook } from "@/lib/opening-book";

// In-memory cache for opening books
const cache = new Map<string, { data: Uint8Array; expires: number }>();
const TTL = 24 * 60 * 60 * 1000;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
) {
  const { username } = await params;
  const cacheKey = `book:${username.toLowerCase()}`;

  try {
    const cachedEntry = cache.get(cacheKey);
    if (cachedEntry && cachedEntry.expires > Date.now()) {
      return new NextResponse(Buffer.from(cachedEntry.data), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${username}-book.bin"`,
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    const games = await fetchLichessGames(username, 200);
    const book = generateOpeningBook(games, username);

    cache.set(cacheKey, { data: book, expires: Date.now() + TTL });

    return new NextResponse(Buffer.from(book), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${username}-book.bin"`,
        "Cache-Control": "public, max-age=86400",
      },
    });
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
