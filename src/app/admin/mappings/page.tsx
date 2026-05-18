/* eslint-disable @next/next/no-img-element */
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
  image_url: string | null
}

interface PriorMapping {
  card_id: string
  tcgplayer_product_id: number | null
  tcgplayer_product_name: string | null
  tcgplayer_url: string | null
}

// Paginated fetcher to defeat Supabase's 1000-row cap.
async function paginate<T>(
  fetcher: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const all: T[] = []
  for (let f = 0; ; f += 1000) {
    const { data, error } = await fetcher(f, f + 999)
    if (error) break
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < 1000) break
  }
  return all
}

export default async function MappingsAdminPage() {
  const supabase = await createClient()

  // Pull conflicts (source='review') first — these are the highest-priority
  // human-review items.
  const reviewRows = (await paginate<MappingRow>((from, to) =>
    supabase.from('card_tcgplayer_mapping').select('*').eq('source', 'review').order('card_id').range(from, to),
  )) as MappingRow[]

  const priorMap = new Map<string, PriorMapping>()
  // Note: tcgplayer_card_prices no longer has mapping cols after the
  // Migration F strip. Prior values for conflict display would need to
  // come from card_mappings_legacy if we want a comparison view. For now
  // we just show the auto-match, the prior is empty.

  // Summary stats
  const { count: totalCards } = await supabase.from('cards').select('*', { count: 'exact', head: true })
  const { count: totalMapped } = await supabase.from('card_tcgplayer_mapping').select('*', { count: 'exact', head: true })
  const { count: autoCount } = await supabase.from('card_tcgplayer_mapping').select('*', { count: 'exact', head: true }).eq('source', 'auto')
  const { count: manualCount } = await supabase.from('card_tcgplayer_mapping').select('*', { count: 'exact', head: true }).eq('source', 'manual')
  const reviewCount = reviewRows.length
  const unmapped = (totalCards ?? 0) - (totalMapped ?? 0)

  // Pull ALL cards + ALL mapped card_ids so we can group unmapped per set.
  const allCards = await paginate<CardRow>((from, to) =>
    supabase.from('cards').select('id, name, set_id, rarity, art_style, image_url').order('id').range(from, to),
  )
  const mappedIds = await paginate<{ card_id: string }>((from, to) =>
    supabase.from('card_tcgplayer_mapping').select('card_id').range(from, to),
  )
  const mappedSet = new Set(mappedIds.map(m => m.card_id))
  const unmappedCards = allCards.filter(c => !mappedSet.has(c.id))

  // Group unmapped by set_id, sort by count desc (worst sets first).
  const unmappedBySet = new Map<string, CardRow[]>()
  for (const c of unmappedCards) {
    const list = unmappedBySet.get(c.set_id)
    if (list) list.push(c)
    else unmappedBySet.set(c.set_id, [c])
  }
  const setSections = Array.from(unmappedBySet.entries()).sort((a, b) => b[1].length - a[1].length)

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Card ↔ TCGplayer Mappings</h1>
      <p className="text-zinc-600 mb-6">
        Auto-matcher results from <code className="bg-zinc-100 px-1 rounded">scripts/auto-map-tcgplayer.ts</code>.
        Each card in <code className="bg-zinc-100 px-1 rounded">cards</code> should map to one TCGplayer product;
        conflicts and unmapped cards are surfaced here for manual resolution. Click any card thumbnail to open the full image.
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
            Auto-matcher picked a different product than the prior mapping. Update
            <code className="bg-zinc-100 px-1 rounded">card_tcgplayer_mapping</code> directly in Supabase Studio (set
            <code className="bg-zinc-100 px-1 rounded">source = &apos;manual&apos;</code> on the correct row).
          </p>
          <div className="overflow-x-auto border border-zinc-200 rounded-lg mb-10">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">Card</th>
                  <th className="px-3 py-2">Auto-match (proposed)</th>
                  <th className="px-3 py-2">Prior</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map(r => {
                  const card = allCards.find(c => c.id === r.card_id)
                  const prior = priorMap.get(r.card_id)
                  return (
                    <tr key={r.card_id} className="border-t border-zinc-100">
                      <td className="px-3 py-2 w-20">
                        {card?.image_url ? (
                          <a href={card.image_url} target="_blank" rel="noreferrer">
                            <img src={card.image_url} alt={r.card_id} className="w-16 rounded border border-zinc-200 hover:opacity-80" />
                          </a>
                        ) : <span className="text-zinc-300 text-xs">no img</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link className="text-blue-600 hover:underline" href={`/card/${r.card_id}`}>{r.card_id}</Link>
                        <div className="text-xs text-zinc-500">{card?.name}</div>
                      </td>
                      <td className="px-3 py-2">
                        {r.tcgplayer_url ? (
                          <a href={r.tcgplayer_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                            {r.tcgplayer_name} ↗
                          </a>
                        ) : r.tcgplayer_name}
                        <div className="text-xs text-zinc-400">product {r.tcgplayer_product_id}</div>
                      </td>
                      <td className="px-3 py-2 text-zinc-400">
                        {prior?.tcgplayer_product_name ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="text-lg font-semibold mb-2">Unmapped cards by set ({unmapped})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Click a set to expand. Each thumbnail opens the full card image in a new tab so you can identify the right TCGplayer product.
      </p>

      <div className="space-y-2">
        {setSections.map(([setId, cards]) => (
          <details key={setId} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setId}</span>
              <span className="text-zinc-500 text-sm">— {cards.length} unmapped</span>
            </summary>
            <div className="p-4 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {cards.map(c => (
                <div key={c.id} className="text-xs">
                  {c.image_url ? (
                    <a href={c.image_url} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity">
                      <img src={c.image_url} alt={c.name} className="w-full rounded border border-zinc-200" loading="lazy" />
                    </a>
                  ) : (
                    <div className="w-full aspect-[5/7] bg-zinc-100 rounded border border-zinc-200 flex items-center justify-center text-zinc-400 text-[10px]">
                      no image
                    </div>
                  )}
                  <div className="mt-1 font-mono truncate">
                    <Link className="text-blue-600 hover:underline" href={`/card/${c.id}`}>{c.id}</Link>
                  </div>
                  <div className="text-zinc-700 truncate" title={c.name}>{c.name}</div>
                  <div className="text-zinc-400">{c.rarity ?? '-'} · {c.art_style ?? '-'}</div>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
