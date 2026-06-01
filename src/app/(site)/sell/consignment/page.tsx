import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Consignment — nomi market",
  description:
    "Send us your entire card collection in one shipment. We grade, photograph, price, and list every card for you.",
  alternates: { canonical: `${SITE_URL}/sell/consignment` },
};

const steps = [
  {
    n: '01',
    title: 'Send us your collection',
    body: 'Ship anywhere from a stack of singles to a complete binder. One label, one shipment, fully insured.',
  },
  {
    n: '02',
    title: 'We grade, photograph & price',
    body: 'Our team inspects every card, captures studio photos, and prices each one against live market data.',
  },
  {
    n: '03',
    title: 'Cards go live, you get paid',
    body: 'Listings publish under your seller profile. Funds clear to your bank as each card sells.',
  },
];

const perks = [
  'Lower per-card fees for bulk consignment',
  'No listing work — we handle photography, descriptions, pricing',
  'Authentication included on every card',
  'Single shipment, single insured tracking number',
];

export default function ConsignmentComingSoonPage() {
  return (
    <div className="max-w-4xl mx-auto py-8 sm:py-12">
      <nav className="text-sm text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-900 transition-colors">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/sell" className="hover:text-zinc-900 transition-colors">Sell</Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-900">Consignment</span>
      </nav>

      <header className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 text-orange-700 text-xs font-semibold uppercase tracking-wider mb-5">
          Coming soon
        </div>
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-zinc-900 mb-4">
          Consignment for serious collectors.
        </h1>
        <p className="text-lg text-zinc-500 max-w-xl mx-auto leading-relaxed">
          Ship your whole collection at once. We handle grading, photography, pricing,
          and listing — you keep more of your time and a bigger cut of every sale.
        </p>
      </header>

      <section className="mb-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-zinc-200 border border-zinc-200 rounded-2xl overflow-hidden">
          {steps.map((s) => (
            <div key={s.n} className="bg-white p-6 sm:p-8">
              <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">
                Step {s.n}
              </div>
              <h3 className="text-base font-semibold text-zinc-900 mb-2">{s.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12 rounded-2xl bg-zinc-50 border border-zinc-200 p-6 sm:p-10">
        <h2 className="text-xl font-bold text-zinc-900 mb-5">What you get</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {perks.map((perk) => (
            <li key={perk} className="flex items-start gap-3 text-sm text-zinc-700">
              <svg className="w-5 h-5 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{perk}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="text-center">
        <p className="text-zinc-500 mb-5 max-w-md mx-auto">
          Consignment isn&apos;t live yet — we&apos;re onboarding power sellers now.
          In the meantime, you can list individual cards yourself.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            href="/sell"
            className="inline-flex items-center gap-2 px-6 py-3 bg-zinc-900 text-white font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
          >
            List a single card
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center px-6 py-3 border border-zinc-300 text-zinc-700 font-medium rounded-lg hover:bg-zinc-100 transition-colors"
          >
            Back home
          </Link>
        </div>
      </section>
    </div>
  );
}
