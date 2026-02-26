import { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const decoded = decodeURIComponent(username);

  return {
    title: `Practice Against ${decoded}`,
    description: `Play against an AI that mimics ${decoded}'s playing style. Built from real game analysis.`,
    openGraph: {
      title: `Practice Against ${decoded}`,
      description: `Play against an AI that mimics ${decoded}'s playing style.`,
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
