'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { OrdersGrid } from '@/components/dashboard/OrdersGrid'
import type { Order } from '@/types/database'

/** Buyer's purchases. Pulled out of the old /mystuff hub into its own route
 *  when the buyer area became the Collection portfolio. */
export default function PurchasesPage() {
  const [purchases, setPurchases] = useState<Order[]>([])
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
  const [reviewedOrderIds, setReviewedOrderIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const didLoad = useRef(false)

  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/auth/sign-in?redirect=/orders'); return }

        let fetched: Order[] = []
        const res = await fetch('/api/orders?role=buyer')
        if (res.ok) {
          const data = await res.json()
          fetched = ((data.orders as Order[]) || []).filter(o => o.status !== 'cancelled' && o.status !== 'pending_payment')
          setPurchases(fetched)
        }

        const { data: reviewRows } = await supabase
          .from('reviews')
          .select('order_id')
          .eq('reviewer_id', user.id)
        setReviewedOrderIds(new Set((reviewRows || []).map(r => r.order_id as string)))

        const cardIds = [...new Set(fetched.flatMap(o => o.items?.filter(i => !i.snapshot_photo_url).map(i => i.card_id) || []))]
        if (cardIds.length > 0) {
          try {
            const cres = await fetch(`/api/cards?basic=1&ids=${encodeURIComponent(cardIds.join(','))}`)
            const cdata = await cres.json()
            const images: Record<string, string> = {}
            for (const c of cdata.cards || []) if (c.imageUrl) images[c.id] = c.imageUrl
            setCardImages(images)
          } catch { /* skip */ }
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [supabase, router])

  if (loading) {
    return <div className="py-20 text-center"><div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-900">Purchases</h1>
        <Link href="/collection" className="text-sm font-semibold text-zinc-500 hover:text-zinc-900">← Collection</Link>
      </div>
      <OrdersGrid orders={purchases} kind="purchases" cardImages={cardImages} reviewedOrderIds={reviewedOrderIds} />
    </div>
  )
}
