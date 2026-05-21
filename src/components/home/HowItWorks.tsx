export function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Find your card',
      body: 'Search across every set with live market prices updated daily.',
      icon: (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      ),
    },
    {
      n: '02',
      title: 'We verify it',
      body: 'Every sale ships through nomi for authentication before it reaches you.',
      icon: (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.746 3.746 0 011.043 3.296A3.745 3.745 0 0121 12z" />
        </svg>
      ),
    },
    {
      n: '03',
      title: 'It ships to you',
      body: 'Tracked, insured, and protected by every-order buyer guarantee.',
      icon: (
        <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
        </svg>
      ),
    },
  ];

  return (
    <section className="mb-12 sm:mb-16">
      <div className="text-center mb-10">
        <h2 className="text-2xl sm:text-3xl font-bold text-zinc-900 mb-3">How it works</h2>
        <p className="text-zinc-500 max-w-md mx-auto">
          Every card, from every seller, verified before it ships.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-zinc-200 border border-zinc-200 rounded-2xl overflow-hidden">
        {steps.map((step) => (
          <div key={step.n} className="bg-white p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-zinc-900 text-white flex items-center justify-center shrink-0">
                <div className="w-6 h-6">{step.icon}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-1">
                  Step {step.n}
                </div>
                <h3 className="text-base font-semibold text-zinc-900 mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-zinc-500 leading-relaxed">
                  {step.body}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
