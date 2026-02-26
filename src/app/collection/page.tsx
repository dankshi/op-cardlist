'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ConditionBadge } from '@/components/marketplace/ConditionBadge'
import type { CollectionItem } from '@/types/database'

interface CollectionCardInfo extends CollectionItem {
  cardName?: string
  imageUrl?: string
  marketPrice?: number
}

export default function CollectionPage() {
  const [items, setItems] = useState<CollectionCardInfo[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data } = await supabase
        .from('collections')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      setItems((data as CollectionCardInfo[]) || [])
      setLoading(false)
    }
    load()
  }, [supabase, router])

  const totalValue = items.reduce((sum, item) => sum + (item.marketPrice || 0) * item.quantity, 0)
  const totalCards = items.reduce((sum, item) => sum + item.quantity, 0)

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900">My Collection</h1>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-zinc-100 light:text-gray-900">{totalCards}</p>
          <p className="text-xs text-zinc-400 light:text-gray-500">Cards</p>
        </div>
        <div className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-zinc-100 light:text-gray-900">{items.length}</p>
          <p className="text-xs text-zinc-400 light:text-gray-500">Unique</p>
        </div>
        <div className="bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-400">${totalValue.toFixed(2)}</p>
          <p className="text-xs text-zinc-400 light:text-gray-500">Est. Value</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-400 light:text-gray-500 mb-4">Your collection is empty.</p>
          <p className="text-zinc-500 light:text-gray-400 text-sm mb-6">Add cards from any card page to start tracking your collection.</p>
          <Link href="/" className="text-orange-400 hover:text-orange-300 light:hover:text-orange-500 font-medium">Browse Cards</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-4 rounded-lg bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200">
              <div className="flex items-center gap-3">
                <div>
                  <Link href={`/card/${item.card_id.toLowerCase()}`} className="font-medium text-zinc-100 light:text-gray-900 hover:text-orange-400 transition-colors">
                    {item.card_id}
                  </Link>
                  <div className="flex items-center gap-2 mt-1">
                    {item.condition && <ConditionBadge condition={item.condition} />}
                    <span className="text-xs text-zinc-500 light:text-gray-400">x{item.quantity}</span>
                  </div>
                </div>
              </div>
              {item.acquired_price && (
                <span className="text-sm text-zinc-400 light:text-gray-500">Paid: ${Number(item.acquired_price).toFixed(2)}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
