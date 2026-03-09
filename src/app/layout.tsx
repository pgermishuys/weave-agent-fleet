import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ClientLayout } from "./client-layout";

// Force dynamic rendering — this app is a live dashboard that polls APIs,
// so static prerendering is not useful and causes _global-error crashes
// with client providers in Next.js 16.
export const dynamic = "force-dynamic";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Weave Agent Fleet",
  description: "Multi-agent orchestration dashboard for Weave — spawn, manage, and coordinate OpenCode sessions across projects.",
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%25' y1='0%25' x2='100%25' y2='100%25'><stop offset='0%25' stop-color='%233B82F6'/><stop offset='50%25' stop-color='%23A855F7'/><stop offset='100%25' stop-color='%23EC4899'/></linearGradient></defs><text x='50' y='75' font-size='80' font-weight='bold' font-family='system-ui' text-anchor='middle' fill='url(%23g)'>W</text></svg>",
        type: "image/svg+xml",
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=JSON.parse(localStorage.getItem('weave-theme'));var h=document.documentElement;if(t==='black'){h.classList.add('dark','theme-black');}else if(t==='light'){h.classList.remove('dark');h.classList.add('theme-light');}else{h.classList.add('dark');}}catch(e){}})();` }} />
      </head>
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
