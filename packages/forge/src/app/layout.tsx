import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ForgeNav } from "./forge-nav";
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
  title: "Forge Research Dashboard",
  description: "Autonomous research agent dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-950 text-zinc-100`}
      >
        <div className="min-h-screen px-4 py-8">
          <div className="mx-auto max-w-5xl">
            <h1 className="mb-6 text-lg font-semibold text-zinc-100">
              Forge Research Dashboard
            </h1>
            <ForgeNav />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
