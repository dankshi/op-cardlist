import Link from 'next/link'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { SlabOverridesEditor, type OverrideRow } from '@/components/admin/SlabOverridesEditor'

export const dynamic = 'force-dynamic'

interface SourceHealth {
  source: string
  total: number
  visible: number
  excluded: number
  hidden: number
  last_ingested: string | null
  latest_sale: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  ebay: 'eBay',
  alt: 'Alt',
  admin: 'Manual',
  goldin: 'Goldin',
  fanatics: 'Fanatics Collect',
  whatnot: 'Whatnot',
  psa_apr: 'PSA APR',
}

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toISOString().slice(0, 10)
}

export default async function PriceSourcesAdminPage() {
  const admin = getSupabaseAdmin()

  const [{ data: healthRaw }, { data: overrideRows }] = await Promise.all([
    admin.from('slab_source_health').select('*'),
    admin.from('slab_value_overrides').select('card_id, grading_company, grade, value, note, set_at').order('set_at', { ascending: false }),
  ])
  const health = (healthRaw ?? []) as SourceHealth[]
  health.sort((a, b) => b.total - a.total)

  const overrideCardIds = [...new Set((overrideRows ?? []).map(o => o.card_id as string))]
  const { data: cardRows } = overrideCardIds.length
    ? await admin.from('cards').select('id, name').in('id', overrideCardIds)
    : { data: [] as { id: string; name: string }[] }
  const nameById = new Map((cardRows ?? []).map(c => [c.id, c.name]))

  const overrides: OverrideRow[] = (overrideRows ?? []).map(o => ({
    cardId: o.card_id as string,
    cardName: nameById.get(o.card_id as string) ?? '',
    company: o.grading_company as string,
    grade: o.grade as string,
    value: Number(o.value),
    note: (o.note as string | null) ?? null,
    setAt: o.set_at as string,
  }))

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-bold mb-2">Price Sources</h1>
      <p className="text-zinc-600 mb-6">
        Ingestion health per slab-sale source and the pinned-value overrides that beat the computed comp.
        Curate individual sales on the <Link href="/admin/slab-sales" className="text-blue-600 hover:underline">Slab Sales</Link> queue.
        TCGplayer scraper health lives on <Link href="/admin/scraper-hq" className="text-blue-600 hover:underline">Scraper HQ</Link>.
      </p>

      <h2 className="text-lg font-semibold mb-3">Source health</h2>
      {health.length === 0 ? (
        <p className="text-sm text-zinc-400 mb-10 border border-dashed border-zinc-200 rounded-lg py-8 text-center">
          No slab sales ingested yet. Run <code className="bg-zinc-100 px-1 rounded">npm run scrape:ebay-graded</code>, then{' '}
          <code className="bg-zinc-100 px-1 rounded">npm run compute:slab-values</code>.
        </p>
      ) : (
        <div className="overflow-x-auto border border-zinc-200 rounded-lg mb-10">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Visible</th>
                <th className="px-3 py-2 text-right">Excluded</th>
                <th className="px-3 py-2">Last ingested</th>
                <th className="px-3 py-2">Latest sale</th>
              </tr>
            </thead>
            <tbody>
              {health.map(h => (
                <tr key={h.source} className="border-t border-zinc-100">
                  <td className="px-3 py-2 font-medium">{SOURCE_LABELS[h.source] ?? h.source}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.total.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{h.visible.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-600">{h.excluded.toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-600">{ago(h.last_ingested)}</td>
                  <td className="px-3 py-2 text-zinc-600">{h.latest_sale ? h.latest_sale.slice(0, 10) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-1">Value overrides</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Pin a market value for a variant where the comp is missing or wrong (e.g. a thin-market BGS Black Label 10).
        The pinned value wins over the computed comp everywhere a price is shown.
      </p>
      <SlabOverridesEditor rows={overrides} />
    </div>
  )
}
