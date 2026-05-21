import Link from "next/link";

export function ConsignmentBanner() {
  return (
    <section className="mb-12 sm:mb-16">
      <Link
        href="/sell/consignment"
        className="block group rounded-2xl bg-zinc-900 text-white p-6 sm:p-8 lg:p-10 hover:bg-zinc-800 transition-colors overflow-hidden relative"
      >
        {/* Background accent */}
        <div className="absolute inset-y-0 right-0 w-1/2 pointer-events-none opacity-[0.04]" aria-hidden="true">
          <svg viewBox="0 0 200 200" className="h-full w-full" fill="currentColor">
            <path d="M40 60h120v100H40z" stroke="white" strokeWidth="2" fill="none" />
            <path d="M60 80h80v60H60z" stroke="white" strokeWidth="2" fill="none" />
            <path d="M80 100h40v20H80z" stroke="white" strokeWidth="2" fill="none" />
          </svg>
        </div>

        <div className="relative flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10">
          <div className="flex-1 min-w-0">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 text-orange-300 text-[11px] font-semibold uppercase tracking-wider mb-4">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              Power seller
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3">
              Got a stack? Ship it once. We&apos;ll handle the rest.
            </h2>
            <p className="text-zinc-300 max-w-2xl leading-relaxed">
              Send us your whole collection in a single shipment. We grade, photograph, price, and list every card for you — you keep more of your time and a bigger cut of the sale.
            </p>

            <ul className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
              <li className="flex items-center gap-2 text-zinc-300">
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                $5 seller fee waived
              </li>
              <li className="flex items-center gap-2 text-zinc-300">
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                We list, price, photograph
              </li>
              <li className="flex items-center gap-2 text-zinc-300">
                <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Tier discounts apply
              </li>
            </ul>
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <span className="inline-flex items-center gap-2 px-6 py-3 bg-white text-zinc-900 font-semibold rounded-lg group-hover:bg-zinc-100 transition-colors">
              Learn more
              <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
}
