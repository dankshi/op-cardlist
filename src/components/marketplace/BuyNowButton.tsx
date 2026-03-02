'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function BuyNowButton({ listingId, price }: { listingId: string; price: number }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleBuyNow() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push(`/auth/sign-in?next=${encodeURIComponent(`/checkout?listing_id=${listingId}`)}`)
      return
    }

    router.push(`/checkout?listing_id=${listingId}`)
  }

  return (
    <button
      onClick={handleBuyNow}
      disabled={loading}
      className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer bg-orange-500 hover:bg-orange-600 text-white disabled:bg-orange-700 disabled:cursor-not-allowed"
    >
      {loading ? 'Processing...' : 'Buy Now'}
    </button>
  )
}
