'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function MyShopLink() {
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    async function check() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { count } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('seller_id', user.id)
        .eq('status', 'paid')

      setPendingCount(count || 0)
    }
    check()
  }, [])

  return (
    <Link href="/dashboard" className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-900 transition-colors text-sm font-medium">
      My Shop
      {pendingCount > 0 && (
        <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold px-1">
          {pendingCount}
        </span>
      )}
    </Link>
  )
}
