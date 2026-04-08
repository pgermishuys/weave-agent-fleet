/**
 * Isolated layout for the login page.
 * Bypasses the main app layout (no sidebar, providers, or data fetching).
 * Uses its own minimal full-screen dark background.
 */

import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "../globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign In — Weave Fleet",
  description: "Sign in to Weave Agent Fleet",
};

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <meta name="referrer" content="no-referrer" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0F172A" />
      </head>
      <body className={`${inter.variable} antialiased bg-slate-950`}>
        {children}
      </body>
    </html>
  );
}
