'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function CartButton() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const supabase = createClient()

    async function fetchCount() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { count } = await supabase
        .from('cart_items')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      setCount(count || 0)
    }
    fetchCount()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchCount()
    })

    return () => subscription.unsubscribe()
  }, [])

  if (count === 0) {
    return (
      <Link href="/cart" className="relative text-zinc-400 light:text-gray-500 hover:text-white light:hover:text-gray-900 transition-colors">
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      </Link>
    )
  }

  return (
    <Link href="/cart" className="relative text-zinc-400 light:text-gray-500 hover:text-white light:hover:text-gray-900 transition-colors">
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
      </svg>
      <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-sky-500 text-white text-xs flex items-center justify-center font-bold">
        {count > 9 ? '9+' : count}
      </span>
    </Link>
  )
}
