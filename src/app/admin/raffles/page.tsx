import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/20',
  drawn: 'bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/20',
  cancelled: 'bg-zinc-200 text-zinc-600',
}

interface RaffleRow {
  id: string
  slug: string
  title: string
  prize_description: string
  status: 'active' | 'drawn' | 'cancelled'
  ends_at: string | null
  drawn_at: string | null
  winner_user_id: string | null
  created_at: string
}

export default async function AdminRafflesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in?next=/admin/raffles')

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) redirect('/')

  const admin = getSupabaseAdmin()
  const { data: raffles } = await admin
    .from('raffles')
    .select('*')
    .order('created_at', { ascending: false })
    .returns<RaffleRow[]>()

  // Entry counts per raffle. One round-trip avoids N+1.
  const entryCounts = new Map<string, number>()
  if (raffles && raffles.length > 0) {
    const { data: counts } = await admin
      .from('raffle_entries')
      .select('raffle_id')
      .in('raffle_id', raffles.map(r => r.id))
    for (const row of (counts ?? []) as { raffle_id: string }[]) {
      entryCounts.set(row.raffle_id, (entryCounts.get(row.raffle_id) ?? 0) + 1)
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Raffles</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Edit prize details, push the draw date, or pick a winner.
          </p>
        </div>
      </div>

      {(!raffles || raffles.length === 0) ? (
        <div className="text-sm text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl p-8 text-center">
          No raffles yet. Add one via migration.
        </div>
      ) : (
        <div className="space-y-3">
          {raffles.map((r) => {
            const count = entryCounts.get(r.id) ?? 0
            return (
              <Link
                key={r.id}
                href={`/admin/raffles/${r.id}`}
                className="block bg-white border border-zinc-200 hover:border-zinc-300 hover:shadow-sm rounded-xl p-5 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h2 className="font-semibold text-zinc-900 truncate">{r.title}</h2>
                      <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || ''}`}>
                        {r.status}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-600 mb-2">{r.prize_description}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                      <span className="font-mono">{r.slug}</span>
                      <span>·</span>
                      <span className="tabular-nums">{count.toLocaleString('en-US')} entries</span>
                      <span>·</span>
                      <span>
                        {r.ends_at
                          ? `Closes ${new Date(r.ends_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : 'No close date'}
                      </span>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-zinc-300 shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
