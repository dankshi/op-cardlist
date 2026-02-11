import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, TWITTER_HANDLE, DEFAULT_OG_IMAGE, BASE_KEYWORDS, getOrganizationSchema, getWebSiteSchema } from "@/lib/seo";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "One Piece TCG Card List - Complete Database with Prices | OPCardlist",
    template: "%s | OPCardlist",
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
    title: "One Piece TCG Card List - Complete Database with Prices",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: "One Piece TCG Card List",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "One Piece TCG Card List - Complete Database with Prices",
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
    icon: "/opcardlist-logo.png",
    apple: "/opcardlist-logo.png",
  },
  alternates: {
    canonical: SITE_URL,
  },
  verification: {
    // Add your verification codes here
    // google: "your-google-verification-code",
    // yandex: "your-yandex-verification-code",
  },
};

export default function RootLayout({
  children,
  modal,
}: Readonly<{
  children: React.ReactNode;
  modal: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased bg-zinc-950 dark:bg-zinc-950 light:bg-zinc-50 text-zinc-100 dark:text-zinc-100 light:text-zinc-900 min-h-screen`}>
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
        <ThemeProvider>
          <header className="border-b border-zinc-800 dark:border-zinc-800 light:border-zinc-200 sticky top-0 bg-zinc-950/95 dark:bg-zinc-950/95 light:bg-white/95 backdrop-blur z-50">
            <nav className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
              <Link href="/" className="group flex items-center gap-2 hover:opacity-90 transition-opacity">
                <Image src="/logo.png" alt="OPCardlist logo" width={32} height={32} className="rounded" />
                <span className="flex items-baseline gap-0.5">
                  <span className="text-2xl font-black italic text-sky-500 drop-shadow-[0_0_10px_rgba(14,165,233,0.5)]">OP</span>
                  <span className="text-xl font-bold text-white dark:text-white light:text-zinc-900 tracking-tight">Card</span>
                  <span className="text-xl font-bold text-zinc-400 dark:text-zinc-400 light:text-zinc-500 tracking-tight">list</span>
                </span>
              </Link>
              <div className="flex items-center gap-4">
                <Link href="/" className="text-zinc-400 dark:text-zinc-400 light:text-zinc-600 hover:text-white dark:hover:text-white light:hover:text-zinc-900 transition-colors">
                  Sets
                </Link>
                <Link href="/products" className="text-zinc-400 dark:text-zinc-400 light:text-zinc-600 hover:text-white dark:hover:text-white light:hover:text-zinc-900 transition-colors">
                  Products
                </Link>
                <Link href="/hot" className="text-zinc-400 dark:text-zinc-400 light:text-zinc-600 hover:text-white dark:hover:text-white light:hover:text-zinc-900 transition-colors flex items-center gap-1">
                  <span className="text-orange-400">🔥</span>
                  Hot
                </Link>
                {/* Fix link hidden from prod - access directly via /test */}
                <ThemeToggle />
              </div>
            </nav>
          </header>
          <main className="max-w-7xl mx-auto px-4 py-8">
            {children}
          </main>
          {modal}
          <footer className="border-t border-zinc-800 dark:border-zinc-800 light:border-zinc-200 mt-16">
            <div className="max-w-7xl mx-auto px-4 py-8 text-center text-zinc-500 text-sm space-y-2">
              <p>
                Built by{" "}
                <a
                  href="https://openseatcg.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-300 dark:text-zinc-300 light:text-sky-600 hover:text-white dark:hover:text-white light:hover:text-sky-700 transition-colors"
                >
                  OPEN SEA TCG
                </a>
              </p>
              <p>One Piece is a trademark of Shueisha, Toei Animation, and Bandai.</p>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
