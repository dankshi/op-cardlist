import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import Image from "next/image";
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
    default: "One Piece TCG Card List - Complete Database with Prices",
    template: "%s | One Piece TCG Card List",
  },
  description: SITE_DESCRIPTION,
  keywords: [...BASE_KEYWORDS, "card prices", "TCGPlayer prices", "OP-13", "EB-03", "Luffy", "Ace"],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  icons: {
    icon: "/favicon.svg",
    apple: "/logo.svg",
  },
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
              <Link href="/" className="flex items-center gap-2 text-xl font-bold text-white dark:text-white light:text-zinc-900 hover:text-red-400 transition-colors">
                <Image src="/favicon.svg" alt="OP Card List Logo" width={32} height={32} className="rounded" />
                OP Card List
              </Link>
              <div className="flex items-center gap-4">
                <Link href="/" className="text-zinc-400 dark:text-zinc-400 light:text-zinc-600 hover:text-white dark:hover:text-white light:hover:text-zinc-900 transition-colors">
                  Sets
                </Link>
                <ThemeToggle />
              </div>
            </nav>
          </header>
          <main className="max-w-7xl mx-auto px-4 py-8">
            {children}
          </main>
          {modal}
          <footer className="border-t border-zinc-800 dark:border-zinc-800 light:border-zinc-200 mt-16">
            <div className="max-w-7xl mx-auto px-4 py-8 text-center text-zinc-500 text-sm">
              <p>One Piece TCG Card List is a fan-made database. One Piece is a trademark of Shueisha, Toei Animation, and Bandai.</p>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
