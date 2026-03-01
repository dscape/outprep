import { NextRequest } from "next/server";

/**
 * Server-side proxy for Lichess PGN import.
 * The Lichess API blocks cross-origin POST requests from browsers (CORS),
 * so we relay through our own server.
 */
export async function POST(req: NextRequest) {
  try {
    const { pgn } = (await req.json()) as { pgn?: string };
    if (!pgn) {
      return Response.json({ error: "Missing pgn field" }, { status: 400 });
    }

    const res = await fetch("https://lichess.org/api/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ pgn }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `Lichess import failed: ${res.status}`, details: text },
        { status: res.status }
      );
    }

    const data = await res.json();
    return Response.json(data);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  }
}
