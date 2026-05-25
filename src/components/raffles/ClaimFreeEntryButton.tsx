'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  raffleId: string
  alreadyClaimed: boolean
}

export function ClaimFreeEntryButton({ raffleId, alreadyClaimed }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (alreadyClaimed) {
    return (
      <div className="inline-flex items-center gap-2 px-5 py-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Free entry claimed
      </div>
    )
  }

  async function claim() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/raffles/free-entry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raffleId }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || 'Could not claim entry')
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError('Network error — try again')
    } finally {
      setSubmitting(false)
    }
  }

  const busy = submitting || pending

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={claim}
        disabled={busy}
        className="inline-flex items-center gap-2 px-6 py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-semibold rounded-lg transition-colors shadow-sm"
      >
        {busy ? (
          <>
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Claiming…
          </>
        ) : (
          <>
            Claim your free entry
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </>
        )}
      </button>
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}
    </div>
  )
}
