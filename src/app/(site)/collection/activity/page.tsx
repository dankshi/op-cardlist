import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getCardsByIds } from '@/lib/cards'
import { gradeLabel } from '@/lib/gradingStyle'
import type { CollectionActivityRow } from '@/types/database'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Collection activity',
  robots: { index: false },
}

function fmtUSD(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(s: string) {
  // UTC-pinned so date-only values (stored UTC-anchored) don't render a day
  // back in negative-offset timezones; matches the CSV export's UTC day.
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

const KIND_LABEL: Record<string, string> = { buy: 'Bought', sell: 'Sold', grade: 'Graded', basis: 'Adjusted', note: 'Note' }
const KIND_DOT: Record<string, string> = { buy: 'bg-zinc-400', sell: 'bg-emerald-500', grade: 'bg-purple-500', basis: 'bg-amber-500', note: 'bg-zinc-300' }

export default async function CollectionActivityPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in?redirect=/collection/activity')

  const { data: rowsRaw } = await supabase
    .from('collection_activity')
    .select('*')
    .order('happened_at', { ascending: false })
    .limit(500)
  const rows = (rowsRaw ?? []) as CollectionActivityRow[]

  const cards = rows.length ? await getCardsByIds([...new Set(rows.map(r => r.card_id))]) : []
  const nameByCard = new Map(cards.map(c => [c.id, c.name]))

  const sells = rows.filter(r => r.kind === 'sell')
  const realized = sells.reduce((s, r) => s + (r.realized != null ? Number(r.realized) : 0), 0)
  const proceeds = sells.reduce((s, r) => s + (r.amount != null ? Number(r.amount) : 0), 0)
  const up = realized >= 0

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <Link href="/collection" className="text-sm text-zinc-500 hover:text-zinc-900">← Collection</Link>
          <h1 className="text-2xl font-bold text-zinc-900 mt-1">Transactions</h1>
        </div>
        {sells.length > 0 && (
          <a
            href="/api/collection/export"
            download
            className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-700 ring-1 ring-zinc-300 hover:bg-zinc-50"
          >
            Export CSV
          </a>
        )}
      </div>

      {/* Realized summary */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">Realized P&amp;L</p>
          <p className={`text-2xl font-light tabular-nums mt-1 ${up ? 'text-emerald-600' : 'text-red-600'}`}>
            {sells.length ? `${up ? '+' : '−'}${fmtUSD(Math.abs(realized))}` : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">Total proceeds</p>
          <p className="text-2xl font-light tabular-nums mt-1 text-zinc-900">{fmtUSD(proceeds)}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">Sales</p>
          <p className="text-2xl font-light tabular-nums mt-1 text-zinc-900">{sells.length}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white py-16 text-center">
          <p className="text-zinc-900 font-semibold mb-1">No activity yet</p>
          <p className="text-sm text-zinc-500">Buys, grades, and sales of your collection will show up here.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-zinc-500 border-b border-zinc-100">
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Card</th>
                <th className="px-4 py-3 font-semibold">Event</th>
                <th className="px-4 py-3 font-semibold text-right">Qty</th>
                <th className="px-4 py-3 font-semibold text-right">Amount</th>
                <th className="px-4 py-3 font-semibold text-right">Realized</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map(r => {
                const realizedVal = r.realized != null ? Number(r.realized) : null
                return (
                  <tr key={`${r.kind}-${r.source_id}`} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">{fmtDate(r.happened_at)}</td>
                    <td className="px-4 py-3">
                      <Link href={`/card/${r.card_id}`} className="font-medium text-zinc-900 hover:text-orange-600">
                        {nameByCard.get(r.card_id) ?? r.card_id}
                      </Link>
                      {r.to_grade && r.to_grade.trim() !== '' && (
                        <span className="text-zinc-400"> · {r.kind === 'grade' ? `${r.from_grade} → ${r.to_grade}` : gradeLabel(r.to_grade.split(' ')[0], r.to_grade.split(' ').slice(1).join(' '))}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${KIND_DOT[r.kind] ?? 'bg-zinc-300'}`} />
                        <span className="text-zinc-700">{KIND_LABEL[r.kind] ?? r.kind}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{r.quantity ?? ''}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-900">
                      {r.amount != null ? fmtUSD(Number(r.amount)) : '—'}
                      {r.kind === 'grade' && r.shipping_cost != null && Number(r.shipping_cost) > 0 && (
                        <span className="block text-[10px] text-zinc-400">incl. {fmtUSD(Number(r.shipping_cost))} ship</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {realizedVal != null ? (
                        <span className={`font-semibold ${realizedVal >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {realizedVal >= 0 ? '+' : '−'}{fmtUSD(Math.abs(realizedVal))}
                        </span>
                      ) : <span className="text-zinc-300">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
