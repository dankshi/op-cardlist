'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function MyShopLink() {
  const [pendingCount, setPendingCount] = useState(0)
  const supabase = useMemo(() => createClient(), [])
  const didCheck = useRef(false)

  useEffect(() => {
    if (didCheck.current) return
    didCheck.current = true
    async function check() {
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
  }, [supabase])

  return (
    <Link href="/mystuff" className="flex items-center gap-1.5 text-white/80 hover:text-white transition-colors text-sm font-medium">
      My Stuff
      {pendingCount > 0 && (
        <span className="min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-white text-orange-600 text-[10px] font-bold px-1">
          {pendingCount}
        </span>
      )}
    </Link>
  )
}
