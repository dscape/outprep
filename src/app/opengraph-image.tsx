import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const alt = "outprep - Practice Against Any Chess Player";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OGImage() {
  const bold = await readFile(
    join(process.cwd(), "src/assets/fonts/Geist-Bold.ttf"),
  );

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
          fontFamily: "Geist",
          gap: 20,
        }}
      >
        {/* Name */}
        <span
          style={{
            color: "#ffffff",
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          outprep
        </span>

        {/* Tagline */}
        <span style={{ color: "#a1a1aa", fontSize: 28 }}>
          Scout. Study. Practice.
        </span>

        {/* Description */}
        <span
          style={{
            color: "#52525b",
            fontSize: 20,
            marginTop: 16,
            maxWidth: 600,
            textAlign: "center",
          }}
        >
          Prepare against any chess player with an AI that plays like them
        </span>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Geist", data: bold, style: "normal" as const, weight: 700 as const },
      ],
    },
  );
}
