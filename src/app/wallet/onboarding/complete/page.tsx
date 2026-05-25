'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function WalletOnboardingCompleteContent() {
  const [status, setStatus] = useState<'checking' | 'complete' | 'incomplete'>('checking')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])
  const didCheck = useRef(false)

  useEffect(() => {
    if (didCheck.current) return
    didCheck.current = true
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      // Ask the server for fresh Stripe state. The endpoint also mirrors
      // the result into profiles.stripe_onboarding_complete so the wallet
      // page picks it up on its next load without waiting for the
      // account.updated webhook.
      try {
        const res = await fetch('/api/wallet/connect-status', { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          if (data.payoutsEnabled) {
            setStatus('complete')
            return
          }
        }
      } catch { /* fall through to incomplete */ }

      if (searchParams.get('refresh')) {
        // Resume the onboarding link if Stripe sent us back to refresh.
        const res = await fetch('/api/stripe/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intent: 'wallet' }),
        })
        const data = await res.json()
        if (data.url) { window.location.href = data.url; return }
      }
      setStatus('incomplete')
    }
    check()
  }, [supabase, router, searchParams])

  if (status === 'checking') {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-zinc-500 mt-4">Confirming your bank connection...</p>
      </div>
    )
  }

  if (status === 'complete') {
    return (
      <div className="max-w-lg mx-auto text-center py-20">
        <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-zinc-900 mb-3">Bank connected</h1>
        <p className="text-zinc-500 mb-8">You can now cash out your wallet balance anytime.</p>
        <Link
          href="/wallet"
          className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          Back to Wallet
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto text-center py-20">
      <h1 className="text-3xl font-bold text-zinc-900 mb-3">Almost there</h1>
      <p className="text-zinc-500 mb-8">Your bank connection isn&apos;t complete yet. Finish the Stripe setup to enable cashouts.</p>
      <button
        onClick={async () => {
          const res = await fetch('/api/stripe/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ intent: 'wallet' }),
          })
          const data = await res.json()
          if (data.url) window.location.href = data.url
        }}
        className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors cursor-pointer"
      >
        Continue Stripe Setup
      </button>
    </div>
  )
}

export default function WalletOnboardingCompletePage() {
  return (
    <Suspense fallback={
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    }>
      <WalletOnboardingCompleteContent />
    </Suspense>
  )
}
