import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HoverThumb } from '@/components/admin/HoverThumb'

export const dynamic = 'force-dynamic'

interface PopsRow {
  spec_id: number
  psa_set_id: number | null
  psa_card_number: string | null
  description: string
  card_id: string | null
  total_pop: number | null
  tcg_name: string | null
  tcg_url: string | null
}

interface CardLite { id: string; name: string; image_url: string | null }

// PSA set ID → our set code, mirroring scripts/psa-pop-fetch.ts PSA_SETS.
// Used to group unmapped specs under readable set names.
const PSA_SET_CODE: Record<number, string> = {
  224322: 'OP01', 233905: 'OP02', 242625: 'OP03', 249021: 'OP04', 256095: 'OP05',
  263953: 'OP06', 274048: 'OP07', 280554: 'OP08', 288478: 'OP09', 298200: 'OP10',
  304942: 'OP11', 314057: 'OP12', 321523: 'OP13', 327430: 'OP14+EB04', 335640: 'OP15+EB04',
  269483: 'EB01', 302771: 'EB02', 331864: 'EB03', 284770: 'PRB01', 318867: 'PRB02',
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

export default async function PSAPopsAdminPage() {
  const supabase = await createClient()

  const rowsRaw = await paginate<PopsRow>((from, to) =>
    supabase.from('pops_psa_with_tcg').select('*').order('total_pop', { ascending: false }).range(from, to),
  )
  const rows = rowsRaw as PopsRow[]

  // Pull all cards (id + image_url + name) so we can show thumbnails for
  // mapped stale rows. Cards index is small enough to load fully.
  const cards = await paginate<CardLite>((from, to) =>
    supabase.from('cards').select('id, name, image_url').order('id').range(from, to),
  )
  const cardById = new Map<string, CardLite>()
  for (const c of cards) cardById.set(c.id, c)

  const stale = rows.filter(r => staleReason(r) !== null).map(r => ({ ...r, reason: staleReason(r)! }))
  const mapped = rows.filter(r => r.card_id !== null)
  const unmapped = rows.filter(r => r.card_id === null)

  // Group unmapped by PSA set for the per-set browse view.
  const unmappedBySet = new Map<string, PopsRow[]>()
  for (const r of unmapped) {
    const key = (r.psa_set_id != null && PSA_SET_CODE[r.psa_set_id]) || `set-${r.psa_set_id}`
    const list = unmappedBySet.get(key)
    if (list) list.push(r)
    else unmappedBySet.set(key, [r])
  }
  // Sort sections by count desc.
  const unmappedSections = Array.from(unmappedBySet.entries()).sort((a, b) => b[1].length - a[1].length)

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
          <p className="text-xs uppercase tracking-wide text-zinc-500">Total specs</p>
          <p className="text-2xl font-semibold">{rows.length}</p>
        </div>
        <div className="border border-zinc-200 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-zinc-500">Mapped</p>
          <p className="text-2xl font-semibold text-emerald-600">{mapped.length}</p>
        </div>
        <div className={`border rounded-lg p-4 ${stale.length > 0 ? 'border-red-300 bg-red-50' : 'border-zinc-200'}`}>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Stale</p>
          <p className={`text-2xl font-semibold ${stale.length > 0 ? 'text-red-600' : 'text-zinc-500'}`}>{stale.length}</p>
        </div>
      </div>

      {stale.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-2 text-red-700">⚠ Stale mappings ({stale.length})</h2>
          <p className="text-sm text-zinc-600 mb-3">
            Run <code className="bg-zinc-100 px-1 rounded">npx tsx scripts/psa-pop-fetch.ts --rematch</code> to
            re-derive every mapping. Or fix individual rows in Supabase Studio.
          </p>
          <div className="overflow-x-auto border border-zinc-200 rounded-lg mb-10">
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
                        <div className="font-medium">{r.description}</div>
                        <div className="text-xs text-zinc-500">
                          <a className="hover:underline" href={`https://www.psacard.com/spec/psa/${r.spec_id}`} target="_blank" rel="noreferrer">
                            spec {r.spec_id} ↗
                          </a>
                          {r.psa_card_number ? ` · PSA #${r.psa_card_number}` : ''}
                          {' · '}
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
        </>
      )}

      <h2 className="text-lg font-semibold mb-2">Unmapped PSA specs by set ({unmapped.length})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Specs PSA returned that haven&apos;t been linked to one of our cards yet. Click a set to expand.
        &quot;Search TCG&quot; opens TCGplayer pre-filled with the description; &quot;PSA spec&quot; opens the spec page.
      </p>

      <div className="space-y-2">
        {unmappedSections.map(([setCode, specs]) => (
          <details key={setCode} className="border border-zinc-200 rounded-lg">
            <summary className="cursor-pointer px-4 py-3 bg-zinc-50 hover:bg-zinc-100 font-medium flex items-center gap-3">
              <span className="font-mono text-sm">{setCode}</span>
              <span className="text-zinc-500 text-sm">— {specs.length} unmapped</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-3 py-2">PSA spec</th>
                    <th className="px-3 py-2">PSA #</th>
                    <th className="px-3 py-2">Find on TCG</th>
                    <th className="px-3 py-2 text-right">Pop</th>
                  </tr>
                </thead>
                <tbody>
                  {specs.map(r => (
                    <tr key={r.spec_id} className="border-t border-zinc-100">
                      <td className="px-3 py-2">
                        <a className="hover:underline" href={`https://www.psacard.com/spec/psa/${r.spec_id}`} target="_blank" rel="noreferrer">
                          {r.description} ↗
                        </a>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-700">{r.psa_card_number || '—'}</td>
                      <td className="px-3 py-2">
                        <a className="text-blue-600 hover:underline text-xs" href={tcgSearchUrl(r)} target="_blank" rel="noreferrer">
                          search →
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.total_pop?.toLocaleString() ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
