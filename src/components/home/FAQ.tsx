const items = [
  {
    q: 'How does authentication work?',
    a: 'Every order ships through our intake facility. Our team inspects each card against high-resolution reference scans, verifies edition and printing details, and rejects fakes before they reach you. If a card fails verification, the order is cancelled and you are refunded in full.',
  },
  {
    q: 'What are the fees for sellers?',
    a: 'Slabs use a tier model that drops from 9% (Basic) down to 7% (Diamond) as your sales volume grows. Raw cards stay at a flat 9.5% across every tier — ungraded cards take more work to authenticate and carry more risk. On top of that, all sales include a flat 3% payment-processing fee, and Ship-to-Nomi listings have a $5 per-card seller fee (waived on Drop-off). No listing fees, no subscriptions. Use the home-page calculator to preview your exact payout before you list.',
  },
  {
    q: 'How do seller tiers work?',
    a: 'You automatically move up tiers as your gross merchandise value (GMV) grows. Basic covers $0–$1,499, Silver unlocks at $1,500, Pearl at $5,000, Gold at $25,000, and Diamond at $100,000. Tier discounts apply only to graded slabs.',
  },
  {
    q: 'How fast do orders ship?',
    a: 'Most orders are inspected, packed, and shipped within 48 hours of payment. You get tracking the moment the package leaves our facility.',
  },
  {
    q: 'What happens if a card arrives damaged?',
    a: 'Every order is photographed at our facility before shipping and insured in transit. If your card arrives in worse condition than listed, contact support within 7 days for a full refund or replacement.',
  },
  {
    q: 'Which games do you support?',
    a: 'One Piece Card Game is live today. Pokemon support is coming soon — sign up to be notified at launch.',
  },
];

export function FAQ() {
  return (
    <section className="mb-12 sm:mb-16">
      <div className="text-center mb-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-3">
          Frequently asked
        </h2>
        <p className="text-zinc-500 max-w-md mx-auto">
          Everything you need to know before you buy or sell.
        </p>
      </div>
      <div className="max-w-3xl mx-auto divide-y divide-zinc-200 border-y border-zinc-200">
        {items.map((item) => (
          <details key={item.q} className="group py-5">
            <summary className="flex items-center justify-between gap-4 cursor-pointer list-none">
              <h3 className="text-base sm:text-lg font-medium text-zinc-900">
                {item.q}
              </h3>
              <span className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-700 flex items-center justify-center shrink-0 transition-transform group-open:rotate-45">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </span>
            </summary>
            <p className="mt-3 text-sm sm:text-base text-zinc-600 leading-relaxed pr-12">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
