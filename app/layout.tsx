import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Clancy — Describe it. Watch it build. Get a live link.",
  description:
    "Autonomous AI agent that builds working projects from plain English descriptions. No code required.",
  metadataBase: new URL("https://clancy-ebon.vercel.app"),
  openGraph: {
    title: "Clancy — Describe it. Watch it build. Get a live link.",
    description:
      "Autonomous AI agent that builds working projects from plain English descriptions. No code required.",
    url: "https://clancy-ebon.vercel.app",
    siteName: "Clancy",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clancy — Describe it. Watch it build. Get a live link.",
    description:
      "Autonomous AI agent that builds working projects from plain English descriptions. No code required.",
    creator: "@OxBenji",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-bg min-h-screen">{children}</body>
    </html>
  );
}
