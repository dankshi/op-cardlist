'use client'

import { useEffect, useMemo, useState } from 'react'
import type { PayoutMethod } from '@/types/database'
import { CASHOUT_MIN_AMOUNT, INSTANT_PAYOUT_FEE, quoteCashout } from '@/lib/cashout'

interface Props {
  available: number
  onClose: () => void
  onSuccess: () => void
}

export function CashoutModal({ available, onClose, onSuccess }: Props) {
  const [amount, setAmount] = useState<string>(available.toFixed(2))
  const [method, setMethod] = useState<PayoutMethod>('standard')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const numericAmount = useMemo(() => {
    const n = Number(amount)
    return Number.isFinite(n) ? n : 0
  }, [amount])

  const quote = useMemo(() => quoteCashout(numericAmount, method), [numericAmount, method])
  const exceedsBalance = quote.totalDebited > available + 1e-9
  const belowMin = numericAmount > 0 && numericAmount < CASHOUT_MIN_AMOUNT
  const canSubmit = numericAmount >= CASHOUT_MIN_AMOUNT && !exceedsBalance && !submitting

  // Lock the page scroll while the modal is open
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  async function submit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/wallet/cashout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: numericAmount, method }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Cashout failed')
        setSubmitting(false)
        return
      }
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cashout failed')
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-zinc-900">Cash out to bank</h2>
            <p className="text-sm text-zinc-500 mt-1">Available: ${available.toFixed(2)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 -mt-1 -mr-1 p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-zinc-700">Amount to receive</span>
          <div className="relative mt-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">$</span>
            <input
              type="number"
              min={CASHOUT_MIN_AMOUNT}
              max={available}
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-full pl-7 pr-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <span className="text-xs text-zinc-400 mt-1 block">
            Minimum ${CASHOUT_MIN_AMOUNT}
          </span>
        </label>

        <fieldset className="mt-4 space-y-2">
          <legend className="text-sm font-medium text-zinc-700 mb-2">Speed</legend>
          <label className="flex items-start gap-3 p-3 border border-zinc-200 rounded-lg cursor-pointer hover:border-zinc-300">
            <input
              type="radio"
              name="method"
              checked={method === 'standard'}
              onChange={() => setMethod('standard')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-900">Standard</span>
                <span className="text-sm text-green-600 font-semibold">Free</span>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">Arrives in 1&ndash;3 business days</p>
            </div>
          </label>
          <label className="flex items-start gap-3 p-3 border border-zinc-200 rounded-lg cursor-pointer hover:border-zinc-300">
            <input
              type="radio"
              name="method"
              checked={method === 'instant'}
              onChange={() => setMethod('instant')}
              className="mt-0.5"
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-900">Instant</span>
                <span className="text-sm text-zinc-700 font-semibold">${INSTANT_PAYOUT_FEE.toFixed(2)}</span>
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">Arrives within minutes</p>
            </div>
          </label>
        </fieldset>

        <div className="mt-5 p-3 bg-zinc-50 rounded-lg space-y-1.5 text-sm">
          <div className="flex justify-between text-zinc-600">
            <span>Amount to bank</span>
            <span className="tabular-nums">${quote.amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-600">
            <span>Fee</span>
            <span className="tabular-nums">${quote.fee.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-zinc-900 font-semibold pt-1.5 border-t border-zinc-200">
            <span>Total debited</span>
            <span className="tabular-nums">${quote.totalDebited.toFixed(2)}</span>
          </div>
        </div>

        {belowMin && (
          <p className="text-sm text-red-600 mt-3">Minimum cashout is ${CASHOUT_MIN_AMOUNT}.</p>
        )}
        {exceedsBalance && !belowMin && (
          <p className="text-sm text-red-600 mt-3">
            Not enough credits ({method === 'instant' ? `need $${quote.totalDebited.toFixed(2)} with fee` : `need $${quote.totalDebited.toFixed(2)}`}).
          </p>
        )}
        {error && (
          <p className="text-sm text-red-600 mt-3">{error}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-zinc-300 text-zinc-700 font-medium hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex-1 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold disabled:bg-zinc-300 disabled:cursor-not-allowed"
          >
            {submitting ? 'Processing…' : `Cash out $${quote.amount.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  )
}
