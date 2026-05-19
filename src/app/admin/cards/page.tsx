import { createClient } from '@/lib/supabase/server'
import { CardEditor, type EditableCard } from '@/components/admin/CardEditor'

export const dynamic = 'force-dynamic'

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

export default async function CardEditorPage() {
  const supabase = await createClient()
  const cards = await paginate<EditableCard>((from, to) =>
    supabase
      .from('cards')
      .select('id, name, set_id, type, rarity, art_style, variant, is_parallel, image_url')
      .order('id')
      .range(from, to),
  )

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Edit Cards</h1>
      <p className="text-zinc-600 mb-5 text-sm">
        Search or filter to find a card, then click it to edit. Currently editable:
        {' '}<code className="bg-zinc-100 px-1 rounded">art_style</code> and
        {' '}<code className="bg-zinc-100 px-1 rounded">variant</code>.
        Changes save to the <code className="bg-zinc-100 px-1 rounded">cards</code> table and propagate to the
        public site on next render.
      </p>
      <CardEditor cards={cards} />
    </div>
  )
}
