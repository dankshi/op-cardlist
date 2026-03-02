'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { AuthError } from '@/components/auth/AuthForm'
import type { Profile } from '@/types/database'

export default function SellerApplyPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setProfile(data)
      setLoading(false)
    }
    loadProfile()
  }, [supabase, router])

  async function handleApply() {
    setPending(true)
    setError('')

    const { error } = await supabase
      .from('profiles')
      .update({
        is_seller: true,
        seller_approved: true,
        seller_applied_at: new Date().toISOString(),
      })
      .eq('id', profile!.id)

    if (error) {
      setError(error.message)
      setPending(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (profile?.is_seller && profile?.seller_approved) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-900">You&apos;re already a seller!</h1>
          <p className="text-zinc-500 mt-2">
            Head to your dashboard to manage listings and orders.
          </p>
          <Link
            href="/dashboard"
            className="inline-block mt-6 px-6 py-3 rounded-lg bg-orange-500 hover:bg-orange-500 text-white font-semibold transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-900 mb-8">Become a Seller</h1>

      <div className="bg-white border border-zinc-200 rounded-2xl p-8">
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-zinc-900 mb-4">Why sell on NOMI Market?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { title: 'Low 9% Fee', desc: 'Lower than TCGPlayer\'s 10-13% seller fee' },
              { title: 'Instant Approval', desc: 'Start selling immediately after signup' },
              { title: 'Direct Payouts', desc: 'Get paid directly via Stripe to your bank' },
              { title: 'Growing Community', desc: 'Join the fastest growing OP TCG marketplace' },
            ].map((perk) => (
              <div key={perk.title} className="flex gap-3 p-3 rounded-lg bg-zinc-100">
                <svg className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <div>
                  <p className="font-medium text-zinc-900">{perk.title}</p>
                  <p className="text-sm text-zinc-500">{perk.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-zinc-200 pt-6">
          <h3 className="font-medium text-zinc-900 mb-4">Seller Agreement</h3>
          <div className="p-4 rounded-lg bg-zinc-100 text-sm text-zinc-600 space-y-2 mb-6">
            <p>By becoming a seller on NOMI Market, you agree to:</p>
            <ul className="list-disc list-inside space-y-1 text-zinc-500">
              <li>Accurately describe card conditions in all listings</li>
              <li>Ship orders within 3 business days of payment</li>
              <li>Respond to buyer inquiries within 48 hours</li>
              <li>Accept returns for items not matching the listed condition</li>
              <li>Pay a 9% platform fee on each sale</li>
            </ul>
          </div>

          <AuthError message={error} />

          <button
            onClick={handleApply}
            disabled={pending}
            className="w-full px-4 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-orange-700 disabled:cursor-not-allowed text-white font-semibold transition-colors cursor-pointer"
          >
            {pending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Loading...
              </span>
            ) : (
              'I Agree — Start Selling'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
