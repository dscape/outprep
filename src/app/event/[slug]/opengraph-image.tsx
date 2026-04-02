import { ImageResponse } from "next/og";
import { getEvent, formatPlayerName } from "@/lib/db";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "Chess tournament";
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

function formatDate(date: string): string {
  const [y, m, d] = date.split(".");
  if (!y || !m || !d) return date;
  const dt = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function OGImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const event = await getEvent(slug);
  const fonts = await loadFonts();

  if (!event) {
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
            Event not found
          </span>
        </div>
      ),
      { ...size, fonts },
    );
  }

  const dateRange =
    event.dateStart && event.dateEnd
      ? event.dateStart === event.dateEnd
        ? formatDate(event.dateStart)
        : `${formatDate(event.dateStart)} – ${formatDate(event.dateEnd)}`
      : event.dateEnd
        ? formatDate(event.dateEnd)
        : null;

  const topPlayers = event.players.slice(0, 5);

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
        {/* Event Name */}
        <span
          style={{
            color: "#ffffff",
            fontSize: event.name.length > 40 ? 38 : 48,
            fontWeight: 700,
            lineClamp: 2,
          }}
        >
          {event.name}
        </span>

        {/* Location + Date */}
        <div
          style={{
            color: "#a1a1aa",
            fontSize: 22,
            marginTop: 12,
            display: "flex",
            gap: 8,
          }}
        >
          {event.site && <span style={{ color: "#d4d4d8" }}>{event.site}</span>}
          {event.site && dateRange && <span>·</span>}
          {dateRange && <span>{dateRange}</span>}
        </div>

        {/* Stats */}
        <div
          style={{
            display: "flex",
            gap: 48,
            marginTop: 50,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span style={{ color: "#4ade80", fontSize: 56, fontWeight: 700 }}>
              {event.gameCount}
            </span>
            <span
              style={{
                color: "#71717a",
                fontSize: 14,
                letterSpacing: "0.1em",
                marginTop: 4,
              }}
            >
              GAMES
            </span>
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <span style={{ color: "#60a5fa", fontSize: 56, fontWeight: 700 }}>
              {event.players.length}
            </span>
            <span
              style={{
                color: "#71717a",
                fontSize: 14,
                letterSpacing: "0.1em",
                marginTop: 4,
              }}
            >
              PLAYERS
            </span>
          </div>
          {event.avgElo && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
            >
              <span style={{ color: "#fbbf24", fontSize: 56, fontWeight: 700 }}>
                {event.avgElo}
              </span>
              <span
                style={{
                  color: "#71717a",
                  fontSize: 14,
                  letterSpacing: "0.1em",
                  marginTop: 4,
                }}
              >
                AVG ELO
              </span>
            </div>
          )}
        </div>

        {/* Top Players */}
        {topPlayers.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 40,
              flexWrap: "wrap",
            }}
          >
            {topPlayers.map((p) => (
              <div
                key={p.slug}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(63,63,70,0.3)",
                  border: "1px solid rgba(113,113,122,0.3)",
                  borderRadius: 8,
                  padding: "6px 14px",
                  fontSize: 18,
                }}
              >
                {p.title && (
                  <span
                    style={{
                      color: "#22c55e",
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    {p.title}
                  </span>
                )}
                <span style={{ color: "#d4d4d8" }}>
                  {formatPlayerName(p.name)}
                </span>
                <span style={{ color: "#71717a", fontSize: 14 }}>
                  {p.fideRating}
                </span>
              </div>
            ))}
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
