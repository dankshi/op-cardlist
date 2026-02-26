import Link from "next/link";
import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, BASE_KEYWORDS, getBreadcrumbSchema } from "@/lib/seo";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "Learn how nomi market authenticates every trading card before it ships. Every order verified in-hand at our Los Angeles facility.",
  keywords: [
    ...BASE_KEYWORDS,
    "how it works",
    "card authentication",
    "verified cards",
    "trusted marketplace",
  ],
  alternates: {
    canonical: `${SITE_URL}/about`,
  },
  openGraph: {
    title: "How It Works — nomi market",
    description:
      "Every card authenticated. Every order verified before it ships.",
    url: `${SITE_URL}/about`,
    siteName: SITE_NAME,
    type: "website",
  },
};

const steps = [
  {
    number: "01",
    title: "Seller lists",
    description:
      "Sellers list their cards at their price. Every listing includes card condition, language, and details.",
  },
  {
    number: "02",
    title: "Buyer purchases",
    description:
      "Browse, compare market prices, and purchase with confidence. Payment is held securely until authentication is complete.",
  },
  {
    number: "03",
    title: "We authenticate",
    description:
      "The seller ships to our facility in Los Angeles. Our team inspects every card for condition, authenticity, and accuracy.",
  },
  {
    number: "04",
    title: "Shipped to you",
    description:
      "Once verified, we ship the authenticated card directly to you. If anything doesn't pass, you get a full refund.",
  },
];

export default function AboutPage() {
  return (
    <div>
      {/* Breadcrumb Schema */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            getBreadcrumbSchema([
              { name: "Home", url: SITE_URL },
              { name: "How It Works", url: `${SITE_URL}/about` },
            ])
          ),
        }}
      />

      {/* Hero */}
      <section className="pt-12 pb-16 sm:pt-16 sm:pb-20 text-center">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight mb-4">
          Every card authenticated.
        </h1>
        <p className="text-lg text-zinc-500 max-w-lg mx-auto leading-relaxed">
          nomi is the trusted way to buy and sell trading cards. Every order is
          inspected and verified by our team before it ships.
        </p>
      </section>

      {/* How It Works */}
      <section className="mb-20">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest text-center mb-12">
          How It Works
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 max-w-4xl mx-auto">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="text-3xl font-black text-orange-500/20 mb-3">
                {step.number}
              </div>
              <h3 className="font-semibold text-zinc-900 mb-2">
                {step.title}
              </h3>
              <p className="text-sm text-zinc-500 leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="section-divider mb-20" />

      {/* Supported Games */}
      <section className="mb-20">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest text-center mb-8">
          Supported Games
        </h2>
        <div className="grid sm:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <div className="p-8 rounded-xl border border-zinc-200 bg-white text-center">
            <h3 className="font-semibold text-lg text-zinc-900">
              One Piece TCG
            </h3>
            <p className="text-sm text-zinc-500 mt-2">
              All sets, all rarities, daily market prices
            </p>
          </div>
          <div className="p-8 rounded-xl border border-zinc-200 bg-white text-center">
            <h3 className="font-semibold text-lg text-zinc-900">
              Pokemon TCG
            </h3>
            <p className="text-sm text-zinc-500 mt-2">Coming soon</p>
          </div>
        </div>
      </section>

      <div className="section-divider mb-20" />

      {/* Trust Signals */}
      <section className="mb-20">
        <div className="grid sm:grid-cols-3 gap-10 max-w-3xl mx-auto text-center">
          <div>
            <div className="text-2xl font-bold text-zinc-900">LA-Based</div>
            <p className="text-sm text-zinc-500 mt-2">
              Authentication facility in Los Angeles, CA
            </p>
          </div>
          <div>
            <div className="text-2xl font-bold text-zinc-900">100%</div>
            <p className="text-sm text-zinc-500 mt-2">
              Every card inspected before shipping
            </p>
          </div>
          <div>
            <div className="text-2xl font-bold text-zinc-900">Protected</div>
            <p className="text-sm text-zinc-500 mt-2">
              Buyer &amp; seller protection on every order
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="text-center pb-12">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/"
            className="inline-flex px-8 py-3 bg-zinc-900 text-white font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Start Browsing
          </Link>
          <Link
            href="/sell"
            className="inline-flex px-8 py-3 border border-zinc-300 text-zinc-900 font-semibold rounded-lg hover:bg-zinc-50 transition-colors"
          >
            Start Selling
          </Link>
        </div>
      </section>
    </div>
  );
}
