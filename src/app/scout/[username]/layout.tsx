import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPlayerByFideId } from "@/lib/db";
import { parsePlatformUsername } from "@/lib/platform-utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username: rawParam } = await params;
  const { username } = parsePlatformUsername(rawParam);

  return {
    title: `${username} - Chess Scouting Report`,
    description: `Scouting report for ${username}. Openings, weaknesses, playing style, and preparation tips.`,
    alternates: {
      canonical: `https://outprep.xyz/scout/${rawParam}`,
    },
    openGraph: {
      title: `${username} - Scouting Report`,
      description: `Study ${username}'s openings, weaknesses, and playing style.`,
      url: `https://outprep.xyz/scout/${rawParam}`,
      siteName: "outprep",
    },
    twitter: {
      card: "summary_large_image",
      title: `${username} - Scouting Report`,
      description: `Study ${username}'s openings, weaknesses, and playing style.`,
    },
  };
}

export default async function ScoutLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ username: string }>;
}) {
  const { username: rawParam } = await params;
  const { platform, username } = parsePlatformUsername(rawParam);

  // Support fide:{numericId} shorthand — redirect to the full FIDE scout URL with slug
  if (platform === "fide" && /^\d+$/.test(username)) {
    const player = await getPlayerByFideId(username);
    if (player) {
      redirect(`/scout/fide:${player.slug}`);
    }
  }

  return children;
}
