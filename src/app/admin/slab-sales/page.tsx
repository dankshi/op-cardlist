import Link from 'next/link'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { AddSlabSaleForm } from '@/components/admin/AddSlabSaleForm'
import { SlabSalesTable, type SlabSaleRow } from '@/components/admin/SlabSalesTable'

export const dynamic = 'force-dynamic'

const PAGE_LIMIT = 300

interface SearchParams {
  status?: string
  source?: string
  company?: string
  q?: string
}

export default async function SlabSalesAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const status = sp.status ?? ''
  const source = sp.source ?? ''
  const company = sp.company ?? ''
  const q = sp.q?.trim() ?? ''

  // Service-role read: slab_sales RLS hides non-visible rows from the normal
  // session client, but the review queue needs to see excluded/hidden too.
  const admin = getSupabaseAdmin()

  const [totalRes, visibleRes, excludedRes] = await Promise.all([
    admin.from('slab_sales').select('*', { count: 'exact', head: true }),
    admin.from('slab_sales').select('*', { count: 'exact', head: true }).eq('status', 'visible'),
    admin.from('slab_sales').select('*', { count: 'exact', head: true }).eq('status', 'excluded'),
  ])

  let query = admin
    .from('slab_sales')
    .select('id, card_id, source, grading_company, grade, price, sold_at, title, listing_url, image_url, listing_format, status, excluded_reason, parse_confidence')
    .order('sold_at', { ascending: false })
    .limit(PAGE_LIMIT)
  if (status) query = query.eq('status', status)
  if (source) query = query.eq('source', source)
  if (company) query = query.eq('grading_company', company)
  if (q) query = query.ilike('card_id', `%${q}%`)
  const { data: salesRaw } = await query

  const sales = salesRaw ?? []
  const cardIds = [...new Set(sales.map(s => s.card_id as string))]
  const { data: cardRows } = cardIds.length
    ? await admin.from('cards').select('id, name, image_url').in('id', cardIds)
    : { data: [] as { id: string; name: string; image_url: string | null }[] }
  const cardById = new Map((cardRows ?? []).map(c => [c.id, c]))

  const rows: SlabSaleRow[] = sales.map(s => {
    const card = cardById.get(s.card_id as string)
    return {
      id: String(s.id),
      cardId: s.card_id as string,
      cardName: card?.name ?? '',
      source: s.source as string,
      company: s.grading_company as string,
      grade: s.grade as string,
      price: Number(s.price),
      soldAt: s.sold_at as string,
      title: s.title as string,
      listingUrl: (s.listing_url as string | null) ?? null,
      cardImageUrl: (card?.image_url as string | null) ?? null,
      ebayImageUrl: (s.image_url as string | null) ?? null,
      listingFormat: (s.listing_format as string | null) ?? null,
      status: s.status as SlabSaleRow['status'],
      excludedReason: (s.excluded_reason as string | null) ?? null,
      parseConfidence: (s.parse_confidence as string | null) ?? null,
    }
  })

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold mb-2">Slab Sales</h1>
      <p className="text-zinc-600 mb-6">
        The graded-sale ledger behind slab pricing. Exclude bad comps (lots, bundles, mis-parses) to
        correct a card&apos;s value — exclusions stick across re-scrapes and the affected price recomputes
        instantly. Add private/auction sales by hand below. Comps are computed by{' '}
        <code className="bg-zinc-100 px-1 rounded">scripts/compute-slab-values.ts</code> from the visible rows here.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        <Stat label="Total sales" value={totalRes.count ?? 0} />
        <Stat label="Visible (priced)" value={visibleRes.count ?? 0} tone="emerald" />
        <Stat label="Excluded" value={excludedRes.count ?? 0} tone={excludedRes.count ? 'amber' : 'zinc'} />
      </div>

      <section className="mb-8 border border-zinc-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold mb-3">Add a sale manually</h2>
        <AddSlabSaleForm />
      </section>

      {/* Filters — plain GET form so the URL is shareable / bookmarkable. */}
      <form method="get" className="flex flex-wrap items-end gap-3 mb-4">
        <Field label="Status">
          <select name="status" defaultValue={status} className="border border-zinc-300 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="visible">Visible</option>
            <option value="excluded">Excluded</option>
            <option value="hidden">Hidden</option>
          </select>
        </Field>
        <Field label="Source">
          <select name="source" defaultValue={source} className="border border-zinc-300 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="ebay">eBay</option>
            <option value="alt">Alt</option>
            <option value="admin">Manual</option>
          </select>
        </Field>
        <Field label="Company">
          <select name="company" defaultValue={company} className="border border-zinc-300 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="PSA">PSA</option>
            <option value="BGS">BGS</option>
            <option value="CGC">CGC</option>
            <option value="TAG">TAG</option>
          </select>
        </Field>
        <Field label="Card ID contains">
          <input name="q" defaultValue={q} placeholder="OP07-051" className="border border-zinc-300 rounded px-2 py-1 text-sm" />
        </Field>
        <button type="submit" className="px-3 py-1.5 bg-zinc-900 text-white rounded text-sm font-medium hover:bg-zinc-700">
          Filter
        </button>
        {(status || source || company || q) && (
          <Link href="/admin/slab-sales" className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-900">
            Clear
          </Link>
        )}
      </form>

      <p className="text-xs text-zinc-500 mb-2">
        Showing {rows.length}{rows.length === PAGE_LIMIT ? `+ (capped at ${PAGE_LIMIT})` : ''} sale(s).
      </p>
      <SlabSalesTable rows={rows} />
    </div>
  )
}

function Stat({ label, value, tone = 'zinc' }: { label: string; value: number; tone?: 'zinc' | 'emerald' | 'amber' }) {
  const toneClass =
    tone === 'emerald' ? 'text-emerald-600'
    : tone === 'amber' ? 'text-amber-600'
    : 'text-zinc-900'
  return (
    <div className="border border-zinc-200 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value.toLocaleString()}</p>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
