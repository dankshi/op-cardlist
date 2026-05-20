import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { isHiddenByFields } from '@/lib/cards'
import { HoverThumb } from '@/components/admin/HoverThumb'
import { CardAssignmentTile } from '@/components/admin/CardAssignmentTile'
import { SET_NAME_MAP } from '@/lib/set-names'

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
  type: string | null
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

interface TcgProductRow {
  product_id: number
  product_name: string
  set_name: string | null
  card_number: string | null
  product_url_name: string | null
}

// Strip everything after the underscore: 'OP09-076_p2' → 'OP09-076'.
// Used to find TCG product candidates that share the card number with a
// Bandai variant card.
function bandaiNumber(cardId: string): string {
  return cardId.split('_')[0]
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
  // human-review items. Filtered to sellable cards only further down.
  const reviewRowsRaw = (await paginate<MappingRow>((from, to) =>
    supabase.from('card_tcgplayer_mapping').select('*').eq('source', 'review').order('card_id').range(from, to),
  )) as MappingRow[]

  const priorMap = new Map<string, PriorMapping>()
  // Note: tcgplayer_card_prices no longer has mapping cols after the
  // Migration F strip. Prior values for conflict display would need to
  // come from card_mappings_legacy if we want a comparison view. For now
  // we just show the auto-match, the prior is empty.

  // Pull ALL cards + ALL mappings, then narrow to sellable cards only
  // (skip hidden low-rarity standard prints — we don't list those on the
  // site, so we don't need a TCGplayer mapping for them either).
  const allCardsRaw = await paginate<CardRow>((from, to) =>
    supabase.from('cards').select('id, name, set_id, type, rarity, art_style, image_url').order('id').range(from, to),
  )
  const allCards = allCardsRaw.filter(c => !isHiddenByFields(c.set_id, c.type, c.rarity, c.art_style))
  const allMappings = await paginate<MappingRow>((from, to) =>
    supabase.from('card_tcgplayer_mapping').select('*').range(from, to),
  )
  const sellableIds = new Set(allCards.map(c => c.id))
  const mappingByCardId = new Map<string, MappingRow>()
  for (const m of allMappings) {
    if (sellableIds.has(m.card_id)) mappingByCardId.set(m.card_id, m)
  }
  const unmappedCards = allCards.filter(c => !mappingByCardId.has(c.id))

  // Load all TCGplayer products so we can show candidate suggestions
  // beside each unmapped card. Only loaded once, indexed by
  // (set_name, card_number) for O(1) lookup per card.
  const tcgProducts = await paginate<TcgProductRow>((from, to) =>
    supabase.from('tcgplayer_products').select('product_id, product_name, set_name, card_number, product_url_name').range(from, to),
  )
  const productsBySetAndNumber = new Map<string, TcgProductRow[]>()
  for (const p of tcgProducts) {
    if (!p.set_name || !p.card_number) continue
    const key = `${p.set_name}::${p.card_number.toUpperCase()}`
    const list = productsBySetAndNumber.get(key)
    if (list) list.push(p)
    else productsBySetAndNumber.set(key, [p])
  }
  // Build a per-card_id → claimed product map so we can tell whether a
  // candidate is "claimed by THIS card" (still selectable, show as current)
  // vs. "claimed by some OTHER card" (hide from suggestions).
  const productClaimedBy = new Map<number, string>()
  for (const m of mappingByCardId.values()) productClaimedBy.set(m.tcgplayer_product_id, m.card_id)

  // candidatesForCard(c) returns TCG products at the card's set+number,
  // excluding any product claimed by a DIFFERENT card. Works for both
  // unmapped cards (show all unclaimed) and conflicts (show unclaimed +
  // the product this card currently maps to, so admin can keep or swap).
  function candidatesForCard(c: { id: string; set_id: string }): TcgProductRow[] {
    const slugs = SET_NAME_MAP[c.set_id] ?? []
    const num = bandaiNumber(c.id).toUpperCase()
    const out: TcgProductRow[] = []
    for (const slug of slugs) {
      const list = productsBySetAndNumber.get(`${slug}::${num}`)
      if (list) {
        for (const p of list) {
          const claimedBy = productClaimedBy.get(p.product_id)
          if (!claimedBy || claimedBy === c.id) out.push(p)
        }
      }
    }
    return out
  }

  // Precompute for unmapped cards (server render needs them).
  const candidatesByCardId = new Map<string, TcgProductRow[]>()
  for (const c of unmappedCards) candidatesByCardId.set(c.id, candidatesForCard(c))

  // Stats are computed in-memory from the filtered list so they match what
  // the grids below show. Hidden cards never appear in any count.
  const totalCards = allCards.length
  const totalMapped = mappingByCardId.size
  const autoCount = Array.from(mappingByCardId.values()).filter(m => m.source === 'auto').length
  const manualCount = Array.from(mappingByCardId.values()).filter(m => m.source === 'manual').length
  const reviewRows = reviewRowsRaw.filter(r => sellableIds.has(r.card_id))
  const reviewCount = reviewRows.length
  const unmapped = totalCards - totalMapped

  // Group conflicts by set so admins can fix one set at a time. Sort by
  // set_id ascending so the order matches the unmapped/mapped sections.
  // Each conflict gets its own candidates list (which includes its
  // current product so admin can keep it).
  interface ConflictItem {
    review: MappingRow
    card: CardRow | undefined
    candidates: TcgProductRow[]
  }
  const conflictsBySet = new Map<string, ConflictItem[]>()
  for (const r of reviewRows) {
    const card = allCards.find(c => c.id === r.card_id)
    if (!card) continue
    const item: ConflictItem = {
      review: r,
      card,
      candidates: candidatesForCard(card),
    }
    const list = conflictsBySet.get(card.set_id)
    if (list) list.push(item)
    else conflictsBySet.set(card.set_id, [item])
  }
  const conflictSections = Array.from(conflictsBySet.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  // Group unmapped by set_id, sort by count desc (worst sets first).
  const unmappedBySet = new Map<string, CardRow[]>()
  for (const c of unmappedCards) {
    const list = unmappedBySet.get(c.set_id)
    if (list) list.push(c)
    else unmappedBySet.set(c.set_id, [c])
  }
  const setSections = Array.from(unmappedBySet.entries()).sort((a, b) => b[1].length - a[1].length)

  // Group mapped by set_id. Used for the spot-check section below — sort
  // alphabetically by set so the order is predictable when scanning.
  const mappedCards = allCards.filter(c => mappingByCardId.has(c.id))
  const mappedBySet = new Map<string, CardRow[]>()
  for (const c of mappedCards) {
    const list = mappedBySet.get(c.set_id)
    if (list) list.push(c)
    else mappedBySet.set(c.set_id, [c])
  }
  const mappedSections = Array.from(mappedBySet.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Card ↔ TCGplayer Mappings</h1>
      <p className="text-zinc-600 mb-6">
        Auto-matcher results from <code className="bg-zinc-100 px-1 rounded">scripts/auto-map-tcgplayer.ts</code>.
        Each sellable card should map to one TCGplayer product; conflicts and unmapped cards are surfaced here
        for manual resolution. Hidden cards (low-rarity standard prints) are excluded from every count and grid —
        see <Link href="/admin/cards" className="text-blue-600 hover:underline">Edit Cards</Link> (filter:
        Hidden only) for the full list. Click any thumbnail to open the full image.
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
            Auto-matcher picked a different product than what was there before. Click <strong>Assign</strong> on the
            correct candidate to lock it in as <code className="bg-zinc-100 px-1 rounded">source=&apos;manual&apos;</code>.
            The current pick is marked.
          </p>
          <div className="space-y-2 mb-10">
            {conflictSections.map(([setId, items]) => (
              <details key={setId} open className="border border-amber-200 rounded-lg">
                <summary className="cursor-pointer px-4 py-3 bg-amber-50 hover:bg-amber-100 font-medium flex items-center gap-3">
                  <span className="font-mono text-sm">{setId}</span>
                  <span className="text-zinc-500 text-sm">— {items.length} conflict{items.length === 1 ? '' : 's'}</span>
                </summary>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map(({ review: r, card, candidates }) => (
                    <CardAssignmentTile
                      key={r.card_id}
                      cardId={r.card_id}
                      cardName={card?.name ?? ''}
                      cardRarity={card?.rarity ?? null}
                      cardArtStyle={card?.art_style ?? null}
                      imageUrl={card?.image_url ?? null}
                      candidates={candidates}
                      currentProductId={r.tcgplayer_product_id}
                    />
                  ))}
                </div>
              </details>
            ))}
          </div>
        </>
      )}

      <h2 className="text-lg font-semibold mb-2">Unmapped cards by set ({unmapped})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Each unmapped card is paired with the unclaimed TCGplayer products at its card number — click one to assign it as a manual mapping.
        Hover any thumbnail to see the full image. The card stays in this section until the page refreshes.
      </p>

      <div className="space-y-2">
        {setSections.map(([setId, cards]) => (
          <details key={setId} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setId}</span>
              <span className="text-zinc-500 text-sm">— {cards.length} unmapped</span>
            </summary>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {cards.map(c => (
                <CardAssignmentTile
                  key={c.id}
                  cardId={c.id}
                  cardName={c.name}
                  cardRarity={c.rarity}
                  cardArtStyle={c.art_style}
                  imageUrl={c.image_url}
                  candidates={candidatesByCardId.get(c.id) ?? []}
                  emptyNote="no unclaimed TCG products"
                />
              ))}
            </div>
          </details>
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-2 mt-10">Mapped cards by set ({mappedCards.length})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Each card with its current TCGplayer product. Scan for mis-matches —
        a wrong auto-pick (e.g. a base card mapped to an Alt Art listing) will
        usually jump out when card name and product name don&apos;t align.
        Source badge shows whether it was set by the matcher (auto) or by hand (manual).
      </p>

      <div className="space-y-2">
        {mappedSections.map(([setId, cards]) => (
          <details key={setId} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setId}</span>
              <span className="text-zinc-500 text-sm">— {cards.length} mapped</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2">Card</th>
                    <th className="px-3 py-2">TCGplayer product</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {cards.map(c => {
                    const m = mappingByCardId.get(c.id)!
                    const sourceClass =
                      m.source === 'manual' ? 'bg-blue-100 text-blue-700' :
                      m.source === 'review' ? 'bg-amber-100 text-amber-700' :
                      'bg-emerald-100 text-emerald-700'
                    return (
                      <tr key={c.id} className="border-t border-zinc-100">
                        <td className="px-3 py-2 w-20">
                          {c.image_url ? (
                            <HoverThumb src={c.image_url} alt={c.name} className="w-16 rounded border border-zinc-200" />
                          ) : <span className="text-zinc-300 text-xs">no img</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link className="text-blue-600 hover:underline" href={`/card/${c.id}`}>{c.id}</Link>
                          <div className="text-zinc-700 font-sans">{c.name}</div>
                          <div className="text-zinc-400">{c.rarity ?? '-'} · {c.art_style ?? '-'}</div>
                        </td>
                        <td className="px-3 py-2">
                          {m.tcgplayer_url ? (
                            <a href={m.tcgplayer_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                              {m.tcgplayer_name ?? `product ${m.tcgplayer_product_id}`} ↗
                            </a>
                          ) : (m.tcgplayer_name ?? `product ${m.tcgplayer_product_id}`)}
                          <div className="text-xs text-zinc-400">product {m.tcgplayer_product_id}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded ${sourceClass}`}>{m.source}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
