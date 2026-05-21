import Link from "next/link";

const props = [
  {
    title: 'List in 60 seconds',
    body: 'Scan or pick from our catalog, set a price, ship it to us. We handle the rest.',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    title: 'Get paid fast',
    body: 'Funds clear to your bank within 2 business days of delivery confirmation.',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    title: 'We handle auth',
    body: 'Every card we ship is inspected and verified. You list, we vouch — buyers feel safer, so they pay more.',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
      </svg>
    ),
  },
];

export function SellCTA() {
  return (
    <section className="mb-12 sm:mb-16">
      <div className="rounded-2xl bg-gradient-to-br from-orange-50 via-white to-orange-50/40 border border-orange-100 overflow-hidden">
        <div className="px-6 pt-10 pb-8 sm:px-12 sm:pt-14 sm:pb-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 text-orange-700 text-xs font-semibold uppercase tracking-wider mb-4">
            For sellers
          </div>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-zinc-900 mb-3 tracking-tight">
            Get more for your cards.
          </h2>
          <p className="text-zinc-600 max-w-xl mx-auto text-base sm:text-lg">
            Authenticated listings sell faster and at higher prices. We do the hard part so you don&apos;t have to.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-orange-100 mx-px">
          {props.map((p) => (
            <div key={p.title} className="bg-white px-6 py-6 sm:py-8">
              <div className="w-10 h-10 rounded-lg bg-orange-500/10 text-orange-600 flex items-center justify-center mb-3">
                <div className="w-5 h-5">{p.icon}</div>
              </div>
              <h3 className="text-sm font-semibold text-zinc-900 mb-1.5">{p.title}</h3>
              <p className="text-sm text-zinc-600 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
        <div className="px-6 py-8 sm:py-10 text-center bg-white border-t border-orange-100">
          <Link
            href="/sell"
            className="inline-flex items-center gap-2 px-7 py-3 bg-zinc-900 text-white font-semibold rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Start selling
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
