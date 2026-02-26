import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Game Analysis",
  description: "Post-game analysis with move-by-move evaluation and coaching insights.",
  robots: { index: false, follow: false },
};

export default function AnalysisLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
