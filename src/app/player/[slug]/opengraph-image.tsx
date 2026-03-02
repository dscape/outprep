import { ImageResponse } from "next/og";
import { getPlayer, formatPlayerName } from "@/lib/db";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Player profile";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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

export default async function OGImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const player = await getPlayer(slug);
  const fonts = await loadFonts();

  if (!player) {
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
            Player not found
          </span>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const name = formatPlayerName(player.name);
  const totalResults = player.winRate + player.drawRate + player.lossRate;

  const ratings: Array<{ label: string; value: number; color: string }> = [];
  if (player.standardRating)
    ratings.push({
      label: "STANDARD",
      value: player.standardRating,
      color: "#4ade80",
    });
  if (player.rapidRating)
    ratings.push({
      label: "RAPID",
      value: player.rapidRating,
      color: "#60a5fa",
    });
  if (player.blitzRating)
    ratings.push({
      label: "BLITZ",
      value: player.blitzRating,
      color: "#fbbf24",
    });
  if (ratings.length === 0)
    ratings.push({
      label: "FIDE RATING",
      value: player.fideRating,
      color: "#4ade80",
    });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(145deg, #18181b 0%, #09090b 100%)",
          padding: "50px 60px",
          fontFamily: "Geist",
        }}
      >
        {/* Title + Name */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {player.title && (
            <span
              style={{
                color: "#22c55e",
                fontSize: 36,
                fontWeight: 700,
                background: "rgba(34,197,94,0.1)",
                padding: "4px 14px",
                borderRadius: 8,
              }}
            >
              {player.title}
            </span>
          )}
          <span style={{ color: "#ffffff", fontSize: 52, fontWeight: 700 }}>
            {name}
          </span>
        </div>

        {/* Federation + Games */}
        <div
          style={{
            color: "#a1a1aa",
            fontSize: 24,
            marginTop: 12,
            display: "flex",
            gap: 8,
          }}
        >
          {player.federation && (
            <span style={{ color: "#d4d4d8" }}>{player.federation}</span>
          )}
          {player.federation && <span>·</span>}
          <span>
            {player.gameCount.toLocaleString()} OTB games analyzed
          </span>
        </div>

        {/* Ratings */}
        <div
          style={{
            display: "flex",
            gap: 48,
            marginTop: 50,
          }}
        >
          {ratings.map((r) => (
            <div
              key={r.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span
                style={{ color: r.color, fontSize: 64, fontWeight: 700 }}
              >
                {r.value}
              </span>
              <span
                style={{
                  color: "#71717a",
                  fontSize: 14,
                  letterSpacing: "0.1em",
                  marginTop: 4,
                }}
              >
                {r.label}
              </span>
            </div>
          ))}
        </div>

        {/* Win/Draw/Loss bar */}
        {totalResults > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 50,
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 24,
                fontSize: 18,
                fontWeight: 400,
              }}
            >
              <span style={{ color: "#4ade80" }}>W {player.winRate}%</span>
              <span style={{ color: "#a1a1aa" }}>D {player.drawRate}%</span>
              <span style={{ color: "#f87171" }}>L {player.lossRate}%</span>
            </div>
            <div
              style={{
                display: "flex",
                width: "100%",
                height: 8,
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${player.winRate}%`,
                  background: "#4ade80",
                }}
              />
              <div
                style={{
                  width: `${player.drawRate}%`,
                  background: "#71717a",
                }}
              />
              <div
                style={{
                  width: `${player.lossRate}%`,
                  background: "#f87171",
                }}
              />
            </div>
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
