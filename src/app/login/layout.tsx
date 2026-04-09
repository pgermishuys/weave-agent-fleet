/**
 * Nested layout for the login page.
 *
 * This is a child of the root layout (app/layout.tsx) — it must NOT
 * re-declare <html> or <body> tags, as the root layout already provides
 * the document shell.  Re-declaring them causes a hydration mismatch
 * because the server renders the root layout's <body> classes but the
 * client sees the login layout's different classes.
 *
 * Security: adds <meta name="referrer" content="no-referrer"> to prevent
 * the auth token in the URL from leaking via the Referer header.
 */

import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign In — Weave Fleet",
  description: "Sign in to Weave Agent Fleet",
  referrer: "no-referrer",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
