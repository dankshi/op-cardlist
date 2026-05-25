import Link from "next/link";
import Image from "next/image";

export function LaunchRaffleBanner() {
  return (
    <section className="mb-12 sm:mb-16">
      <Link
        href="/raffles"
        className="block group rounded-2xl overflow-hidden relative bg-zinc-900 text-white"
      >
        {/* Background art — Luffy / map */}
        <div className="absolute inset-0">
          <Image
            src="/homeBanner/op13_banner.webp"
            alt=""
            fill
            priority
            className="object-cover object-right scale-105 group-hover:scale-110 transition-transform duration-700"
            sizes="100vw"
          />
        </div>

        {/* Darkening gradient — heavier on the left where the text sits */}
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-900/85 to-zinc-900/40" aria-hidden="true" />
        {/* Brand color wash */}
        <div className="absolute inset-0 bg-gradient-to-br from-orange-600/40 via-transparent to-rose-500/30 mix-blend-overlay" aria-hidden="true" />

        <div className="relative p-6 sm:p-8 lg:p-10 flex flex-col lg:flex-row lg:items-center gap-6 lg:gap-10 min-h-[260px] sm:min-h-[300px]">
          <div className="flex-1 min-w-0 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/95 backdrop-blur text-white text-[11px] font-semibold uppercase tracking-wider mb-4 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
              </span>
              Launch event — live now
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight mb-3 drop-shadow-lg">
              Win a sealed OP13 booster box.
            </h2>
            <p className="text-white/90 max-w-xl leading-relaxed drop-shadow">
              We&apos;re kicking off Nomi with a launch raffle — one full OP13 booster box, free to enter, drawn at the end of the launch month. The first of several community drops.
            </p>

            <ul className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 text-sm">
              <li className="flex items-center gap-2 text-white/90 drop-shadow">
                <svg className="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Free to enter
              </li>
              <li className="flex items-center gap-2 text-white/90 drop-shadow">
                <svg className="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Sealed OP13 booster box
              </li>
              <li className="flex items-center gap-2 text-white/90 drop-shadow">
                <svg className="w-4 h-4 text-white shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                More drops coming
              </li>
            </ul>

            <div className="mt-6 lg:mt-8">
              <span className="inline-flex items-center gap-2 px-6 py-3 bg-white text-zinc-900 font-semibold rounded-lg group-hover:bg-zinc-100 transition-colors shadow-lg">
                Enter raffle
                <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </span>
            </div>
          </div>

          {/* Featured prize tile — desktop only */}
          <div className="hidden lg:block shrink-0 relative">
            <div className="relative w-56 xl:w-64 aspect-square rounded-xl overflow-hidden ring-4 ring-white/90 shadow-2xl rotate-3 group-hover:rotate-2 group-hover:scale-[1.02] transition-transform duration-300">
              <Image
                src="/homeBanner/eb03.webp"
                alt="Featured raffle prize art"
                fill
                className="object-cover"
                sizes="256px"
              />
              <div className="absolute inset-x-0 top-0 h-14 bg-gradient-to-b from-black/50 to-transparent" />
              <div className="absolute top-2 left-2 px-2 py-0.5 bg-white/95 text-zinc-900 text-[10px] font-bold uppercase tracking-wider rounded-sm shadow">
                Next drop · EB03
              </div>
            </div>
          </div>
        </div>
      </Link>
    </section>
  );
}
