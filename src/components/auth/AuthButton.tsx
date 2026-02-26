'use client'

import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { User } from '@supabase/supabase-js'

export default function AuthButton() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }
    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    setMenuOpen(false)
    router.push('/')
    router.refresh()
  }

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-zinc-800 light:bg-gray-100 animate-pulse" />
  }

  if (!user) {
    return (
      <Link
        href="/auth/sign-in"
        className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold transition-colors"
      >
        Sign In
      </Link>
    )
  }

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-2 cursor-pointer"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-sky-600 flex items-center justify-center text-white text-sm font-bold">
            {displayName[0].toUpperCase()}
          </div>
        )}
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl bg-zinc-900 light:bg-white border border-zinc-700 light:border-gray-300 shadow-xl py-2 z-50">
          <div className="px-4 py-2 border-b border-zinc-700 light:border-gray-300">
            <p className="text-sm font-medium text-zinc-100 light:text-gray-900 truncate">{displayName}</p>
            <p className="text-xs text-zinc-400 light:text-gray-500 truncate">{user.email}</p>
          </div>

          <Link
            href="/profile"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-300 light:text-gray-600 hover:bg-zinc-800 light:hover:bg-gray-50 hover:text-zinc-100 light:hover:text-gray-900"
          >
            My Profile
          </Link>
          <Link
            href="/orders"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-300 light:text-gray-600 hover:bg-zinc-800 light:hover:bg-gray-50 hover:text-zinc-100 light:hover:text-gray-900"
          >
            My Orders
          </Link>
          <Link
            href="/collection"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-300 light:text-gray-600 hover:bg-zinc-800 light:hover:bg-gray-50 hover:text-zinc-100 light:hover:text-gray-900"
          >
            My Collection
          </Link>
          <Link
            href="/wants"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-300 light:text-gray-600 hover:bg-zinc-800 light:hover:bg-gray-50 hover:text-zinc-100 light:hover:text-gray-900"
          >
            Want List
          </Link>
          <Link
            href="/decks"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-300 light:text-gray-600 hover:bg-zinc-800 light:hover:bg-gray-50 hover:text-zinc-100 light:hover:text-gray-900"
          >
            My Decks
          </Link>

          <div className="border-t border-zinc-700 light:border-gray-300 mt-1 pt-1">
            <Link
              href="/dashboard"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 text-sm text-sky-400 hover:bg-zinc-800 light:hover:bg-gray-50"
            >
              Seller Dashboard
            </Link>
            <Link
              href="/sell"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 text-sm text-sky-400 hover:bg-zinc-800 light:hover:bg-gray-50"
            >
              Sell a Card
            </Link>
          </div>

          <div className="border-t border-zinc-700 light:border-gray-300 mt-1 pt-1">
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-800 light:hover:bg-gray-50 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
