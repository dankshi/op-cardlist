import type { Metadata } from "next";
import { Inter } from "next/font/google";

import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import "./globals.css";
import AuthButton from "@/components/auth/AuthButton";
import CartButton from "@/components/marketplace/CartButton";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, TWITTER_HANDLE, DEFAULT_OG_IMAGE, BASE_KEYWORDS, getOrganizationSchema, getWebSiteSchema } from "@/lib/seo";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "nomi market — The Trusted TCG Marketplace",
    template: "%s | nomi market",
  },
  description: SITE_DESCRIPTION,
  keywords: [...BASE_KEYWORDS, "card prices", "TCGPlayer prices", "OP-13", "EB-03", "Luffy", "Ace"],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "nomi market — The Trusted TCG Marketplace",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "nomi market — The Trusted TCG Marketplace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "nomi market — The Trusted TCG Marketplace",
    description: SITE_DESCRIPTION,
    site: TWITTER_HANDLE,
    creator: TWITTER_HANDLE,
    images: [DEFAULT_OG_IMAGE],
  },
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
  alternates: {
    canonical: SITE_URL,
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
      <body className={`${inter.variable} font-sans antialiased bg-zinc-50 text-zinc-900 min-h-screen`}>
        {/* Organization Schema */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(getOrganizationSchema()),
          }}
        />
        {/* WebSite Schema with SearchAction */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(getWebSiteSchema()),
          }}
        />
          <header className="border-b border-zinc-200 sticky top-0 bg-white/95 backdrop-blur z-50">
            <nav className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
              <Link href="/" className="hover:opacity-90 transition-opacity">
                <Image src="/nomi-slab.png" alt="nomi" width={80} height={28} className="h-7 w-auto" />
              </Link>
              <div className="flex items-center gap-4">
                <Link href="/about" className="text-zinc-500 hover:text-zinc-900 transition-colors text-sm font-medium">
                  How It Works
                </Link>
                <Link href="/sell" className="text-zinc-500 hover:text-zinc-900 transition-colors text-sm font-medium">
                  Sell
                </Link>
                <Link href="/dashboard" className="text-zinc-500 hover:text-zinc-900 transition-colors text-sm font-medium">
                  Dashboard
                </Link>
                <Suspense>
                  <CartButton />
                </Suspense>
                <Suspense fallback={<div className="w-8 h-8 rounded-full bg-zinc-100 animate-pulse" />}>
                  <AuthButton />
                </Suspense>
              </div>
            </nav>
          </header>
          <main className="max-w-7xl mx-auto px-4 py-8">
            {children}
          </main>
          <footer className="border-t border-zinc-200 mt-16">
            <div className="max-w-7xl mx-auto px-4 py-8 text-center text-zinc-500 text-sm space-y-3">
              <div className="flex items-center justify-center">
                <Image src="/nomi-slab.png" alt="nomi" width={60} height={20} className="h-5 w-auto" />
              </div>

              <div className="flex items-center justify-center gap-4 text-xs text-zinc-400">
                <Link href="/about" className="hover:text-zinc-900 transition-colors">How It Works</Link>
                <span className="text-zinc-300">|</span>
                <span>One Piece TCG</span>
                <span className="text-zinc-300">&middot;</span>
                <span>Pokemon TCG</span>
              </div>
            </div>
          </footer>
      </body>
    </html>
  );
}
