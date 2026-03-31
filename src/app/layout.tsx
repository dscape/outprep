import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { StockfishPreloader } from "@/components/StockfishPreloader";
import { ChunkErrorHandler } from "@/components/ChunkErrorHandler";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://outprep.xyz"),
  title: {
    default: "outprep - Practice Against Any Chess Player",
    template: "%s | outprep",
  },
  description:
    "Scout any chess player, study their openings and weaknesses, then practice against a bot that plays like them.",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://outprep.xyz",
    siteName: "outprep",
    title: "outprep - Practice Against Any Chess Player",
    description:
      "Scout any chess player, study their openings and weaknesses, then practice against a bot that plays like them.",
  },
  twitter: {
    card: "summary_large_image",
    title: "outprep - Practice Against Any Chess Player",
    description:
      "Scout, study, and practice against any chess player.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  alternates: {
    canonical: "https://outprep.xyz",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="dns-prefetch" href="https://lichess.org" />
        <link rel="dns-prefetch" href="https://api.chess.com" />
        <link rel="preconnect" href="https://lichess.org" crossOrigin="anonymous" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        {children}
        <StockfishPreloader />
        <ChunkErrorHandler />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
