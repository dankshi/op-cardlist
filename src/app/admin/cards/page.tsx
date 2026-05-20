import { createClient } from '@/lib/supabase/server'
import { CardEditor, type EditableCard } from '@/components/admin/CardEditor'
import { HIDDEN_RARITIES, isHiddenByFields } from '@/lib/cards'

export const dynamic = 'force-dynamic'

interface CardRow {
  id: string
  name: string
  set_id: string
  type: string | null
  rarity: string | null
  art_style: string | null
  variant: string | null
  image_url: string | null
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

/** Same rules as isHiddenByFields, but returned as a structured object the
 *  modal can use to explain how to unhide. Keeping the logic next to the
 *  rule source so they stay in sync. */
function deriveHideInfo(row: CardRow): { isHidden: boolean; hideReason: string | null; hideFix: string | null } {
  if (!isHiddenByFields(row.set_id, row.type, row.rarity, row.art_style)) {
    return { isHidden: false, hideReason: null, hideFix: null }
  }
  const rarity = row.rarity ?? '(unset)'
  const artStyle = row.art_style ?? 'standard'
  if (row.set_id === 'prb-01' && (row.type === 'EVENT' || row.type === 'STAGE')) {
    return {
      isHidden: true,
      hideReason: `This is a PRB-01 ${row.type} card. We treat the prb-01 Event/Stage reprints as noise and don't list them.`,
      hideFix: 'No quick fix — only Character/Leader cards from prb-01 are listed. If this is actually a character we missed, change "type" in Supabase.',
    }
  }
  return {
    isHidden: true,
    hideReason: `Low-rarity standard print: rarity "${rarity}" with art_style "${artStyle}". Hidden because rarity ∈ {${[...HIDDEN_RARITIES].join(', ')}} and art_style = "standard".`,
    hideFix: 'To unhide: bump art_style to alternate / manga / wanted / textured (if this card is actually a variant), or change the rarity to SP / TR / SEC (if it was mis-graded).',
  }
}

/** Issues to flag with a warning icon on the tile. Only computed for
 *  cards we actually expect to be in good shape — sellable cards in a
 *  PSA-tracked set. Hidden cards and cards in untracked sets (e.g. promo)
 *  are skipped so the warning doesn't false-positive on the long tail. */
function deriveIssues(
  row: CardRow,
  isHidden: boolean,
  psaTrackedSets: Set<string>,
  mappedCardIds: Set<string>,
): string[] {
  const issues: string[] = []
  // Only check cards we'd actually expect to have a PSA mapping.
  if (!isHidden && psaTrackedSets.has(row.set_id) && !mappedCardIds.has(row.id)) {
    issues.push('No PSA pop linked')
  }
  return issues
}

export default async function CardEditorPage() {
  const supabase = await createClient()
  const [rows, pops] = await Promise.all([
    paginate<CardRow>((from, to) =>
      supabase
        .from('cards')
        .select('id, name, set_id, type, rarity, art_style, variant, image_url')
        .order('id')
        .range(from, to),
    ),
    // Just the two fields we need — set_code (for tracked-set lookup) and
    // card_id (for linked-status lookup). Cuts payload vs select('*').
    paginate<{ set_code: string | null; card_id: string | null }>((from, to) =>
      supabase
        .from('pops_psa')
        .select('set_code, card_id')
        .order('spec_id')
        .range(from, to),
    ),
  ])

  // Sets PSA tracks (presence of any spec implies tracking) + card_ids
  // currently linked to a PSA spec. Both are sets for O(1) lookup.
  const psaTrackedSets = new Set<string>()
  const mappedCardIds = new Set<string>()
  for (const r of pops) {
    if (r.set_code) psaTrackedSets.add(r.set_code)
    if (r.card_id) mappedCardIds.add(r.card_id)
  }

  const cards: EditableCard[] = rows.map(r => {
    const hideInfo = deriveHideInfo(r)
    const issues = deriveIssues(r, hideInfo.isHidden, psaTrackedSets, mappedCardIds)
    return { ...r, ...hideInfo, issues }
  })

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Edit Cards</h1>
      <p className="text-zinc-600 mb-5 text-sm">
        Search or filter to find a card, then click any tile to edit. Currently editable:
        {' '}<code className="bg-zinc-100 px-1 rounded">art_style</code> and
        {' '}<code className="bg-zinc-100 px-1 rounded">rarity</code>.
        Hidden cards are dimmed and grouped at the bottom of each set — click one to see why.
      </p>
      <CardEditor cards={cards} />
    </div>
  )
}
