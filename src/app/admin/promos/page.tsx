import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HoverThumb } from '@/components/admin/HoverThumb'

export const dynamic = 'force-dynamic'

interface CardRow {
  id: string
  name: string
  set_id: string
  rarity: string | null
  art_style: string | null
  image_url: string | null
  type: string | null
}

interface MappingRow {
  card_id: string
  tcgplayer_name: string | null
}

interface PromoCard extends CardRow {
  tcgName: string | null
  event: string | null
  tier: string | null
}

// --- Event parser (exploratory, inline here; will move to shared lib once
// we commit to a schema field for it) ----------------------------------

const VARIANT_MARKERS = new Set([
  'alternate art', 'parallel', 'manga', 'sp', 'tr', 'super alternate art',
  'wanted poster', 'pirate foil', 'jolly roger foil', 'textured foil',
  'full art', 'reprint', 'sparkle foil', 'holofoil', 'gold',
])

function looksLikeBandaiNumber(s: string): boolean {
  if (/^[A-Z]?[A-Z0-9]+-\d+$/i.test(s)) return true
  if (/^\d{2,4}$/.test(s)) return true
  if (/^[A-Z]-\d+$/i.test(s)) return true
  return false
}

/** Strip the right-most paren group from a TCGplayer name and treat it as
 *  the event tag. Skip groups that are obviously variant markers
 *  ("(Alternate Art)") or bandai identifiers ("(P-001)"). Trailing
 *  [Tier] becomes its own field. */
function parseEvent(name: string | null): { event: string | null; tier: string | null } {
  if (!name) return { event: null, tier: null }
  let body = name
  let tier: string | null = null
  const tierMatch = body.match(/\s*\[([^\]]+)\]\s*$/)
  if (tierMatch) {
    tier = tierMatch[1].trim()
    body = body.slice(0, tierMatch.index).trim()
  }
  const groups = [...body.matchAll(/\(([^()]+)\)/g)].map(m => m[1].trim())
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (VARIANT_MARKERS.has(g.toLowerCase())) continue
    if (looksLikeBandaiNumber(g)) continue
    return { event: g, tier }
  }
  return { event: null, tier }
}

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

interface PageProps {
  searchParams: Promise<{ view?: string }>
}

