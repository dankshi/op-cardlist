import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'

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

// Decide if a mapping is stale. PSA tells us the spec's "Variety" via
// the description suffix; the linked card's TCGplayer name should agree.
// If it doesn't, the underlying mapping changed since we last
// auto-matched (or our original match was wrong).
// TCGplayer doesn't expose stable per-product URLs we can construct from
// just a name, but their search works. Pre-fill it with the spec
// description + (when present) the PSA card number, scoped to One Piece.
function tcgSearchUrl(row: PopsRow): string {
  const parts = [row.description];
  if (row.psa_card_number) parts.push(row.psa_card_number);
  const q = encodeURIComponent(parts.join(' '));
  return `https://www.tcgplayer.com/search/one-piece-card-game/product?productLineName=one-piece-card-game&q=${q}&view=grid`;
}

function staleReason(row: PopsRow): string | null {
  if (!row.card_id) return null
  if (!row.tcg_name) return 'Linked card_id no longer exists in card_prices.'

  const name = row.tcg_name.toLowerCase()
  const desc = row.description

  const has = (s: string) => name.includes(s)
  // "(parallel)" and "(alternate art)" are synonymous tags for the same
  // variant — TCGplayer used both over the years. Either is valid for
  // PSA's "Alternate Art" variety.
  const hasAA = has('(parallel)') || has('(alternate art)')
  const hasManga = has('(manga)')
  const hasSP = has('(sp)')
  const hasTR = has('(tr)')

  if (desc.endsWith('(Special Alternate Art)')) {
    return hasSP ? null : 'PSA says SP but linked TCGplayer name has no "(SP)".'
  }
  if (desc.endsWith('(Treasure Rare)')) {
    return hasTR ? null : 'PSA says TR but linked TCGplayer name has no "(TR)".'
  }
  if (desc.endsWith('(Manga Alternate Art)')) {
    return hasManga ? null : 'PSA says Manga but linked TCGplayer name has no "(Manga)".'
  }
  if (desc.endsWith('(Alternate Art)')) {
    if (!hasAA) return 'PSA says Alt Art but linked TCGplayer name has no "(Parallel)" or "(Alternate Art)".'
    if (hasManga || hasSP || hasTR) return 'PSA says plain Alt Art but linked TCGplayer name carries a different variant tag.'
    return null
  }
  if (desc.endsWith('(Pre-Release)')) {
    // We typically don't link pre-releases; if one is linked we don't try
    // to validate it.
    return null
  }
  // No parens at end = base card. Linked card shouldn't carry a variant tag.
  if (hasAA || hasManga || hasSP || hasTR) {
    return 'PSA says base card but linked TCGplayer name has a variant tag.'
  }
  return null
}

export default async function PSAPopsAdminPage() {
  const supabase = await createClient()

  const { data: rowsRaw, error } = await supabase
    .from('pops_psa_with_tcg')
    .select('*')
    .order('total_pop', { ascending: false })

  if (error) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-4">PSA Pop Mappings</h1>
        <p className="text-red-500">Failed to load: {error.message}</p>
      </div>
    )
  }

  const rows = (rowsRaw ?? []) as PopsRow[]
  const stale = rows.filter(r => staleReason(r) !== null).map(r => ({ ...r, reason: staleReason(r)! }))
  const mapped = rows.filter(r => r.card_id !== null)
  const unmapped = rows.filter(r => r.card_id === null)

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">PSA Pop Mappings</h1>
      <p className="text-zinc-600 mb-6">
        Each row in <code className="bg-zinc-100 px-1 rounded">pops_psa</code> is one card PSA has graded.
        Rows here are flagged when PSA&apos;s variety (Alt Art, SP, etc.) no longer matches the
        TCGplayer name of the card_id they&apos;re linked to — usually because someone fixed a wrong
        TCGplayer mapping after the PSA match was made. See{' '}
        <code className="bg-zinc-100 px-1 rounded">docs/PSA-POP-MATCHING.md</code> for the reasoning.
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
            re-derive every mapping from current TCGplayer data. Or fix individual rows in Supabase Studio by
            clearing the <code className="bg-zinc-100 px-1 rounded">card_id</code> and letting the next normal
            fetch re-match (or setting the correct one manually).
          </p>
          <div className="overflow-x-auto border border-zinc-200 rounded-lg mb-10">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-2">PSA spec</th>
                  <th className="px-3 py-2">Linked card</th>
                  <th className="px-3 py-2">TCGplayer name</th>
                  <th className="px-3 py-2">Why flagged</th>
                  <th className="px-3 py-2 text-right">Pop</th>
                </tr>
              </thead>
              <tbody>
                {stale.map(r => (
                  <tr key={r.spec_id} className="border-t border-zinc-100">
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
                      <Link className="text-blue-600 hover:underline" href={`/card/${r.card_id}`}>
                        {r.card_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-zinc-700">
                      {r.tcg_url ? (
                        <a className="text-blue-600 hover:underline" href={r.tcg_url} target="_blank" rel="noreferrer">{r.tcg_name}</a>
                      ) : (
                        <span>{r.tcg_name ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-red-700">{r.reason}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.total_pop?.toLocaleString() ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="text-lg font-semibold mb-2">Unmapped ({unmapped.length})</h2>
      <p className="text-sm text-zinc-600 mb-3">
        Specs PSA returned that haven&apos;t been linked to one of our cards yet. Most are Pre-Release or
        special promos we don&apos;t track separately; the rest are worth eyeballing for manual mapping.
      </p>
      <div className="overflow-x-auto border border-zinc-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">PSA spec</th>
              <th className="px-3 py-2">PSA card #</th>
              <th className="px-3 py-2">Find on TCG</th>
              <th className="px-3 py-2 text-right">Pop</th>
            </tr>
          </thead>
          <tbody>
            {unmapped.slice(0, 50).map(r => (
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
        {unmapped.length > 50 && (
          <div className="px-3 py-2 text-xs text-zinc-500 border-t border-zinc-100">
            Showing 50 of {unmapped.length}. Open <code className="bg-zinc-100 px-1 rounded">pops_psa</code> in
            Supabase Studio for the full list.
          </div>
        )}
      </div>
    </div>
  )
}
