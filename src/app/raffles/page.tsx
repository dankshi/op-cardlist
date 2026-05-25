import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { ClaimFreeEntryButton } from '@/components/raffles/ClaimFreeEntryButton'
import { RaffleCountdown } from '@/components/raffles/RaffleCountdown'

export const metadata: Metadata = {
  title: 'Launch Raffle — nomi market',
  description: 'Enter the nomi launch raffle. Free to enter, sealed prizes, and bonus entries every time you buy or sell.',
}

interface Raffle {
  id: string
  slug: string
  title: string
  prize_description: string
  prize_image_url: string | null
  status: 'active' | 'drawn' | 'cancelled'
  ends_at: string | null
}

export default async function RafflesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: raffle } = await supabase
    .from('raffles')
    .select('id, slug, title, prize_description, prize_image_url, status, ends_at')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<Raffle>()

  if (!raffle) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold text-zinc-900 mb-3">No active raffle</h1>
        <p className="text-zinc-600">Check back soon — we&apos;ll have a new community drop up shortly.</p>
        <Link href="/" className="inline-block mt-6 text-orange-600 hover:text-orange-700 font-medium">
          ← Back to home
        </Link>
      </div>
    )
  }

  // Total entries — admin client bypasses RLS so the public count is
  // visible even when the viewer can only read their own rows.
  const admin = getSupabaseAdmin()
  const [{ count: totalEntries }, { count: totalEntrants }] = await Promise.all([
    admin
      .from('raffle_entries')
      .select('id', { count: 'exact', head: true })
      .eq('raffle_id', raffle.id),
    admin
      .from('raffle_entries')
      .select('user_id', { count: 'exact', head: true })
      .eq('raffle_id', raffle.id),
  ])

  // Per-source breakdown for the viewer.
  const userCounts = { signup: 0, purchase: 0, sale: 0 }
  if (user) {
    const { data: rows } = await supabase
      .from('raffle_entries')
      .select('source')
      .eq('raffle_id', raffle.id)
      .eq('user_id', user.id)

    for (const row of rows ?? []) {
      const s = row.source as 'signup' | 'purchase' | 'sale'
      if (s in userCounts) userCounts[s] += 1
    }
  }
  const userTotal = userCounts.signup + userCounts.purchase + userCounts.sale
  const winChance = totalEntries && userTotal
    ? (userTotal / totalEntries) * 100
    : 0

  const drawCopy = raffle.ends_at
    ? new Date(raffle.ends_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : 'TBA'

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 sm:py-12">
      {/* ===== HERO ===== */}
      <section className="relative rounded-3xl overflow-hidden bg-zinc-900 text-white mb-10">
        <div className="absolute inset-0">
          <Image
            src={raffle.prize_image_url || '/homeBanner/op13_banner.webp'}
            alt=""
            fill
            priority
            className="object-cover object-right"
            sizes="100vw"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-zinc-900 via-zinc-900/85 to-zinc-900/30" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-br from-orange-600/40 via-transparent to-rose-500/30 mix-blend-overlay" aria-hidden="true" />

        <div className="relative p-8 sm:p-10 lg:p-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/95 text-white text-[11px] font-semibold uppercase tracking-wider mb-5 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
            </span>
            Launch event — live now
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-3 drop-shadow-lg max-w-3xl">
            {raffle.title}
          </h1>
          <p className="text-white/90 max-w-2xl text-lg leading-relaxed drop-shadow">
            Prize: <span className="font-semibold text-white">{raffle.prize_description}</span>. Free to enter and the first of several community drops.
          </p>

          {raffle.ends_at && (
            <div className="mt-8">
              <p className="text-[11px] uppercase tracking-wider text-white/70 font-semibold mb-3">
                Draw in
              </p>
              <RaffleCountdown endsAt={raffle.ends_at} />
              <p className="text-xs text-white/60 mt-3">
                Closes {drawCopy} · winner drawn shortly after
              </p>
            </div>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <Stat label="Total entries" value={(totalEntries ?? 0).toLocaleString('en-US')} />
            <Stat label="Entrants" value={(totalEntrants ?? 0).toLocaleString('en-US')} />
            {!raffle.ends_at && <Stat label="Draw date" value={drawCopy} />}
          </div>
        </div>
      </section>

      {/* ===== ENTRY CARD ===== */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-2xl p-6 sm:p-8">
          <h2 className="text-xl font-bold text-zinc-900 mb-1">How to enter</h2>
          <p className="text-sm text-zinc-500 mb-6">
            Three ways to stack the odds in your favor — they combine.
          </p>

          <ul className="space-y-5">
            <RuleRow
              n={1}
              title="Claim 1 free entry"
              desc="Sign in and tap the button below. One per account, per raffle."
            />
            <RuleRow
              n={2}
              title="+1 entry for every card you buy"
              desc="Each authenticated card in your orders is a separate entry. A 5-card haul = 5 entries."
            />
            <RuleRow
              n={3}
              title="+1 entry for every card you sell"
              desc="Same on the seller side — every authenticated card sold counts."
            />
          </ul>

          <div className="mt-8 pt-6 border-t border-zinc-100">
            {!user ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <Link
                  href={`/auth/sign-in?next=${encodeURIComponent('/raffles')}`}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors shadow-sm"
                >
                  Sign in to enter
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </Link>
                <p className="text-sm text-zinc-500">
                  No account?{' '}
                  <Link href="/auth/sign-up" className="text-orange-600 hover:text-orange-700 font-medium">
                    Create one
                  </Link>{' '}
                  — takes 30 seconds.
                </p>
              </div>
            ) : (
              <ClaimFreeEntryButton
                raffleId={raffle.id}
                alreadyClaimed={userCounts.signup > 0}
              />
            )}
          </div>
        </div>

        {/* ===== YOUR ENTRIES PANEL ===== */}
        <div className="bg-zinc-900 text-white rounded-2xl p-6 sm:p-8">
          <p className="text-[11px] uppercase tracking-wider text-zinc-400 font-semibold mb-2">
            Your entries
          </p>
          {user ? (
            <>
              <div className="text-5xl font-bold tabular-nums leading-none mb-1">
                {userTotal.toLocaleString('en-US')}
              </div>
              <p className="text-zinc-400 text-sm mb-6">
                {userTotal === 0
                  ? 'You haven\'t entered yet.'
                  : winChance >= 0.01
                    ? `~${winChance.toFixed(winChance >= 1 ? 1 : 2)}% chance to win`
                    : 'Long odds — pile up more entries'}
              </p>

              <dl className="space-y-3 text-sm">
                <BreakdownRow label="Free entry" count={userCounts.signup} max={1} />
                <BreakdownRow label="Purchases" count={userCounts.purchase} />
                <BreakdownRow label="Sales" count={userCounts.sale} />
              </dl>
            </>
          ) : (
            <>
              <div className="text-5xl font-bold tabular-nums leading-none mb-1 text-zinc-700">
                —
              </div>
              <p className="text-zinc-400 text-sm">
                Sign in to see your entry count.
              </p>
            </>
          )}
        </div>
      </section>

      {/* ===== RULES / FINE PRINT ===== */}
      <section className="bg-zinc-50 border border-zinc-200 rounded-2xl p-6 sm:p-8">
        <h2 className="text-lg font-bold text-zinc-900 mb-3">Rules &amp; details</h2>
        <ul className="text-sm text-zinc-600 space-y-2 list-disc pl-5 marker:text-zinc-400">
          <li>Free to enter — no purchase necessary to win.</li>
          <li>Entries from purchases or sales count only after the order is authenticated by our team.</li>
          <li>Wash trades (buying from yourself or a coordinated account) are disqualified at draw time.</li>
          <li>One winner per raffle, drawn at random from all eligible entries.</li>
          <li>Draw date: <span className="font-medium text-zinc-900">{drawCopy}</span>. Winner is contacted by email; prize ships free within the US.</li>
        </ul>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl sm:text-3xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-white/70 mt-1">{label}</div>
    </div>
  )
}

function RuleRow({ n, title, desc }: { n: number; title: string; desc: string }) {
  return (
    <li className="flex gap-4">
      <div className="shrink-0 w-8 h-8 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center font-bold text-sm">
        {n}
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold text-zinc-900">{title}</h3>
        <p className="text-sm text-zinc-600 mt-0.5">{desc}</p>
      </div>
    </li>
  )
}

function BreakdownRow({ label, count, max }: { label: string; count: number; max?: number }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-zinc-300">{label}</dt>
      <dd className="tabular-nums font-medium">
        {count.toLocaleString('en-US')}
        {max != null && <span className="text-zinc-500 text-xs"> / {max}</span>}
      </dd>
    </div>
  )
}
