'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function AddToCartButton({ listingId, maxQuantity = 1 }: { listingId: string; maxQuantity?: number }) {
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleAdd() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/auth/sign-in')
      return
    }

    const { error } = await supabase
      .from('cart_items')
      .upsert({
        user_id: user.id,
        listing_id: listingId,
        quantity: 1,
      }, { onConflict: 'user_id,listing_id' })

    if (error) {
      console.error('Failed to add to cart:', error)
    } else {
      setAdded(true)
      setTimeout(() => setAdded(false), 2000)
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handleAdd}
      disabled={loading || added}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
        added
          ? 'bg-green-500/10 text-green-400 border border-green-500/20'
          : 'bg-orange-500 hover:bg-orange-500 text-white disabled:bg-orange-700 disabled:cursor-not-allowed'
      }`}
    >
      {loading ? '...' : added ? 'Added!' : 'Add to Cart'}
    </button>
  )
}
