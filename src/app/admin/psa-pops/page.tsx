import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HoverThumb } from '@/components/admin/HoverThumb'
import { PsaCandidateGroup } from '@/components/admin/PsaCandidateGroup'
import { PsaSpecLinkButton } from '@/components/admin/PsaSpecLinkButton'
import { PsaSpecManualLink } from '@/components/admin/PsaSpecManualLink'
import { InlineCardFieldEdit, ART_STYLE_OPTIONS, RARITY_OPTIONS } from '@/components/card/InlineCardFieldEdit'
import { isHiddenByFields } from '@/lib/cards'

export const dynamic = 'force-dynamic'

interface PopsRow {
  spec_id: number
  psa_set_id: number | null
  set_code: string | null
  psa_card_number: string | null
  description: string
  variety: string | null
  card_id: string | null
  source: string | null
  mapped_by: string | null
  total_pop: number | null
  tcg_name: string | null
  tcg_url: string | null
}

/** Description with trailing "(Variety)" stripped — usually the subject
 *  name. Falls back to the raw description when no variety is set. */
function subjectName(row: PopsRow): string {
  if (!row.variety) return row.description
  const escaped = row.variety.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return row.description.replace(new RegExp(`\\s*\\(${escaped}\\)\\s*$`), '').trim() || row.description
}

interface CardLite {
  id: string
  name: string
  image_url: string | null
  set_id: string
  type: string | null
  rarity: string | null
  art_style: string | null
}

/** Normalize for cross-DB name comparison: lowercase + strip punctuation
 *  that varies between PSA ('Boa Hancock'), Bandai ('Boa.Hancock') and
 *  TCGplayer ('Boa Hancock'). Includes double-quotes so PSA's
 *  `Eustass "Captain" Kid` (with spaces around quotes) matches our
 *  `Eustass"Captain"Kid` (no spaces). */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.'`"-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Token-overlap similarity for catching PSA typos like "Kouzuki Oden"
 *  vs our "Kozuki Oden" — first names differ by a letter but they share
 *  the "Oden" surname token, which is enough signal to surface as a
 *  candidate. Filters short tokens (≤ 2 chars) to avoid false matches
 *  on common initials like "D." in "Monkey D. Luffy" / "Gol D. Roger". */
function nameTokenOverlap(a: string, b: string): boolean {
  const tokensA = new Set(a.split(/\s+/).filter(t => t.length >= 3))
  const tokensB = new Set(b.split(/\s+/).filter(t => t.length >= 3))
  for (const t of tokensA) if (tokensB.has(t)) return true
  return false
}

// Combo PSA sets bundle cards from another set under one PSA listing.
// Mirrors PSA_SETS[].alsoCheckSetCodes in scripts/psa-pop-fetch.ts —
// used here so the unmapped grid can suggest cross-set candidates.
const ALSO_CHECK: Record<string, string[]> = {
  'op14-eb04': ['eb-04'],
  'op15-eb04': ['eb-04'],
}

