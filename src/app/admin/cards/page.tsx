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
  is_parallel: boolean
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

export default async function CardEditorPage() {
  const supabase = await createClient()
  const rows = await paginate<CardRow>((from, to) =>
    supabase
      .from('cards')
      .select('id, name, set_id, type, rarity, art_style, variant, is_parallel, image_url')
      .order('id')
      .range(from, to),
  )
  const cards: EditableCard[] = rows.map(r => ({ ...r, ...deriveHideInfo(r) }))

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
