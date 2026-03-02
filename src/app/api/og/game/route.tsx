import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getGame, formatPlayerName } from "@/lib/db";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const size = { width: 1200, height: 630 };

async function loadFonts() {
  const [bold, regular] = await Promise.all([
    readFile(join(process.cwd(), "src/assets/fonts/Geist-Bold.ttf")),
    readFile(join(process.cwd(), "src/assets/fonts/Geist-Regular.ttf")),
  ]);
  return [
    { name: "Geist", data: bold, style: "normal" as const, weight: 700 as const },
    { name: "Geist", data: regular, style: "normal" as const, weight: 400 as const },
  ];
}

function resultDisplay(result: string) {
  switch (result) {
    case "1-0":
      return { text: "1 — 0", label: "White wins", color: "#4ade80" };
    case "0-1":
      return { text: "0 — 1", label: "Black wins", color: "#4ade80" };
    case "1/2-1/2":
      return { text: "½ — ½", label: "Draw", color: "#a1a1aa" };
    default:
      return { text: result, label: "", color: "#a1a1aa" };
  }
}

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");
  if (!slug) {
    return new Response("Missing slug", { status: 400 });
  }

  const game = await getGame(slug);
  const fonts = await loadFonts();

  if (!game) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#09090b",
            fontFamily: "Geist",
          }}
        >
          <span style={{ color: "#a1a1aa", fontSize: 40 }}>
            Game not found
          </span>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const white = formatPlayerName(game.whiteName);
  const black = formatPlayerName(game.blackName);
  const result = resultDisplay(game.result);
  const year = game.date.split(".")[0];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #18181b 0%, #09090b 100%)",
          padding: "50px 60px",
          fontFamily: "Geist",
        }}
      >
        {/* Event + Date */}
        <div
          style={{
            color: "#71717a",
            fontSize: 22,
            marginBottom: 30,
            display: "flex",
            gap: 8,
          }}
        >
          <span>{game.event}</span>
          {game.round && <span>· Round {game.round}</span>}
          <span>· {year}</span>
        </div>

        {/* Players */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 40,
          }}
        >
          {/* White */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {game.whiteTitle && (
                <span
                  style={{
                    color: "#22c55e",
                    fontSize: 24,
                    fontWeight: 700,
                    background: "rgba(34,197,94,0.1)",
                    padding: "2px 10px",
                    borderRadius: 6,
                  }}
                >
                  {game.whiteTitle}
                </span>
              )}
              <span
                style={{ color: "#ffffff", fontSize: 38, fontWeight: 700 }}
              >
                {white}
              </span>
            </div>
            <span style={{ color: "#a1a1aa", fontSize: 22 }}>
              {game.whiteElo}
            </span>
          </div>

          {/* vs */}
          <span
            style={{
              color: "#3f3f46",
              fontSize: 28,
              fontWeight: 400,
            }}
          >
            vs
          </span>

          {/* Black */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {game.blackTitle && (
                <span
                  style={{
                    color: "#22c55e",
                    fontSize: 24,
                    fontWeight: 700,
                    background: "rgba(34,197,94,0.1)",
                    padding: "2px 10px",
                    borderRadius: 6,
                  }}
                >
                  {game.blackTitle}
                </span>
              )}
              <span
                style={{ color: "#ffffff", fontSize: 38, fontWeight: 700 }}
              >
                {black}
              </span>
            </div>
            <span style={{ color: "#a1a1aa", fontSize: 22 }}>
              {game.blackElo}
            </span>
          </div>
        </div>

        {/* Result */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 36,
            gap: 6,
          }}
        >
          <span
            style={{
              color: result.color,
              fontSize: 48,
              fontWeight: 700,
            }}
          >
            {result.text}
          </span>
          <span style={{ color: "#71717a", fontSize: 18 }}>
            {result.label}
          </span>
        </div>

        {/* Opening */}
        {game.opening && (
          <div
            style={{
              display: "flex",
              color: "#a1a1aa",
              fontSize: 20,
              marginTop: 30,
              gap: 8,
            }}
          >
            {game.eco && (
              <span style={{ color: "#d4d4d8", fontWeight: 700 }}>
                {game.eco}
              </span>
            )}
            <span>{game.opening}</span>
            {game.variation && (
              <span style={{ color: "#71717a" }}>: {game.variation}</span>
            )}
          </div>
        )}

        {/* Branding */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: 40,
            right: 60,
            color: "#3f3f46",
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          outprep.xyz
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
