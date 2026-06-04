'use client'

import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAdminDebug } from '@/lib/useAdminDebug'
import { useAdminMarketData } from '@/lib/useAdminMarketData'
import type { User } from '@supabase/supabase-js'

export default function AuthButton() {
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSeller, setIsSeller] = useState(false)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  // Brief delay before closing on mouseleave so the cursor can travel from
  // the trigger to the menu without the menu vanishing mid-traverse.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const [debugVisible, setDebugVisible] = useAdminDebug()
  const [marketDataVisible, setMarketDataVisible] = useAdminMarketData()

  function cancelClose() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }
  function openMenu() {
    cancelClose()
    setMenuOpen(true)
  }
  function scheduleClose() {
    cancelClose()
    closeTimerRef.current = setTimeout(() => setMenuOpen(false), 200)
  }
  // Single client instance shared between the initial load, the auth
  // subscription, and the sign-out handler — prevents parallel clients
  // from contending on the gotrue auth-token lock.
  const supabase = useMemo(() => createClient(), [])
  const didLoad = useRef(false)

  useEffect(() => {
    // Subscription always (cleanup re-runs in Strict Mode keep it safe).
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      try {
        setUser(session?.user ?? null)
        if (session?.user) {
          const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('is_admin, is_seller, seller_approved')
            .eq('id', session.user.id)
            .single()
          if (profileError) console.error('[AuthButton] auth-change profile fetch failed', JSON.stringify(profileError))
          setIsAdmin(profile?.is_admin || false)
          setIsSeller((profile?.is_seller && profile?.seller_approved) || false)
        } else {
          setIsAdmin(false)
          setIsSeller(false)
        }
      } catch (err) {
        console.error('[AuthButton] auth-change threw', err)
      }
    })

    // Initial getUser fires once. Without this guard, Strict Mode would
    // double-fire and the two parallel getUser() calls would contend on
    // the auth-token navigator-locks mutex, occasionally timing out.
    if (!didLoad.current) {
      didLoad.current = true
      ;(async () => {
        try {
          const { data: { user }, error: userError } = await supabase.auth.getUser()
          if (userError) console.error('[AuthButton] getUser failed', userError)
          setUser(user)
          if (user) {
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('is_admin, is_seller, seller_approved')
              .eq('id', user.id)
              .single()
            if (profileError) console.error('[AuthButton] profile fetch failed', JSON.stringify(profileError))
            setIsAdmin(profile?.is_admin || false)
            setIsSeller((profile?.is_seller && profile?.seller_approved) || false)
          }
        } catch (err) {
          console.error('[AuthButton] init threw', err)
        } finally {
          setLoading(false)
        }
      })()
    }

    return () => subscription.unsubscribe()
  }, [supabase])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut()
    setMenuOpen(false)
    router.push('/')
    router.refresh()
  }, [router, supabase])

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-white/20 animate-pulse" />
  }

  if (!user) {
    return (
      <Link
        href="/auth/sign-in"
        className="px-4 py-2 rounded-lg bg-white hover:bg-zinc-50 text-orange-600 text-sm font-semibold transition-colors"
      >
        Sign In
      </Link>
    )
  }

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'User'
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture

  return (
    <div
      className="relative"
      ref={menuRef}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      <button
        onClick={() => setMenuOpen(o => !o)}
        className="flex items-center gap-2 cursor-pointer"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" className="w-8 h-8 rounded-full border-2 border-white/40" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-orange-600 text-sm font-bold">
            {displayName[0].toUpperCase()}
          </div>
        )}
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-xl bg-white border border-zinc-200 shadow-xl py-2 z-50">
          <div className="px-4 py-2 border-b border-zinc-200">
            <p className="text-sm font-medium text-zinc-900 truncate">{displayName}</p>
            <p className="text-xs text-zinc-500 truncate">{user.email}</p>
          </div>

          <Link
            href="/profile"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
          >
            My Profile
          </Link>
          <Link
            href="/mystuff?tab=purchases"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
          >
            Purchases
          </Link>
          <Link
            href="/wallet"
            onClick={() => setMenuOpen(false)}
            className="block px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
          >
            Wallet
          </Link>
          <div className="border-t border-zinc-200 mt-1 pt-1">
            {isSeller && (
              <Link
                href="/sellerhub"
                onClick={() => setMenuOpen(false)}
                className="block px-4 py-2 text-sm font-medium text-orange-500 hover:bg-zinc-50"
              >
                Seller Hub
              </Link>
            )}
            <Link
              href="/sell"
              onClick={() => setMenuOpen(false)}
              className="block px-4 py-2 text-sm text-orange-400 hover:bg-zinc-50"
            >
              Sell a Card
            </Link>
            {isAdmin && (
              <>
                <Link
                  href="/admin"
                  onClick={() => setMenuOpen(false)}
                  className="block px-4 py-2 text-sm text-purple-500 hover:bg-zinc-50"
                >
                  Admin Panel
                </Link>
                <button
                  type="button"
                  onClick={() => setDebugVisible(!debugVisible)}
                  className="flex items-center justify-between w-full px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                >
                  <span>Debug panels</span>
                  <span
                    role="switch"
                    aria-checked={debugVisible}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      debugVisible ? 'bg-purple-500' : 'bg-zinc-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        debugVisible ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMarketDataVisible(!marketDataVisible)}
                  className="flex items-center justify-between w-full px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                >
                  <span>Market data</span>
                  <span
                    role="switch"
                    aria-checked={marketDataVisible}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      marketDataVisible ? 'bg-purple-500' : 'bg-zinc-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        marketDataVisible ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                </button>
              </>
            )}
          </div>

          <div className="border-t border-zinc-200 mt-1 pt-1">
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-zinc-50 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
