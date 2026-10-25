import type { Metadata, Viewport } from "next";
import { Archivo, Inter_Tight } from "next/font/google";
import { htmlLang } from "@/lib/i18n.ts";
import { serverLang } from "@/lib/serverLang.ts";
import "./globals.css";

const display = Inter_Tight({ subsets: ["latin", "latin-ext", "cyrillic", "cyrillic-ext", "greek"], weight: ["500", "700", "800"], variable: "--font-display", display: "swap" });
const wide = Archivo({ subsets: ["latin", "latin-ext"], axes: ["wdth"], variable: "--font-wide", display: "swap" });

const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "Protest Wire: the world is rising",
  description: "Raw protest videos from the people in the streets, live from every country. Count yourself in, raise your flag, make it spread.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  openGraph: { type: "website", siteName: "Protest Wire", images: ["/api/og"] },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0A0B0A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await serverLang();
  return (
    <html lang={htmlLang(lang)} className={`${display.variable} ${wide.variable}`}>
      <body>{children}</body>
    </html>
  );
}
