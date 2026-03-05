import { Metadata } from "next";
import { parsePlatformUsername } from "@/lib/platform-utils";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username: rawParam } = await params;
  const { username } = parsePlatformUsername(rawParam);

  return {
    title: `Practice Against ${username}`,
    description: `Play against an AI that mimics ${username}'s playing style. Built from real game analysis.`,
    robots: { index: false, follow: false },
    openGraph: {
      title: `Practice Against ${username}`,
      description: `Play against an AI that mimics ${username}'s playing style.`,
    },
  };
}

export default function PlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
