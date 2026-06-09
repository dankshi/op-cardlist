import { createClient } from '@/lib/supabase/server'
import { getCardsByIds } from '@/lib/cards'
import { gradeLabel } from '@/lib/gradingStyle'
import type { CollectionSale } from '@/types/database'

// Schedule-D-shaped CSV of realized dispositions (docs/collection-pnl.md,
// Phase 3): one row per recorded sale — description, quantity, date sold,
// proceeds, cost basis, gain/loss.

function csvCell(v: string | number | null): string {
  if (v == null) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: salesRaw } = await supabase
    .from('collection_sales')
    .select('*')
    .eq('user_id', user.id)
    .order('sold_at', { ascending: true })
  const sales = (salesRaw ?? []) as CollectionSale[]

  const cards = sales.length ? await getCardsByIds([...new Set(sales.map(s => s.card_id))]) : []
  const nameByCard = new Map(cards.map(c => [c.id, c.name]))

  const header = ['Card', 'Variant', 'Quantity', 'Channel', 'Date sold', 'Gross proceeds', 'Fees', 'Net proceeds', 'Cost basis', 'Realized gain']
  const rows = sales.map(s => [
    nameByCard.get(s.card_id) ?? s.card_id,
    gradeLabel(s.grading_company, s.grade),
    s.quantity,
    s.channel,
    s.sold_at.slice(0, 10),
    s.gross_proceeds ?? '',
    s.fees ?? '',
    s.net_proceeds ?? '',
    s.cost_basis ?? '',
    s.realized_gain ?? '',
  ])

  const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="nomi-collection-sales.csv"',
    },
  })
}
