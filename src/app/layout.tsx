import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "./globals.css";
import { SITE_URL } from "@/lib/seo";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Bare root layout. Only neutral, app-wide metadata lives here so that
// every route — storefront AND admin — inherits a sane base. Storefront
// marketing metadata (title template, openGraph, etc.) lives in
// src/app/(site)/layout.tsx. metadataBase must stay here so any route
// emitting absolute OG/canonical URLs resolves correctly.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: "/nomi-slab.png",
    apple: "/nomi-slab.png",
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased bg-zinc-50 text-zinc-900 min-h-screen overflow-x-clip`}>
        {children}
      </body>
    </html>
  );
}
