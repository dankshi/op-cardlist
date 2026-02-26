'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { CONDITION_SHORT, type CardCondition } from '@/types/database'
import type { WantListItem } from '@/types/database'

export default function WantsPage() {
  const [items, setItems] = useState<WantListItem[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data } = await supabase
        .from('want_list_items')
        .select('*')
        .eq('user_id', user.id)
        .order('priority', { ascending: false })

      setItems((data as WantListItem[]) || [])
      setLoading(false)
    }
    load()
  }, [supabase, router])

  async function removeItem(id: string) {
    await supabase.from('want_list_items').delete().eq('id', id)
    setItems(items.filter(i => i.id !== id))
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  const PRIORITY_LABELS = ['Normal', 'High', 'Urgent']

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900 mb-8">Want List</h1>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-400 light:text-gray-500 mb-4">Your want list is empty.</p>
          <p className="text-zinc-500 light:text-gray-400 text-sm mb-6">Add cards you want to buy from any card page.</p>
          <Link href="/" className="text-sky-400 hover:text-sky-300 light:hover:text-sky-600 font-medium">Browse Cards</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <div key={item.id} className="flex items-center justify-between p-4 rounded-lg bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200">
              <div>
                <Link href={`/card/${item.card_id.toLowerCase()}`} className="font-medium text-zinc-100 light:text-gray-900 hover:text-sky-400 transition-colors">
                  {item.card_id}
                </Link>
                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500 light:text-gray-400">
                  {item.max_price && <span>Max: ${Number(item.max_price).toFixed(2)}</span>}
                  <span>Min: {CONDITION_SHORT[item.min_condition as CardCondition] || item.min_condition}</span>
                  {item.priority > 0 && (
                    <span className={item.priority === 2 ? 'text-red-400' : 'text-yellow-400'}>
                      {PRIORITY_LABELS[item.priority]}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={() => removeItem(item.id)}
                className="text-zinc-500 light:text-gray-400 hover:text-red-400 light:hover:text-red-600 transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