// TCGplayer doesn't expose stable per-product URLs we can construct from
// just a name, but their search works. Pre-fill it with the spec
// description + (when present) the PSA card number, scoped to One Piece.
function tcgSearchUrl(row: PopsRow): string {
  const parts = [row.description]
  if (row.psa_card_number) parts.push(row.psa_card_number)
  const q = encodeURIComponent(parts.join(' '))
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?productLineName=one-piece-card-game&q=${q}&view=grid`
}

function staleReason(row: PopsRow): string | null {
  if (!row.card_id) return null
  if (!row.tcg_name) return 'Linked card_id no longer exists in card_prices.'

  const name = row.tcg_name.toLowerCase()
  const desc = row.description
  const has = (s: string) => name.includes(s)
  const hasAA = has('(parallel)') || has('(alternate art)')
  const hasManga = has('(manga)')
  const hasSP = has('(sp)')
  const hasTR = has('(tr)')

  if (desc.endsWith('(Special Alternate Art)')) return hasSP ? null : 'PSA says SP but linked TCGplayer name has no "(SP)".'
  if (desc.endsWith('(Treasure Rare)')) return hasTR ? null : 'PSA says TR but linked TCGplayer name has no "(TR)".'
  if (desc.endsWith('(Manga Alternate Art)')) return hasManga ? null : 'PSA says Manga but linked TCGplayer name has no "(Manga)".'
  if (desc.endsWith('(Alternate Art)')) {
    if (!hasAA) return 'PSA says Alt Art but linked TCGplayer name has no "(Parallel)" or "(Alternate Art)".'
    if (hasManga || hasSP || hasTR) return 'PSA says plain Alt Art but linked TCGplayer name carries a different variant tag.'
    return null
  }
  if (desc.endsWith('(Pre-Release)')) return null
  if (hasAA || hasManga || hasSP || hasTR) return 'PSA says base card but linked TCGplayer name has a variant tag.'
  return null
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
  searchParams: Promise<{ all?: string }>
}

export default async function PSAPopsAdminPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { all: allParam } = await searchParams
  // Default to unlinked-only — that's the actionable worklist. Admin
  // opts into the full list by clicking "All" (?all=1).
  const showOnlyUnlinked = !(allParam === '1' || allParam === 'true')

  // Secondary sort by spec_id is mandatory: ordering by non-unique
  // total_pop alone, paginated via .range(), causes ties at the 1000-row
  // boundary to duplicate some rows and silently skip others
  // (~4 rows lost out of 2871). Stable secondary key keeps pagination
  // exhaustive and deterministic.
  const rows = (await paginate<PopsRow>((from, to) =>
    supabase.from('pops_psa_with_tcg').select('*')
      .order('total_pop', { ascending: false })
      .order('spec_id', { ascending: true })
      .range(from, to),
  )) as PopsRow[]

  const cards = await paginate<CardLite>((from, to) =>
    supabase.from('cards').select('id, name, image_url, set_id, type, rarity, art_style').order('id').range(from, to),
  )
  const cardById = new Map<string, CardLite>()
  // Index by (set_id, number-portion-of-bandai) — handles cards reissued
  // in newer sets that keep their original bandai prefix. E.g. ST18-004_p1
  // (Zoro-Juurou TR) lives in set_id='op-09' with bandai number '004'; a
  // bandai-prefix index keyed off 'OP09-004' would miss it.
  const cardsBySetAndNumber = new Map<string, CardLite[]>()
  for (const c of cards) {
    cardById.set(c.id, c)
    const bandai = c.id.split('_')[0]
    const numMatch = bandai.match(/-(\d+)$/)
    const number = numMatch ? numMatch[1] : ''
    if (!number) continue
    const key = `${c.set_id}::${number}`
    const list = cardsBySetAndNumber.get(key)
    if (list) list.push(c)
    else cardsBySetAndNumber.set(key, [c])
  }

  // Which card_ids are already claimed by another pops_psa row — so we
  // don't suggest them as candidates for unmapped specs.
  // For each pops_psa row, derive candidate cards: every card in the
  // matching set whose bandai number suffix equals PSA's CardNumber.
  // Combo sets (op14-eb04 / op15-eb04 also check eb-04) widen the pool.
  // Includes cards already claimed by another spec — admin needs to see
  // them to manually pick (e.g. Errata variety probably shares the same
  // card as its non-Errata counterpart).
  interface Candidate extends CardLite {
    /** Spec ID that's already linked to this card_id (if any). */
    claimedBy: number | null
    /** Subject + variety of the claiming spec, for inline triage. */
    claimedLabel: string | null
  }
  // card_id → claiming-spec metadata (subject + variety) so the admin can
  // compare specs at a glance without opening another tab.
  const cardClaimedBy = new Map<string, { specId: number; label: string }>()
  for (const r of rows) {
    if (!r.card_id) continue
    const label = r.variety ? `${subjectName(r)} (${r.variety})` : subjectName(r)
    cardClaimedBy.set(r.card_id, { specId: r.spec_id, label })
  }
  function candidatesFor(row: PopsRow): Candidate[] {
    if (!row.set_code || !row.psa_card_number) return []
    const paddedNum = row.psa_card_number.padStart(3, '0')
    const setCodes = [row.set_code, ...(ALSO_CHECK[row.set_code] ?? [])]
    const subj = normalizeName(subjectName(row))
    const out: Candidate[] = []
    const seen = new Set<string>()
    for (const setCode of setCodes) {
      const cands = cardsBySetAndNumber.get(`${setCode}::${paddedNum}`) ?? []
      for (const c of cands) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        // Hide cards the marketplace rule excludes. Same source of truth
        // as the rest of the site — src/lib/cards.ts isHiddenByFields.
        if (isHiddenByFields(c.set_id, c.type, c.rarity, c.art_style)) continue
        // Subject-name filter: only suggest cards whose name matches the
        // PSA spec subject. Prevents e.g. a Portgas D. Ace card at #013
        // showing up as a candidate for a Boa Hancock spec at the same #.
        if (subj && !normalizeName(c.name).includes(subj)) continue
        const claim = cardClaimedBy.get(c.id) ?? null
        // Skip if claimed by THIS row (already mapped — showing it as a
        // candidate for itself is noise).
        if (claim && claim.specId === row.spec_id) continue
        out.push({
          ...c,
          claimedBy: claim?.specId ?? null,
          claimedLabel: claim?.label ?? null,
        })
      }
    }
    return out
  }

  const stale = rows.filter(r => staleReason(r) !== null).map(r => ({ ...r, reason: staleReason(r)! }))
  const mapped = rows.filter(r => r.card_id !== null)
  const unmappedAll = rows.filter(r => r.card_id === null)
  // Split unmapped into priority buckets:
  //   - "variants": specs with a meaningful variety marker (Alt Art, SP,
  //     TR, Manga, Wanted, etc). These are the higher-value cards worth
  //     manually mapping — usually SR/SEC alt arts and chase rarities.
  //   - "ignored": specs we're not actively pursuing. Includes:
  //       * empty variety (C/UC base cards graded in volume)
  //       * Anniversary/Tournament/Release Event promo specs
  //       * Errata / Demo Deck / Box Topper / Pre-Release
  //       * Sparkle Foil / Jolly Roger Foil (PRB foil-only)
  //       * Don!! card golds (no card_number to anchor on)
  //     None of these typically map to a sellable card in our DB.
  // Exact variety values to treat as ignored. Anniversary/Tournament are
  // matched by substring since PSA uses compound names like
  // "1st Anniversary Tournament" and "Tournament Vol. 2".
  const IGNORED_EXACT = new Set([
    'Pre-Release', 'Pre-Release ', // PSA has trailing-space variants
    'Errata',
    'Demo Deck', 'Demo Deck-Errata',
    'Box Topper', 'Box Topper-Errata',
    'Sparkle Foil',
    'Jolly Roger Foil',
    'Release Event',
    // NOTE: "Holofoil" is intentionally NOT ignored. PSA uses it as a
    // generic alt-art tag and many specs map to legitimate (Alternate Art)
    // cards in our DB.
  ])
  function isIgnored(r: PopsRow): boolean {
    const v = (r.variety ?? '').trim()
    // Empty variety on non-PRB sets is typically a C/UC base print —
    // noisy in the spec-centric unmapped list, so hide there. On PRB
    // sets it's the Reprint variant — sellable, keep visible.
    if (v === '') return !(r.set_code ?? '').startsWith('prb-')
    if (IGNORED_EXACT.has(v)) return true
    if (/Tournament/i.test(v)) return true
    return false
  }
  // Card-centric variant of isIgnored: don't filter empty-variety specs,
  // because the card-centric view already filters cards to sellable-only
  // (see cardCentric below). A blank-variety spec on a non-PRB set IS a
  // legitimate candidate for the SEC/L base print at that slot.
  function isIgnoredForCard(r: PopsRow): boolean {
    const v = (r.variety ?? '').trim()
    if (v === '') return false
    if (IGNORED_EXACT.has(v)) return true
    if (/Tournament/i.test(v)) return true
    return false
  }
  const unmapped = unmappedAll.filter(r => !isIgnored(r))
  const unmappedBases = unmappedAll.filter(r => isIgnored(r))

  // Group by set_code (the new column). Fall back to set-${psa_set_id}
  // for any rows where the backfill missed (shouldn't happen post-migration).
  const groupKey = (r: PopsRow) => r.set_code ?? `set-${r.psa_set_id}`

  const unmappedBySet = new Map<string, PopsRow[]>()
  for (const r of unmapped) {
    const key = groupKey(r)
    const list = unmappedBySet.get(key)
    if (list) list.push(r)
    else unmappedBySet.set(key, [r])
  }
  const unmappedSections = Array.from(unmappedBySet.entries()).sort((a, b) => b[1].length - a[1].length)

  const unmappedBasesBySet = new Map<string, PopsRow[]>()
  for (const r of unmappedBases) {
    const key = groupKey(r)
    const list = unmappedBasesBySet.get(key)
    if (list) list.push(r)
    else unmappedBasesBySet.set(key, [r])
  }
  const unmappedBasesSections = Array.from(unmappedBasesBySet.entries()).sort((a, b) => b[1].length - a[1].length)

  const mappedBySet = new Map<string, PopsRow[]>()
  for (const r of mapped) {
    const key = groupKey(r)
    const list = mappedBySet.get(key)
    if (list) list.push(r)
    else mappedBySet.set(key, [r])
  }
  const mappedSections = Array.from(mappedBySet.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  // --- Card-centric view -------------------------------------------------
  // Inverse of the PSA-centric grouping above. For each sellable card in
  // a PSA-tracked set, surface its PSA spec(s) — linked if mapped, or
  // candidates to pick from if not. Treats `cards` as the source of truth
  // (Bandai data) and PSA as supplementary data we attach.

  const PSA_TRACKED_SETS = new Set<string>()
  for (const r of rows) if (r.set_code) PSA_TRACKED_SETS.add(r.set_code)

  // Index PSA specs by (set_code, padded_number) so the per-card lookup
  // is O(1). The bare 3-digit number is what PSA uses regardless of
  // which set's prefix the card carries in our DB.
  const specsBySetAndNumber = new Map<string, PopsRow[]>()
  for (const r of rows) {
    if (!r.set_code || !r.psa_card_number) continue
    const key = `${r.set_code}::${r.psa_card_number.padStart(3, '0')}`
    const list = specsBySetAndNumber.get(key)
    if (list) list.push(r)
    else specsBySetAndNumber.set(key, [r])
  }

  // spec_id → linked card_id (for "currently linked to other card" badge
  // on candidate buttons).
  const specLinkedTo = new Map<number, string>()
  for (const r of rows) if (r.card_id) specLinkedTo.set(r.spec_id, r.card_id)

  // Which cards count for the card-centric view: sellable + in a PSA-tracked set.
  const cardCentric = cards.filter(c => {
    if (isHiddenByFields(c.set_id, c.type, c.rarity, c.art_style)) return false
    return PSA_TRACKED_SETS.has(c.set_id)
  })

  function specCandidatesForCard(c: CardLite): { linked: PopsRow[]; suggestions: PopsRow[]; fuzzy: PopsRow[] } {
    const bandai = c.id.split('_')[0]
    const numMatch = bandai.match(/-(\d+)$/)
    if (!numMatch) return { linked: [], suggestions: [], fuzzy: [] }
    const key = `${c.set_id}::${numMatch[1]}`
    const pool = specsBySetAndNumber.get(key) ?? []
    const cardNorm = normalizeName(c.name)
    const linked: PopsRow[] = []
    const suggestions: PopsRow[] = []
    const fuzzy: PopsRow[] = []
    for (const r of pool) {
      // Skip PSA specs we don't pursue (JRF, Sparkle Foil, Pre-Release,
      // Tournament, etc.) UNLESS this card is already linked to that
      // exact spec — in that case it's the current mapping and the
      // admin should see it so they can unlink/swap if needed.
      if (isIgnoredForCard(r) && r.card_id !== c.id) continue
      // A spec already attached to this card is "linked" regardless of
      // name strictness — this covers fuzzy-name links the admin made
      // manually (e.g. "Kozuki Hiyori" PSA spec on our "Kouzuki Hiyori"
      // card). Without this, fuzzy-linked specs fall into `fuzzy` and the
      // page counts them as unlinked.
      if (r.card_id === c.id) {
        linked.push(r)
        continue
      }
      const subj = normalizeName(subjectName(r))
      const strictMatch = cardNorm.includes(subj) || subj.includes(cardNorm)
      if (strictMatch) {
        suggestions.push(r)
      } else if (nameTokenOverlap(cardNorm, subj)) {
        // PSA had a typo / partial name — at least one significant word
        // matches. Surface as a fuzzy candidate so admin can verify.
        fuzzy.push(r)
      }
    }
    return { linked, suggestions, fuzzy }
  }

  // Group card-centric cards by set, sort sets alphabetically. Within
  // each set, sort cards by name then card_id so the admin can scan
  // alphabetically (Ace before Buggy before Cracker, etc.).
  const cardsBySet = new Map<string, CardLite[]>()
  for (const c of cardCentric) {
    const list = cardsBySet.get(c.set_id)
    if (list) list.push(c)
    else cardsBySet.set(c.set_id, [c])
  }
  for (const list of cardsBySet.values()) {
    list.sort((a, b) => {
      const byName = a.name.localeCompare(b.name)
      if (byName !== 0) return byName
      return a.id.localeCompare(b.id)
    })
  }
  const cardCentricSections = Array.from(cardsBySet.entries()).sort((a, b) => a[0].localeCompare(b[0]))

  // Stats for the card-centric view.
  let cardCentricLinked = 0
  let cardCentricUnlinked = 0
  for (const c of cardCentric) {
    const { linked } = specCandidatesForCard(c)
    if (linked.length > 0) cardCentricLinked++
    else cardCentricUnlinked++
  }

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">PSA Pop Mappings</h1>
      <p className="text-zinc-600 mb-6">
        Each row in <code className="bg-zinc-100 px-1 rounded">pops_psa</code> is one card PSA has graded.
        Stale rows flag when PSA&apos;s variety (Alt Art, SP, etc.) doesn&apos;t match the linked TCGplayer name —
        usually because someone fixed a wrong mapping after the PSA match was made.
        See <code className="bg-zinc-100 px-1 rounded">docs/PSA-POP-MATCHING.md</code>.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Sellable cards in PSA sets</p>
          <p className="text-2xl font-semibold">{cardCentric.length}</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Cards with PSA pop</p>
          <p className="text-2xl font-semibold text-emerald-600">{cardCentricLinked}</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Cards without PSA pop</p>
          <p className="text-2xl font-semibold text-amber-600">{cardCentricUnlinked}</p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Cards by PSA pop status ({cardCentric.length})</h2>
        <div className="flex items-center gap-2 text-xs">
          <Link
            href="/admin/psa-pops"
            className={`px-2 py-1 rounded ${showOnlyUnlinked ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-zinc-600 hover:bg-zinc-100'}`}
          >
            Unlinked only ({cardCentricUnlinked})
          </Link>
          <Link
            href="/admin/psa-pops?all=1"
            className={`px-2 py-1 rounded ${!showOnlyUnlinked ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-zinc-600 hover:bg-zinc-100'}`}
          >
            All ({cardCentric.length})
          </Link>
        </div>
      </div>
      <p className="text-sm text-zinc-600 mb-3">
        Sellable cards we have for sets PSA tracks. Each card shows its linked PSA spec (if any) plus other
        candidate specs at the same set+number with matching subject names. <strong>Link</strong> attaches a spec;
        <strong> Steal</strong> moves a spec away from a different card; <strong>✓ Linked</strong> means it&apos;s
        already attached to this card. The <span className="bg-blue-100 text-blue-700 px-1 rounded text-[10px]">manual</span> chip
        flags links set by an admin (preserved across auto-rematches).
      </p>

      <div className="space-y-2 mb-10">
        {cardCentricSections.map(([setId, setCards]) => {
          const setLinked = setCards.filter(c => specCandidatesForCard(c).linked.length > 0).length
          const pct = setCards.length === 0 ? 0 : Math.round((100 * setLinked) / setCards.length)
          const isComplete = pct === 100 && setCards.length > 0
          // In unlinked-only mode, hide sets that are already 100% mapped —
          // showing an empty expandable would be noise.
          if (showOnlyUnlinked && isComplete) return null
          const barColor = isComplete
            ? 'bg-emerald-500'
            : pct >= 90 ? 'bg-emerald-400'
            : pct >= 70 ? 'bg-blue-500'
            : pct >= 40 ? 'bg-amber-500'
            : 'bg-zinc-400'
          const pctColor = isComplete
            ? 'text-emerald-700'
            : pct >= 90 ? 'text-emerald-600'
            : pct >= 70 ? 'text-blue-600'
            : pct >= 40 ? 'text-amber-700'
            : 'text-zinc-500'
          return (
            <details key={setId} className={`border rounded-lg ${isComplete ? 'border-emerald-300 bg-emerald-50/30' : 'border-zinc-200'}`} open={setCards.length <= 30}>
              <summary className={`cursor-pointer px-4 py-3 font-medium flex items-center gap-3 ${isComplete ? 'bg-emerald-50 hover:bg-emerald-100' : 'bg-zinc-50 hover:bg-zinc-100'}`}>
                <span className="font-mono text-sm">{setId}</span>
                <div className="flex-1 max-w-xs flex items-center gap-2">
                  <div className="flex-1 h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-xs font-semibold tabular-nums ${pctColor}`}>
                    {isComplete ? '✓ 100%' : `${pct}%`}
                  </span>
                </div>
                <span className="text-zinc-500 text-sm tabular-nums">
                  {setLinked} / {setCards.length}
                </span>
              </summary>
              <div className="p-4 space-y-3">
                {setCards
                  .filter(c => !showOnlyUnlinked || specCandidatesForCard(c).linked.length === 0)
                  .map(c => {
                  const { linked, suggestions, fuzzy } = specCandidatesForCard(c)
                  const hasAny = linked.length + suggestions.length + fuzzy.length > 0
                  const hasManual = linked.some(r => r.source === 'manual')
                  return (
                    <div key={c.id} className="text-xs border border-zinc-100 rounded p-2 space-y-2">
                      {/* Header: card identification across the full row so the
                          name + chips are never cropped by the 80px thumbnail
                          column. Rarity and art_style are editable inline —
                          changes hit /api/admin/cards/[cardId] immediately. */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link className="font-mono text-blue-600 hover:underline" href={`/card/${c.id}`}>{c.id}</Link>
                        <span className="font-semibold text-zinc-900">{c.name}</span>
                        <InlineCardFieldEdit cardId={c.id} field="rarity" current={c.rarity} options={RARITY_OPTIONS} fallback="C" theme="light" />
                        <InlineCardFieldEdit cardId={c.id} field="art_style" current={c.art_style} options={ART_STYLE_OPTIONS} fallback="standard" theme="light" />
                        {hasManual && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">manual</span>
                        )}
                      </div>
                      <div className="flex gap-3">
                        <div className="w-20 flex-shrink-0">
                          {c.image_url ? (
                            <HoverThumb src={c.image_url} alt={c.name} />
                          ) : (
                            <div className="w-full aspect-[5/7] bg-zinc-100 rounded border border-zinc-200 flex items-center justify-center text-zinc-400 text-[10px]">no img</div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-1">
                          {!hasAny ? (
                            <div className="text-zinc-400 italic text-xs">No PSA specs at this set + number with a matching name.</div>
                          ) : (
                            <>
                              {linked.map(r => (
                                <PsaSpecLinkButton
                                  key={r.spec_id}
                                  cardId={c.id}
                                  specId={r.spec_id}
                                  description={subjectName(r)}
                                  variety={r.variety}
                                  totalPop={r.total_pop}
                                  linkedToCardId={r.card_id}
                                />
                              ))}
                              {suggestions.map(r => (
                                <PsaSpecLinkButton
                                  key={r.spec_id}
                                  cardId={c.id}
                                  specId={r.spec_id}
                                  description={subjectName(r)}
                                  variety={r.variety}
                                  totalPop={r.total_pop}
                                  linkedToCardId={r.card_id}
                                />
                              ))}
                              {fuzzy.length > 0 && (
                                <div className="mt-1 pt-1 border-t border-dashed border-zinc-200">
                                  <div className="text-[10px] text-zinc-500 mb-0.5">
                                    Fuzzy matches — PSA name differs from card name (likely PSA typo). Verify before linking:
                                  </div>
                                  {fuzzy.map(r => (
                                    <PsaSpecLinkButton
                                      key={r.spec_id}
                                      cardId={c.id}
                                      specId={r.spec_id}
                                      description={`~ ${subjectName(r)}`}
                                      variety={r.variety}
                                      totalPop={r.total_pop}
                                      linkedToCardId={r.card_id}
                                    />
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          <PsaSpecManualLink cardId={c.id} />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>

      <details className="mb-4">
        <summary className="cursor-pointer text-lg font-semibold mb-2 list-none flex items-center gap-2 text-zinc-700">
          <span className="text-xs">▶</span>
          <span>PSA-spec diagnostics</span>
          <span className="text-xs text-zinc-500 font-normal">click to expand · stale ({stale.length}), unmapped variants ({unmapped.length}), ignored ({unmappedBases.length}), mapped ({mapped.length})</span>
        </summary>
        <p className="text-sm text-zinc-600 mt-2 mb-4">
          The PSA-side view: lists every PSA spec we have and groups them by mapping status. Useful when you
          need to chase a specific spec or audit the matcher output. The card-centric view above is usually
          the better workflow for filling gaps.
        </p>

      {stale.length > 0 && (
        <details className="mb-10">
          <summary className="cursor-pointer text-lg font-semibold mb-2 text-red-700 list-none flex items-center gap-2">
            <span className="text-xs">▶</span>
            <span>⚠ Stale mappings ({stale.length})</span>
            <span className="text-xs text-zinc-500 font-normal">click to expand</span>
          </summary>
          <p className="text-sm text-zinc-600 mb-3 mt-2">
            Run <code className="bg-zinc-100 px-1 rounded">npx tsx scripts/psa-pop-fetch.ts --rematch</code> to
            re-derive every mapping. Or fix individual rows in Supabase Studio.
          </p>
          <div className="overflow-x-auto border border-zinc-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">PSA spec</th>
                  <th className="px-3 py-2">Linked card</th>
                  <th className="px-3 py-2">Why flagged</th>
                  <th className="px-3 py-2 text-right">Pop</th>
                </tr>
              </thead>
              <tbody>
                {stale.map(r => {
                  const card = r.card_id ? cardById.get(r.card_id) : null
                  return (
                    <tr key={r.spec_id} className="border-t border-zinc-100">
                      <td className="px-3 py-2 w-20">
                        {card?.image_url ? (
                          <HoverThumb src={card.image_url} alt={r.card_id ?? ''} className="w-16 rounded border border-zinc-200" />
                        ) : <span className="text-zinc-300 text-xs">no img</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          <span>{subjectName(r)}</span>
                          {r.variety && (
                            <span className="text-[10px] bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded">{r.variety}</span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1 flex-wrap">
                          <span className="font-mono bg-zinc-100 px-1 rounded">{r.set_code ?? `psa-${r.psa_set_id}`}</span>
                          <a className="hover:underline" href={`https://www.psacard.com/spec/psa/${r.spec_id}`} target="_blank" rel="noreferrer">
                            spec {r.spec_id} ↗
                          </a>
                          {r.psa_card_number ? <span>· PSA #{r.psa_card_number}</span> : null}
                          <span>·</span>
                          <a className="text-blue-600 hover:underline" href={tcgSearchUrl(r)} target="_blank" rel="noreferrer">
                            search TCG
                          </a>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link className="text-blue-600 hover:underline" href={`/card/${r.card_id}`}>{r.card_id}</Link>
                        <div className="text-zinc-500">{r.tcg_name ?? '—'}</div>
                      </td>
                      <td className="px-3 py-2 text-red-700">{r.reason}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.total_pop?.toLocaleString() ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <h2 className="text-lg font-semibold mb-2">Unmapped variant specs by set ({unmapped.length})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        High-priority unmapped — specs PSA tagged with a variety (Alt Art, SP, TR, Manga, Wanted, etc).
        Candidate cards in the same set at the same number appear on the right; click a thumbnail to assign.
        Greyed candidates labeled <em>used by spec X</em> are already linked to a different PSA spec — clicking
        one creates a duplicate mapping (sometimes correct, e.g. an Errata variant of the same physical card).
      </p>

      <div className="space-y-2 mb-10">
        {unmappedSections.map(([setCode, specs]) => (
          <details key={setCode} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setCode}</span>
              <span className="text-zinc-500 text-sm">— {specs.length} unmapped</span>
            </summary>
            <div className="p-4 space-y-2">
              {specs.map(r => {
                const candidates = candidatesFor(r)
                return (
                  <div key={r.spec_id} className="flex gap-3 text-xs border border-zinc-100 rounded p-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                        <span>{subjectName(r)}</span>
                        {r.variety && (
                          <span className="text-[10px] bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded">{r.variety}</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1 flex-wrap">
                        <span className="font-mono bg-zinc-100 px-1 rounded">{r.set_code ?? `psa-${r.psa_set_id}`}</span>
                        <a className="hover:underline" href={`https://www.psacard.com/spec/psa/${r.spec_id}`} target="_blank" rel="noreferrer">
                          spec {r.spec_id} ↗
                        </a>
                        {r.psa_card_number ? <span>· PSA #{r.psa_card_number}</span> : null}
                        <span>·</span>
                        <a className="text-blue-600 hover:underline" href={tcgSearchUrl(r)} target="_blank" rel="noreferrer">
                          search TCG
                        </a>
                        {r.total_pop != null ? <span>· pop {r.total_pop.toLocaleString()}</span> : null}
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex gap-1">
                      {candidates.length === 0 ? (
                        <span className="text-zinc-400 text-[10px] self-center italic">no candidates</span>
                      ) : (
                        <PsaCandidateGroup specId={r.spec_id} candidates={candidates} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-2 mt-10">Ignored specs by set ({unmappedBases.length})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Low-priority specs not worth pursuing — C/UC base prints, Anniversary/Tournament promos, Pre-Release,
        Errata, Demo Deck, Box Topper, foil-only variants (Holofoil/JRF/Sparkle), and Release Events. Most
        won&apos;t have a sellable match because we hide low-rarity standard prints. Same click-to-assign workflow
        if you do want to map any individually; collapsed by default.
      </p>

      <div className="space-y-2 mb-10">
        {unmappedBasesSections.map(([setCode, specs]) => (
          <details key={setCode} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setCode}</span>
              <span className="text-zinc-500 text-sm">— {specs.length} base specs</span>
            </summary>
            <div className="p-4 space-y-2">
              {specs.map(r => {
                const candidates = candidatesFor(r)
                return (
                  <div key={r.spec_id} className="flex gap-3 text-xs border border-zinc-100 rounded p-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                        <span>{subjectName(r)}</span>
                        {r.variety && (
                          <span className="text-[10px] bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded">{r.variety}</span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1 flex-wrap">
                        <span className="font-mono bg-zinc-100 px-1 rounded">{r.set_code ?? `psa-${r.psa_set_id}`}</span>
                        <a className="hover:underline" href={`https://www.psacard.com/spec/psa/${r.spec_id}`} target="_blank" rel="noreferrer">
                          spec {r.spec_id} ↗
                        </a>
                        {r.psa_card_number ? <span>· PSA #{r.psa_card_number}</span> : null}
                        <span>·</span>
                        <a className="text-blue-600 hover:underline" href={tcgSearchUrl(r)} target="_blank" rel="noreferrer">
                          search TCG
                        </a>
                        {r.total_pop != null ? <span>· pop {r.total_pop.toLocaleString()}</span> : null}
                      </div>
                    </div>
                    <div className="flex-shrink-0 flex gap-1">
                      {candidates.length === 0 ? (
                        <span className="text-zinc-400 text-[10px] self-center italic">no candidates</span>
                      ) : (
                        <PsaCandidateGroup specId={r.spec_id} candidates={candidates} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </div>

      <h2 className="text-lg font-semibold mb-2">Mapped specs by set ({mapped.length})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Each PSA spec with its linked card. Scan for mis-matches — a wrong link (e.g. PSA spec for &quot;Manga&quot;
        but linked card image is plain art) usually jumps out visually.
      </p>

      <div className="space-y-2">
        {mappedSections.map(([setCode, specs]) => (
          <details key={setCode} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setCode}</span>
              <span className="text-zinc-500 text-sm">— {specs.length} mapped</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2"></th>
                    <th className="px-3 py-2">PSA spec</th>
                    <th className="px-3 py-2">Linked card</th>
                    <th className="px-3 py-2 text-right">Pop</th>
                  </tr>
                </thead>
                <tbody>
                  {specs.map(r => {
                    const card = r.card_id ? cardById.get(r.card_id) : null
                    return (
                      <tr key={r.spec_id} className="border-t border-zinc-100">
                        <td className="px-3 py-2 w-20">
                          {card?.image_url ? (
                            <HoverThumb src={card.image_url} alt={r.card_id ?? ''} className="w-16 rounded border border-zinc-200" />
                          ) : <span className="text-zinc-300 text-xs">no img</span>}
                        </td>
                        <td className="px-3 py-2">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            <span>{subjectName(r)}</span>
                            {r.variety && (
                              <span className="text-[10px] bg-zinc-200 text-zinc-700 px-1.5 py-0.5 rounded">{r.variety}</span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-1 flex-wrap">
                            <span className="font-mono bg-zinc-100 px-1 rounded">{r.set_code ?? `psa-${r.psa_set_id}`}</span>
                            <a className="hover:underline" href={`https://www.psacard.com/spec/psa/${r.spec_id}`} target="_blank" rel="noreferrer">
                              spec {r.spec_id} ↗
                            </a>
                            {r.psa_card_number ? <span>· PSA #{r.psa_card_number}</span> : null}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link className="text-blue-600 hover:underline" href={`/card/${r.card_id}`}>{r.card_id}</Link>
                          <div className="text-zinc-500 font-sans">{card?.name}</div>
                          <div className="text-zinc-400">{r.tcg_name ?? '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.total_pop?.toLocaleString() ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
      </details>
    </div>
  )
}
