import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { RaffleEditForm } from '@/components/admin/raffles/RaffleEditForm'
import { DrawWinnerButton } from '@/components/admin/raffles/DrawWinnerButton'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20',
  drawn: 'bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/20',
  cancelled: 'bg-zinc-200 text-zinc-600',
}

interface RaffleDetail {
  id: string
  slug: string
  title: string
  prize_description: string
  prize_image_url: string | null
  status: 'active' | 'drawn' | 'cancelled'
  starts_at: string
  ends_at: string | null
  drawn_at: string | null
  winner_user_id: string | null
  created_at: string
}

interface EntryRow {
  id: string
  user_id: string
  source: 'signup' | 'purchase' | 'sale'
  order_id: string | null
  created_at: string
}

export default async function AdminRaffleDetailPage({
  params,
}: {
  params: Promise<{ raffleId: string }>
}) {
  const { raffleId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/auth/sign-in?next=/admin/raffles/${raffleId}`)

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) redirect('/')

  const admin = getSupabaseAdmin()

  const { data: raffle } = await admin
    .from('raffles')
    .select('*')
    .eq('id', raffleId)
    .maybeSingle<RaffleDetail>()

  if (!raffle) notFound()

  const { data: entries } = await admin
    .from('raffle_entries')
    .select('id, user_id, source, order_id, created_at')
    .eq('raffle_id', raffle.id)
    .order('created_at', { ascending: false })
    .returns<EntryRow[]>()

  const allEntries = entries ?? []
  const breakdown = { signup: 0, purchase: 0, sale: 0 }
  for (const e of allEntries) breakdown[e.source] += 1
  const totalEntries = allEntries.length

  // Top entrants by count, capped at 10 for the page.
  const byUser = new Map<string, number>()
  for (const e of allEntries) byUser.set(e.user_id, (byUser.get(e.user_id) ?? 0) + 1)
  const topUsers = [...byUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
  const topUserIds = topUsers.map(([id]) => id)

  // Resolve display names + emails for top users + winner. One query.
  const userIdsToLoad = new Set<string>(topUserIds)
  if (raffle.winner_user_id) userIdsToLoad.add(raffle.winner_user_id)
  const userInfo = new Map<string, { display_name: string | null; email: string | null }>()
  if (userIdsToLoad.size > 0) {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, display_name')
      .in('id', [...userIdsToLoad])
    for (const p of (profiles ?? []) as { id: string; display_name: string | null }[]) {
      userInfo.set(p.id, { display_name: p.display_name, email: null })
    }
    // Pull emails via admin auth API. Failure tolerated — display still works.
    for (const uid of userIdsToLoad) {
      try {
        const res = await admin.auth.admin.getUserById(uid)
        const email = res?.data?.user?.email ?? null
        const existing = userInfo.get(uid) ?? { display_name: null, email: null }
        userInfo.set(uid, { ...existing, email })
      } catch {
        // ignore
      }
    }
  }

  const winnerInfo = raffle.winner_user_id ? userInfo.get(raffle.winner_user_id) : null

  return (
    <div className="max-w-4xl">
      <div className="flex items-center gap-3 text-sm text-zinc-500 mb-3">
        <Link href="/admin/raffles" className="hover:text-zinc-900">Raffles</Link>
        <span>/</span>
        <span className="font-mono text-zinc-600">{raffle.slug}</span>
      </div>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-zinc-900">{raffle.title}</h1>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_STYLES[raffle.status] || ''}`}>
              {raffle.status}
            </span>
          </div>
          <p className="text-sm text-zinc-600">{raffle.prize_description}</p>
        </div>
      </div>

      {/* ===== WINNER / DRAW ===== */}
      <section className="mb-8">
        {raffle.status === 'drawn' && winnerInfo ? (
          <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-xl p-6">
            <p className="text-[11px] uppercase tracking-wider text-white/70 font-semibold mb-2">
              Winner drawn{raffle.drawn_at ? ` · ${new Date(raffle.drawn_at).toLocaleString('en-US')}` : ''}
            </p>
            <p className="text-2xl font-bold mb-1">
              {winnerInfo.display_name || winnerInfo.email || raffle.winner_user_id}
            </p>
            {winnerInfo.email && winnerInfo.display_name && (
              <p className="text-white/80 text-sm">{winnerInfo.email}</p>
            )}
            <p className="text-white/70 text-xs mt-3 font-mono">{raffle.winner_user_id}</p>
          </div>
        ) : raffle.status === 'active' ? (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-6">
            <h2 className="text-lg font-bold text-zinc-900 mb-1">Draw winner</h2>
            <p className="text-sm text-zinc-600 mb-4">
              {totalEntries.toLocaleString('en-US')} entries across {byUser.size.toLocaleString('en-US')} entrants. Closes{' '}
              {raffle.ends_at
                ? new Date(raffle.ends_at).toLocaleString('en-US')
                : 'TBA'}.
            </p>
            <DrawWinnerButton raffleId={raffle.id} entryCount={totalEntries} />
          </div>
        ) : (
          <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-6 text-sm text-zinc-600">
            This raffle is <span className="font-semibold">{raffle.status}</span>. To draw a winner, change status to <span className="font-mono">active</span>.
          </div>
        )}
      </section>

      {/* ===== EDIT FORM ===== */}
      <section className="mb-8">
        <RaffleEditForm
          raffle={{
            id: raffle.id,
            title: raffle.title,
            prize_description: raffle.prize_description,
            prize_image_url: raffle.prize_image_url,
            status: raffle.status,
            ends_at: raffle.ends_at,
          }}
        />
      </section>

      {/* ===== ENTRY STATS ===== */}
      <section className="mb-8 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Total entries" value={totalEntries.toLocaleString('en-US')} />
        <Stat label="Entrants" value={byUser.size.toLocaleString('en-US')} />
        <Stat label="From purchases" value={breakdown.purchase.toLocaleString('en-US')} />
        <Stat label="From sales" value={breakdown.sale.toLocaleString('en-US')} />
      </section>

      {/* ===== TOP ENTRANTS ===== */}
      {topUsers.length > 0 && (
        <section className="bg-white border border-zinc-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-zinc-900 mb-1">Top entrants</h2>
          <p className="text-sm text-zinc-500 mb-4">Most entries first. Useful for spotting wash-trade patterns.</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-200">
                <th className="pb-2">User</th>
                <th className="pb-2">Email</th>
                <th className="pb-2 text-right tabular-nums">Entries</th>
              </tr>
            </thead>
            <tbody>
              {topUsers.map(([userId, count]) => {
                const info = userInfo.get(userId)
                return (
                  <tr key={userId} className="border-b border-zinc-100 last:border-0">
                    <td className="py-2.5 font-medium text-zinc-900">
                      {info?.display_name || <span className="font-mono text-xs text-zinc-500">{userId.slice(0, 8)}</span>}
                    </td>
                    <td className="py-2.5 text-zinc-600 text-sm">{info?.email || '—'}</td>
                    <td className="py-2.5 text-right tabular-nums font-medium">{count.toLocaleString('en-US')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-4">
      <div className="text-2xl font-bold tabular-nums leading-none">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium mt-1.5">{label}</div>
    </div>
  )
}
