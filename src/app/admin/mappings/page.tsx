import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface MappingRow {
  card_id: string
  tcgplayer_product_id: number
  tcgplayer_url: string | null
  tcgplayer_name: string | null
  source: 'auto' | 'manual' | 'review'
  mapped_by: string | null
  updated_at: string
}

interface CardRow {
  id: string
  name: string
  set_id: string
  rarity: string | null
  art_style: string | null
}

interface PriorMapping {
  card_id: string
  tcgplayer_product_id: number | null
  tcgplayer_product_name: string | null
  tcgplayer_url: string | null
}

export default async function MappingsAdminPage() {
  const supabase = await createClient()

  // Pull conflicts (source='review') first — these are the highest-priority
  // human-review items.
  const { data: reviewRowsRaw } = await supabase
    .from('card_tcgplayer_mapping')
    .select('*')
    .eq('source', 'review')
    .order('card_id')
  const reviewRows = (reviewRowsRaw ?? []) as MappingRow[]

  // Pull the prior (card_prices) mapping for each conflict so the reviewer
  // can compare side-by-side.
  let priorMap = new Map<string, PriorMapping>()
  if (reviewRows.length > 0) {
    const { data: priorRaw } = await supabase
      .from('tcgplayer_card_prices')
      .select('card_id, tcgplayer_product_id, tcgplayer_product_name, tcgplayer_url')
      .in('card_id', reviewRows.map(r => r.card_id))
    for (const p of (priorRaw ?? []) as PriorMapping[]) priorMap.set(p.card_id, p)
  }

  // Summary stats. Paginate cards count + mapping count separately since
  // we don't need every row to compute the dashboard tiles.
  const { count: totalCards } = await supabase.from('cards').select('*', { count: 'exact', head: true })
  const { count: totalMapped } = await supabase.from('card_tcgplayer_mapping').select('*', { count: 'exact', head: true })
  const { count: autoCount } = await supabase.from('card_tcgplayer_mapping').select('*', { count: 'exact', head: true }).eq('source', 'auto')
  const { count: manualCount } = await supabase.from('card_tcgplayer_mapping').select('*', { count: 'exact', head: true }).eq('source', 'manual')
  const reviewCount = reviewRows.length
  const unmapped = (totalCards ?? 0) - (totalMapped ?? 0)

  // Unmapped sample: cards that have no row in card_tcgplayer_mapping at
  // all. We can't easily LEFT JOIN here without raw SQL, so just take the
  // cards table and subtract — limit display to 50.
  let unmappedSample: CardRow[] = []
  if (unmapped > 0) {
    const { data: mappedIds } = await supabase.from('card_tcgplayer_mapping').select('card_id')
    const mappedSet = new Set((mappedIds ?? []).map((m) => m.card_id))
    const { data: someCards } = await supabase
      .from('cards')
      .select('id, name, set_id, rarity, art_style')
      .order('id')
      .limit(500)
    unmappedSample = ((someCards ?? []) as CardRow[]).filter(c => !mappedSet.has(c.id)).slice(0, 50)
  }

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Card ↔ TCGplayer Mappings</h1>
      <p className="text-zinc-600 mb-6">
        Auto-matcher results from <code className="bg-zinc-100 px-1 rounded">scripts/auto-map-tcgplayer.ts</code>.
        Each card in <code className="bg-zinc-100 px-1 rounded">cards</code> should map to one TCGplayer product;
        conflicts (auto-match disagrees with the prior <code className="bg-zinc-100 px-1 rounded">card_prices</code> mapping)
        and unmapped cards are surfaced here for manual resolution.
      </p>

      <div className="grid grid-cols-5 gap-3 mb-8">
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Total cards</p>
          <p className="text-2xl font-semibold">{totalCards ?? '—'}</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Auto-matched</p>
          <p className="text-2xl font-semibold text-emerald-600">{autoCount ?? 0}</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Manual</p>
          <p className="text-2xl font-semibold text-blue-600">{manualCount ?? 0}</p>
        </div>
        <div className={`border rounded-lg p-4 ${reviewCount > 0 ? 'border-amber-300 bg-amber-50' : 'border-zinc-200'}`}>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Review needed</p>
          <p className={`text-2xl font-semibold ${reviewCount > 0 ? 'text-amber-600' : 'text-zinc-500'}`}>{reviewCount}</p>
        </div>
        <div className={`border rounded-lg p-4 ${unmapped > 0 ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Unmapped</p>
          <p className={`text-2xl font-semibold ${unmapped > 0 ? 'text-red-600' : 'text-zinc-500'}`}>{unmapped}</p>
        </div>
      </div>

      {reviewRows.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-2 text-amber-700">⚠ Conflicts needing review ({reviewRows.length})</h2>
          <p className="text-sm text-zinc-600 mb-3">
            The auto-matcher picked a different product than the existing card_prices mapping. Look at both, then update
            <code className="bg-zinc-100 px-1 rounded">card_tcgplayer_mapping</code> directly in Supabase Studio (set
            <code className="bg-zinc-100 px-1 rounded">source = &apos;manual&apos;</code> on the chosen row).
          </p>
          <div className="overflow-x-auto border border-zinc-200 rounded-lg mb-10">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Card</th>
                  <th className="px-3 py-2">Auto-match (proposed)</th>
                  <th className="px-3 py-2">Prior (card_prices)</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map(r => {
                  const prior = priorMap.get(r.card_id)
                  return (
                    <tr key={r.card_id} className="border-t border-zinc-100">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link className="text-blue-600 hover:underline" href={`/card/${r.card_id}`}>{r.card_id}</Link>
                      </td>
                      <td className="px-3 py-2">
                        {r.tcgplayer_url ? (
                          <a href={r.tcgplayer_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            {r.tcgplayer_name} ↗
                          </a>
                        ) : r.tcgplayer_name}
                        <div className="text-xs text-zinc-400">product {r.tcgplayer_product_id}</div>
                      </td>
                      <td className="px-3 py-2">
                        {prior?.tcgplayer_url ? (
                          <a href={prior.tcgplayer_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            {prior.tcgplayer_product_name ?? `product ${prior.tcgplayer_product_id}`} ↗
                          </a>
                        ) : (
                          <span className="text-zinc-400">{prior?.tcgplayer_product_name ?? '—'}</span>
                        )}
                        <div className="text-xs text-zinc-400">product {prior?.tcgplayer_product_id ?? '—'}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="text-lg font-semibold mb-2">Unmapped cards ({unmapped})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Cards in <code className="bg-zinc-100 px-1 rounded">cards</code> with no row in
        <code className="bg-zinc-100 px-1 rounded">card_tcgplayer_mapping</code>. Most are likely
        in sets the auto-matcher couldn&apos;t see (no <code className="bg-zinc-100 px-1 rounded">SET_NAME_MAP</code> entry)
        or ambiguous matches with multiple TCGplayer candidates. Showing first 50.
      </p>
      <div className="overflow-x-auto border border-zinc-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Card</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Set</th>
              <th className="px-3 py-2">Rarity</th>
              <th className="px-3 py-2">Art</th>
            </tr>
          </thead>
          <tbody>
            {unmappedSample.map(c => (
              <tr key={c.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link className="text-blue-600 hover:underline" href={`/card/${c.id}`}>{c.id}</Link>
                </td>
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 text-zinc-500">{c.set_id}</td>
                <td className="px-3 py-2 text-zinc-500">{c.rarity ?? '—'}</td>
                <td className="px-3 py-2 text-zinc-500">{c.art_style ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
