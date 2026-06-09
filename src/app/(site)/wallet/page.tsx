'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Cashout, CreditTransaction, CreditTransactionType } from '@/types/database'
import { CashoutModal } from '@/components/wallet/CashoutModal'

const TYPE_LABELS: Record<CreditTransactionType, string> = {
  sale_earned: 'Sale credit',
  purchase_spent: 'Purchase',
  cashout: 'Cash out',
  refund_credit: 'Refund',
  admin_adjust: 'Adjustment',
}

const PENDING_ORDER_STATUSES = ['paid', 'seller_shipped', 'received']

type ConnectStatus =
  | { state: 'loading' }
  | { state: 'not_connected' }
  | { state: 'incomplete' }    // account exists, payouts_enabled=false
  | { state: 'ready' }

export default function WalletPage() {
  const [available, setAvailable] = useState(0)
  const [pending, setPending] = useState(0)
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [cashouts, setCashouts] = useState<Cashout[]>([])
  const [connect, setConnect] = useState<ConnectStatus>({ state: 'loading' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const didLoad = useRef(false)

  const load = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const [{ data: profile }, { data: orders }, { data: txns }, { data: cashoutRows }] = await Promise.all([
        supabase.from('profiles').select('balance').eq('id', user.id).single(),
        supabase
          .from('orders')
          .select('subtotal, platform_fee, processing_fee, seller_tier_at_sale, status')
          .eq('seller_id', user.id)
          .in('status', PENDING_ORDER_STATUSES),
        supabase
          .from('credit_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('cashouts')
          .select('*')
          .eq('user_id', user.id)
          .order('requested_at', { ascending: false })
          .limit(10),
      ])

      setAvailable(Number(profile?.balance || 0))

      // Mirrors the credit formula in
      // src/app/api/admin/orders/[orderId]/status/route.ts so the wallet
      // doesn't over-promise. Legacy orders (no seller_tier_at_sale) use
      // the pre-tier formula; tier-aware orders subtract processing_fee.
      const pendingTotal = (orders || []).reduce((sum, o) => {
        const isLegacy = o.seller_tier_at_sale == null
        const credit = isLegacy
          ? Number(o.subtotal) - Number(o.platform_fee || 0) - 5
          : Number(o.subtotal) - Number(o.platform_fee || 0) - Number(o.processing_fee || 0)
        return sum + Math.max(0, credit)
      }, 0)
      setPending(pendingTotal)
      setTransactions((txns as CreditTransaction[]) || [])
      setCashouts((cashoutRows as Cashout[]) || [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load wallet')
    } finally {
      setLoading(false)
    }

    // Fetch Stripe connect state in the background — it needs a Stripe
    // round-trip so doing it last keeps the initial paint snappy.
    try {
      const res = await fetch('/api/wallet/connect-status', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json() as { connected: boolean; payoutsEnabled: boolean }
        if (!data.connected) setConnect({ state: 'not_connected' })
        else if (data.payoutsEnabled) setConnect({ state: 'ready' })
        else setConnect({ state: 'incomplete' })
      } else {
        setConnect({ state: 'not_connected' })
      }
    } catch {
      setConnect({ state: 'not_connected' })
    }
  }, [supabase, router])

  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
    load()
  }, [load])

  async function startConnect() {
    const res = await fetch('/api/stripe/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'wallet' }),
    })
    const data = await res.json()
    if (data.url) window.location.href = data.url
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="py-20 text-center text-sm text-red-600">
        Couldn&rsquo;t load wallet: {loadError}
      </div>
    )
  }

  const canCashOut = connect.state === 'ready' && available >= 10

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/collection" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; Back to Collection
      </Link>

      <h1 className="text-3xl font-bold text-zinc-900 mb-8">Wallet</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <p className="text-sm text-zinc-500 mb-1">Available</p>
          <p className="text-3xl font-bold text-zinc-900">${available.toFixed(2)}</p>
          <p className="text-xs text-zinc-400 mt-2">Ready to spend or cash out (1:1 USD)</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg p-5">
          <p className="text-sm text-zinc-500 mb-1">Pending</p>
          <p className="text-3xl font-bold text-zinc-900">${pending.toFixed(2)}</p>
          <p className="text-xs text-zinc-400 mt-2">Sold &mdash; released after authentication</p>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <p className="font-medium text-zinc-900">Cash out to bank</p>
            <p className="text-sm text-zinc-500 mt-1">
              {connect.state === 'not_connected' && 'Connect a bank account to withdraw your available balance.'}
              {connect.state === 'incomplete' && 'Bank connection started but not finished. Resume Stripe setup to enable cashouts.'}
              {connect.state === 'ready' && available < 10 && 'Minimum cashout is $10. Earn more sales to unlock.'}
              {connect.state === 'ready' && available >= 10 && 'Standard ACH free (1–3 days) or Instant ($1 fee).'}
              {connect.state === 'loading' && 'Checking your bank connection…'}
            </p>
          </div>
          {connect.state === 'not_connected' && (
            <button
              onClick={startConnect}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm"
            >
              Connect bank
            </button>
          )}
          {connect.state === 'incomplete' && (
            <button
              onClick={startConnect}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm"
            >
              Finish setup
            </button>
          )}
          {connect.state === 'ready' && (
            <button
              onClick={() => setModalOpen(true)}
              disabled={!canCashOut}
              className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm disabled:bg-zinc-200 disabled:text-zinc-400 disabled:cursor-not-allowed"
            >
              Cash out
            </button>
          )}
        </div>
      </div>

      {cashouts.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden mb-6">
          <div className="px-5 py-3 border-b border-zinc-200">
            <h2 className="font-medium text-zinc-900">Cashouts</h2>
          </div>
          <ul className="divide-y divide-zinc-100">
            {cashouts.map(c => (
              <li key={c.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-zinc-900">${Number(c.amount).toFixed(2)}</span>
                    <span className="text-xs uppercase tracking-wide text-zinc-500">{c.method}</span>
                    <CashoutStatusBadge status={c.status} />
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2">
                    <span>{new Date(c.requested_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {Number(c.fee) > 0 && (
                      <>
                        <span>&middot;</span>
                        <span>${Number(c.fee).toFixed(2)} fee</span>
                      </>
                    )}
                    {c.failure_reason && (
                      <>
                        <span>&middot;</span>
                        <span className="text-red-600 truncate">{c.failure_reason}</span>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-200">
          <h2 className="font-medium text-zinc-900">Recent activity</h2>
        </div>
        {transactions.length === 0 ? (
          <p className="text-zinc-500 text-sm text-center py-8">No transactions yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {transactions.map(txn => {
              const amount = Number(txn.amount)
              const positive = amount > 0
              return (
                <li key={txn.id} className="px-5 py-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900">{TYPE_LABELS[txn.type] || txn.type}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-zinc-500">
                      <span>{new Date(txn.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      {txn.description && (
                        <>
                          <span>&middot;</span>
                          <span className="truncate">{txn.description}</span>
                        </>
                      )}
                      {txn.order_id && (
                        <>
                          <span>&middot;</span>
                          <Link href={`/orders/${txn.order_id}`} className="text-orange-500 hover:text-orange-600 font-mono">
                            #{txn.order_id.slice(0, 8)}
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                  <p className={`text-sm font-semibold tabular-nums ${positive ? 'text-green-600' : 'text-zinc-900'}`}>
                    {positive ? '+' : ''}${amount.toFixed(2)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {modalOpen && (
        <CashoutModal
          available={available}
          onClose={() => setModalOpen(false)}
          onSuccess={() => {
            setModalOpen(false)
            // Re-fetch so the new balance, ledger row, and pending cashout
            // all appear immediately.
            load()
          }}
        />
      )}
    </div>
  )
}

function CashoutStatusBadge({ status }: { status: Cashout['status'] }) {
  const styles: Record<Cashout['status'], string> = {
    pending: 'bg-amber-50 text-amber-700',
    paid: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-700',
    cancelled: 'bg-zinc-100 text-zinc-600',
  }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${styles[status]}`}>
      {status}
    </span>
  )
}
