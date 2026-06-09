'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { MyOffersGrid } from '@/components/dashboard/MyOffersGrid'
import type { Bid } from '@/types/database'

/** Open offers the buyer has placed. Pulled out of the old /mystuff hub into
 *  its own route alongside the Collection portfolio. */
export default function OffersPage() {
  const [offers, setOffers] = useState<Bid[]>([])
  const [cardImages, setCardImages] = useState<Record<string, string>>({})
  const [cardNames, setCardNames] = useState<Record<string, string>>({})
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
        if (!user) { router.push('/auth/sign-in?redirect=/offers'); return }

        const res = await fetch(`/api/bids?user_id=${encodeURIComponent(user.id)}&limit=50`)
        const data = await res.json()
        const fetched = (data.bids as Bid[]) || []
        setOffers(fetched)

        const cardIds = [...new Set(fetched.map(o => o.card_id))]
        if (cardIds.length > 0) {
          try {
            const cres = await fetch(`/api/cards?basic=1&ids=${encodeURIComponent(cardIds.join(','))}`)
            const cdata = await cres.json()
            const images: Record<string, string> = {}
            const names: Record<string, string> = {}
            for (const c of cdata.cards || []) {
              if (c.imageUrl) images[c.id] = c.imageUrl
              if (c.name) names[c.id] = c.name
            }
            setCardImages(images)
            setCardNames(names)
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
        <h1 className="text-2xl font-bold text-zinc-900">My Offers</h1>
        <Link href="/collection" className="text-sm font-semibold text-zinc-500 hover:text-zinc-900">← Collection</Link>
      </div>
      <MyOffersGrid offers={offers} cardImages={cardImages} cardNames={cardNames} onOffersChange={setOffers} />
    </div>
  )
}
