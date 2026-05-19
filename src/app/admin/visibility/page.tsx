import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HIDDEN_RARITIES, isHiddenByFields } from '@/lib/cards'
import { HoverThumb } from '@/components/admin/HoverThumb'

export const dynamic = 'force-dynamic'

interface CardRow {
  id: string
  name: string
  set_id: string
  type: string | null
  rarity: string | null
  art_style: string | null
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

export default async function VisibilityAuditPage() {
  const supabase = await createClient()
  const cards = await paginate<CardRow>((from, to) =>
    supabase.from('cards').select('id, name, set_id, type, rarity, art_style, image_url').order('id').range(from, to),
  )

  // Split per set; within each set, split into hidden vs shown.
  type Bucket = { hidden: CardRow[]; shown: CardRow[] }
  const bySet = new Map<string, Bucket>()
  for (const c of cards) {
    const b = bySet.get(c.set_id) ?? { hidden: [], shown: [] }
    if (isHiddenByFields(c.set_id, c.type, c.rarity, c.art_style)) b.hidden.push(c)
    else b.shown.push(c)
    bySet.set(c.set_id, b)
  }
  // Sort sets by hidden count desc so the largest audit targets surface first.
  const sections = Array.from(bySet.entries()).sort((a, b) => b[1].hidden.length - a[1].hidden.length)

  const totalHidden = cards.filter(c => isHiddenByFields(c.set_id, c.type, c.rarity, c.art_style)).length
  const totalShown = cards.length - totalHidden

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Card Visibility Audit</h1>
      <p className="text-zinc-600 mb-6">
        Cards are hidden from the public site when they&apos;re a low-rarity standard print:{' '}
        <code className="bg-zinc-100 px-1 rounded">rarity ∈ {`{${[...HIDDEN_RARITIES].join(', ')}}`}</code> AND{' '}
        <code className="bg-zinc-100 px-1 rounded">art_style = &apos;standard&apos;</code>. Alt arts, manga, and
        wanted-poster variants of the same base card stay visible. Use this page to spot mis-classifications —
        e.g. an alt art accidentally tagged <code className="bg-zinc-100 px-1 rounded">standard</code> would hide it.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Shown (sellable)</p>
          <p className="text-2xl font-semibold text-emerald-600">{totalShown}</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Hidden (low-rarity standard)</p>
          <p className="text-2xl font-semibold text-zinc-700">{totalHidden}</p>
        </div>
      </div>

      <div className="space-y-2">
        {sections.map(([setId, { hidden, shown }]) => (
          <details key={setId} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setId}</span>
              <span className="text-zinc-500 text-sm">
                — {hidden.length} hidden · {shown.length} shown
              </span>
            </summary>

            {/* Hidden first — that's the audit target. Scan thumbnails for
                things that LOOK like alt arts or special variants but are
                tagged 'standard'. */}
            <div className="p-4 border-t border-zinc-100">
              <h3 className="text-sm font-semibold text-zinc-700 mb-2">Hidden ({hidden.length})</h3>
              {hidden.length === 0 ? (
                <p className="text-xs text-zinc-400">No hidden cards in this set.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {hidden.map(c => (
                    <CardTile key={c.id} c={c} />
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-zinc-100">
              <h3 className="text-sm font-semibold text-zinc-700 mb-2">Shown ({shown.length})</h3>
              {shown.length === 0 ? (
                <p className="text-xs text-zinc-400">No shown cards in this set.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
                  {shown.map(c => (
                    <CardTile key={c.id} c={c} />
                  ))}
                </div>
              )}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}

function CardTile({ c }: { c: CardRow }) {
  return (
    <div className="text-xs">
      {c.image_url ? (
        <HoverThumb src={c.image_url} alt={c.name} />
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
  )
}
