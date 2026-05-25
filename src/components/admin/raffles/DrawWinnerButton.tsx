'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  raffleId: string
  entryCount: number
}

export function DrawWinnerButton({ raffleId, entryCount }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function draw() {
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/admin/raffles/${raffleId}/draw`, {
        method: 'POST',
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error || 'Draw failed')
        return
      }
      startTransition(() => router.refresh())
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
      setConfirming(false)
    }
  }

  if (entryCount === 0) {
    return (
      <div className="text-sm text-zinc-500 italic">
        No entries yet — nothing to draw from.
      </div>
    )
  }

  const busy = submitting || pending

  if (confirming) {
    return (
      <div className="border border-amber-300 bg-amber-50 rounded-lg p-4">
        <p className="text-sm text-amber-900 font-medium mb-3">
          Draw a winner now? This picks one entry uniformly at random from{' '}
          <span className="font-bold tabular-nums">{entryCount.toLocaleString('en-US')}</span>{' '}
          entries and marks the raffle <span className="font-bold">drawn</span>. Can&apos;t be undone from the UI.
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={draw}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-semibold rounded-lg text-sm transition-colors"
          >
            {busy ? 'Drawing…' : 'Yes, draw winner'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="px-4 py-2 bg-white border border-zinc-300 hover:bg-zinc-50 text-zinc-700 font-medium rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-2 px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-lg transition-colors shadow-sm"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.539 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      Draw winner
    </button>
  )
}
