import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "One Piece TCG Card List - All Sets & Cards",
    template: "%s | One Piece TCG Card List",
  },
  description: "The fastest, most comprehensive One Piece TCG card database. Browse all cards, sets, and filter by color, type, rarity and more.",
  keywords: ["One Piece", "TCG", "card list", "OP-13", "card game", "Luffy", "Ace", "deck building"],
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "One Piece TCG Card List",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased bg-zinc-950 text-zinc-100 min-h-screen`}>
        <header className="border-b border-zinc-800 sticky top-0 bg-zinc-950/95 backdrop-blur z-50">
          <nav className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="text-xl font-bold text-white hover:text-red-400 transition-colors">
              OP Card List
            </Link>
            <div className="flex items-center gap-6">
              <Link href="/" className="text-zinc-400 hover:text-white transition-colors">
                Sets
              </Link>
            </div>
          </nav>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-zinc-800 mt-16">
          <div className="max-w-7xl mx-auto px-4 py-8 text-center text-zinc-500 text-sm">
            <p>One Piece TCG Card List is a fan-made database. One Piece is a trademark of Shueisha, Toei Animation, and Bandai.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
