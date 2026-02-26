import { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const decoded = decodeURIComponent(username);

  return {
    title: `${decoded} - Chess Scouting Report`,
    description: `Scouting report for ${decoded}. Openings, weaknesses, playing style, and preparation tips.`,
    openGraph: {
      title: `${decoded} - Scouting Report`,
      description: `Study ${decoded}'s openings, weaknesses, and playing style.`,
    },
  };
}

export default function ScoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
