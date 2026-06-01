import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import AuthButton from "@/components/auth/AuthButton";
import MyShopLink from "@/components/nav/MyShopLink";
import { SearchHero } from "@/components/home/SearchHero";
import { SITE_URL, SITE_DESCRIPTION, TWITTER_HANDLE, DEFAULT_OG_IMAGE, BASE_KEYWORDS, getOrganizationSchema, getWebSiteSchema } from "@/lib/seo";

// Storefront-flavored metadata. Lives here (not the bare root layout) so
// the admin section doesn't inherit the consumer title template /
// openGraph chrome — admin only gets the neutral root metadata.
export const metadata: Metadata = {
  title: {
    default: "nomi market — The Trusted TCG Marketplace",
    template: "%s | nomi market",
  },
  description: SITE_DESCRIPTION,
  keywords: [...BASE_KEYWORDS, "card prices", "TCGPlayer prices", "OP-13", "EB-03", "Luffy", "Ace"],
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: "nomi market",
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
  alternates: {
    canonical: SITE_URL,
  },
};

export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
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
      <header className="border-b border-orange-600 sticky top-0 bg-orange-500 z-50">
        <nav className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-4 sm:gap-6">
          <Link href="/" className="hover:opacity-90 transition-opacity flex-shrink-0">
            <Image src="/nomi-slab.png" alt="nomi" width={80} height={28} className="h-7 w-auto" />
          </Link>
          <div className="flex-1 min-w-0">
            <Suspense fallback={<div className="h-9 rounded-lg bg-white/20 animate-pulse" />}>
              <SearchHero variant="compact" />
            </Suspense>
          </div>
          <div className="flex items-center gap-4 flex-shrink-0">
            <Link href="/marketplace" className="hidden md:inline text-white/80 hover:text-white transition-colors text-sm font-medium">
              Marketplace
            </Link>
            <Link href="/about" className="hidden lg:inline text-white/80 hover:text-white transition-colors text-sm font-medium">
              How It Works
            </Link>
            <Link href="/sell" className="hidden md:inline text-white/80 hover:text-white transition-colors text-sm font-medium">
              Sell
            </Link>
            <MyShopLink />
            <Suspense fallback={<div className="w-8 h-8 rounded-full bg-white/20 animate-pulse" />}>
              <AuthButton />
            </Suspense>
          </div>
        </nav>
      </header>
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
      <footer className="border-t border-zinc-200 mt-16">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 text-center text-zinc-500 text-sm space-y-3">
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
    </>
  );
}
