import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DM_Sans, Space_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import Providers from "./providers";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="bg" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#0d0b1e"/><stop offset="100%" stop-color="#1a1248"/></linearGradient><linearGradient id="hg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#c4b5fd"/><stop offset="100%" stop-color="#7c6cf0"/></linearGradient><linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e0d9ff"/><stop offset="100%" stop-color="#a78bfa"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="1.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><rect width="32" height="32" rx="7" fill="url(#bg)"/><rect width="32" height="32" rx="7" fill="#7c6cf0" opacity="0.06"/><polygon points="16,2 27.5,8.5 27.5,23.5 16,30 4.5,23.5 4.5,8.5" fill="#7c6cf0" opacity="0.08"/><polygon points="16,2 27.5,8.5 27.5,23.5 16,30 4.5,23.5 4.5,8.5" fill="none" stroke="url(#hg)" stroke-width="1.6" opacity="0.9"/><path d="M9 16.5 L13.5 21.5 L23 11" stroke="#7c6cf0" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.35" filter="url(#glow)"/><path d="M9 16.5 L13.5 21.5 L23 11" stroke="url(#cg)" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const FAVICON_URI = `data:image/svg+xml;base64,${Buffer.from(FAVICON_SVG).toString("base64")}`;

export const metadata: Metadata = {
  title: "VRYFD — Decentralized Attendance",
  description: "Check in with your ENS identity. Earn soulbound POAPs. Unlock milestone rewards. Get verifiable certificates.",
  icons: {
    icon: [{ url: FAVICON_URI, type: "image/svg+xml" }],
    shortcut: FAVICON_URI,
    apple: FAVICON_URI,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmSans.variable} ${spaceMono.variable}`}>
      <head>
        <link rel="icon" type="image/svg+xml" href={FAVICON_URI} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Analytics />
      </body>
    </html>
  );
}
