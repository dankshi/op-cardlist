'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const PERKS = [
  { title: 'Low fee',         desc: 'From 9% (Basic) down to 7% (Diamond) as your sales grow.' },
  { title: 'Instant approval', desc: 'Start selling right after this screen — no waiting.' },
  { title: 'Authenticated',   desc: "Every order is verified before it ships, so buyers pay more." },
  { title: 'Direct payouts',  desc: 'Funds clear to your bank as cards are delivered.' },
]

const TERMS = [
  'Accurately describe card condition in every listing',
  'Ship orders within 3 business days of payment',
  'Respond to buyer inquiries within 48 hours',
  'Accept returns when a card arrives in worse condition than listed',
]

interface Props {
  /** Auth user ID — the row to flip is_seller / seller_approved on. */
  userId: string
  /** Called after the profile row is updated. Hide the gate and let the
   *  user continue whatever flow brought them here. */
  onApproved: () => void
}

/**
 * Modal-overlay version of /seller/apply. Inlined into the sell flow so
 * a user who clicks "Sell" without being a seller yet agrees in place
 * and immediately continues with their listing — no redirect, no lost
 * context.
 */
export function SellerAgreementGate({ userId, onApproved }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleAgree() {
    setPending(true)
    setError('')
    const { error } = await supabase
      .from('profiles')
      .update({
        is_seller: true,
        seller_approved: true,
        seller_applied_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (error) {
      setError(error.message)
      setPending(false)
      return
    }
    onApproved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-zinc-900/60 backdrop-blur-sm" aria-hidden="true" />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 pt-6 pb-4 sm:px-8 sm:pt-8">
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-orange-500/10 text-orange-700 text-[11px] font-semibold uppercase tracking-wider mb-3">
            One-time setup
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900">
            Quick step before your first listing.
          </h2>
          <p className="text-sm text-zinc-500 mt-1.5">
            Agree to seller terms and you&apos;ll be selling in one click. You&apos;ll never see this again.
          </p>
        </div>

        <div className="px-6 sm:px-8 grid grid-cols-2 gap-2">
          {PERKS.map(p => (
            <div key={p.title} className="rounded-lg bg-zinc-50 p-3">
              <div className="flex items-center gap-1.5 text-zinc-900 text-sm font-semibold">
                <svg className="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {p.title}
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{p.desc}</p>
            </div>
          ))}
        </div>

        <div className="px-6 py-5 sm:px-8 sm:py-6">
          <div className="text-[11px] uppercase tracking-[0.14em] text-zinc-500 font-semibold mb-2">
            By listing, you agree to
          </div>
          <ul className="space-y-1.5">
            {TERMS.map(t => (
              <li key={t} className="flex items-start gap-2 text-sm text-zinc-700">
                <span className="w-1 h-1 rounded-full bg-zinc-400 mt-2 shrink-0" />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <p className="px-6 sm:px-8 pb-3 text-sm text-rose-600">{error}</p>
        )}

        <div className="px-6 py-4 sm:px-8 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            Not now
          </Link>
          <button
            type="button"
            onClick={handleAgree}
            disabled={pending}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-zinc-900 text-white font-semibold text-sm hover:bg-zinc-800 transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            {pending ? 'Setting up…' : (
              <>
                I agree — start selling
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
