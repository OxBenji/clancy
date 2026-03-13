import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clancy",
  description: "Autonomous AI agent loop for non-developers. Ralph loops. Clancy ships.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-bg min-h-screen">
        {children}
      </body>
    </html>
  );
}
