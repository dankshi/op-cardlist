'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

function OnboardingCompleteContent() {
  const [status, setStatus] = useState<'checking' | 'complete' | 'incomplete'>('checking')
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    async function check() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_onboarding_complete')
        .eq('id', user.id)
        .single()

      if (profile?.stripe_onboarding_complete) {
        setStatus('complete')
      } else if (searchParams.get('refresh')) {
        // Retry onboarding
        const res = await fetch('/api/stripe/connect', { method: 'POST' })
        const data = await res.json()
        if (data.url) window.location.href = data.url
      } else {
        setStatus('incomplete')
      }
    }
    check()
  }, [supabase, router, searchParams])

  if (status === 'checking') {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-zinc-400 light:text-gray-500 mt-4">Checking your Stripe setup...</p>
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
        <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900 mb-3">You&apos;re all set!</h1>
        <p className="text-zinc-400 light:text-gray-500 mb-8">Your Stripe account is connected. You can now receive payments.</p>
        <Link
          href="/dashboard"
          className="px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto text-center py-20">
      <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900 mb-3">Almost there!</h1>
      <p className="text-zinc-400 light:text-gray-500 mb-8">Your Stripe setup isn&apos;t complete yet. Please finish setting up your account.</p>
      <button
        onClick={async () => {
          const res = await fetch('/api/stripe/connect', { method: 'POST' })
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

export default function OnboardingCompletePage() {
  return (
    <Suspense fallback={
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    }>
      <OnboardingCompleteContent />
    </Suspense>
  )
}