export default async function PromosAdminPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { view: viewParam } = await searchParams
  const view: 'event' | 'character' | 'unparsed' =
    viewParam === 'character' ? 'character' :
    viewParam === 'unparsed' ? 'unparsed' :
    'event'

  const [cards, mappings] = await Promise.all([
    paginate<CardRow>((from, to) =>
      supabase.from('cards').select('id, name, set_id, type, rarity, art_style, image_url')
        .eq('set_id', 'promo').order('id').range(from, to),
    ),
    paginate<MappingRow>((from, to) =>
      supabase.from('card_tcgplayer_mapping').select('card_id, tcgplayer_name').range(from, to),
    ),
  ])

  const tcgByCard = new Map(mappings.map(m => [m.card_id, m.tcgplayer_name]))
  const promoCards: PromoCard[] = cards.map(c => {
    const tcgName = tcgByCard.get(c.id) ?? null
    const { event, tier } = parseEvent(tcgName)
    return { ...c, tcgName, event, tier }
  })

  const parsedCount = promoCards.filter(c => c.event).length
  const tcgNameCount = promoCards.filter(c => c.tcgName).length

  // --- Bucket according to selected view --------------------------------
  type Section = { key: string; label: string; cards: PromoCard[] }
  let sections: Section[] = []

  if (view === 'event') {
    const byEvent = new Map<string, PromoCard[]>()
    for (const c of promoCards) {
      if (!c.event) continue
      const list = byEvent.get(c.event) ?? []
      list.push(c)
      byEvent.set(c.event, list)
    }
    sections = [...byEvent.entries()]
      .map(([event, cs]) => ({ key: event, label: event, cards: cs }))
      .sort((a, b) => b.cards.length - a.cards.length)
  } else if (view === 'character') {
    const byName = new Map<string, PromoCard[]>()
    for (const c of promoCards) {
      const list = byName.get(c.name) ?? []
      list.push(c)
      byName.set(c.name, list)
    }
    sections = [...byName.entries()]
      .map(([name, cs]) => ({ key: name, label: name, cards: cs }))
      .sort((a, b) => b.cards.length - a.cards.length)
  } else {
    sections = [{ key: 'unparsed', label: 'Cards without a parseable event', cards: promoCards.filter(c => !c.event) }]
  }

  // Within each section, sort by card_id for stable diffs.
  for (const s of sections) s.cards.sort((a, b) => a.id.localeCompare(b.id))

  function viewLink(target: 'event' | 'character' | 'unparsed'): string {
    return target === 'event' ? '/admin/promos' : `/admin/promos?view=${target}`
  }

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Promo Cards</h1>
      <p className="text-zinc-600 mb-4">
        All cards with <code className="bg-zinc-100 px-1 rounded">set_id = &apos;promo&apos;</code>. Bandai
        files these into a single bucket; PSA splits them into per-event sets. Use this page to figure out the
        right groupings before we add a <code className="bg-zinc-100 px-1 rounded">promo_event</code> field
        and per-event PSA matching.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Total promo cards</p>
          <p className="text-2xl font-semibold text-zinc-900">{promoCards.length}</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">With TCG name</p>
          <p className="text-2xl font-semibold text-zinc-900">{tcgNameCount}</p>
          <p className="text-xs text-zinc-500">{promoCards.length - tcgNameCount} missing</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Event parsed</p>
          <p className="text-2xl font-semibold text-emerald-600">{parsedCount}</p>
          <p className="text-xs text-zinc-500">
            {promoCards.length - parsedCount} unparsed (incl. {promoCards.length - tcgNameCount} missing TCG name)
          </p>
        </div>
      </div>

      {/* View switcher */}
      <div className="flex items-center gap-2 mb-4 border-b border-zinc-200">
        {([
          ['event', `By event (${new Set(promoCards.map(c => c.event).filter(Boolean)).size})`],
          ['character', `By character (${new Set(promoCards.map(c => c.name)).size})`],
          ['unparsed', `Unparsed (${promoCards.length - parsedCount})`],
        ] as const).map(([key, label]) => {
          const active = view === key
          return (
            <Link
              key={key}
              href={viewLink(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                active
                  ? 'border-orange-500 text-orange-600'
                  : 'border-transparent text-zinc-500 hover:text-zinc-900'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      <div className="space-y-2">
        {sections.map(section => {
          const tiers = new Set(section.cards.map(c => c.tier).filter(Boolean))
          return (
            <details key={section.key} className="border border-zinc-200 rounded-lg" open={view === 'unparsed'}>
              <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
                <span className="text-zinc-900">{section.label}</span>
                {tiers.size > 0 && (
                  <span className="text-xs text-zinc-500 font-normal">
                    tiers: {[...tiers].join(', ')}
                  </span>
                )}
                <span className="ml-auto text-zinc-500 text-sm tabular-nums">{section.cards.length}</span>
              </summary>
              <div className="p-4 space-y-2">
                {section.cards.map(c => (
                  <div key={c.id} className="flex gap-3 text-sm items-start">
                    <div className="w-16 flex-shrink-0">
                      {c.image_url ? (
                        <HoverThumb src={c.image_url} alt={c.name} />
                      ) : (
                        <div className="w-full aspect-[5/7] bg-zinc-100 rounded border border-zinc-200 flex items-center justify-center text-zinc-400 text-[10px]">no img</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link className="font-mono text-blue-600 hover:underline text-xs" href={`/card/${c.id}`}>{c.id}</Link>
                        <span className="font-semibold text-zinc-900">{c.name}</span>
                        {c.rarity && (
                          <span className="text-[10px] bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded">{c.rarity}</span>
                        )}
                        {c.art_style && c.art_style !== 'standard' && (
                          <span className="text-[10px] bg-zinc-100 text-zinc-700 px-1.5 py-0.5 rounded">{c.art_style}</span>
                        )}
                        {c.tier && (
                          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">[{c.tier}]</span>
                        )}
                        {view !== 'event' && c.event && (
                          <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">{c.event}</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 truncate" title={c.tcgName ?? undefined}>
                        {c.tcgName ?? <span className="italic text-zinc-400">no TCGplayer name mapped</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
