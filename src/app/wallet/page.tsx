'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { CreditTransaction, CreditTransactionType } from '@/types/database'

const TYPE_LABELS: Record<CreditTransactionType, string> = {
  sale_earned: 'Sale credit',
  purchase_spent: 'Purchase',
  cashout: 'Cash out',
  refund_credit: 'Refund',
  admin_adjust: 'Adjustment',
}

const PENDING_ORDER_STATUSES = ['paid', 'seller_shipped', 'received']

export default function WalletPage() {
  const [available, setAvailable] = useState(0)
  const [pending, setPending] = useState(0)
  const [transactions, setTransactions] = useState<CreditTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const [{ data: profile }, { data: orders }, { data: txns }] = await Promise.all([
        supabase.from('profiles').select('balance').eq('id', user.id).single(),
        supabase
          .from('orders')
          .select('subtotal, platform_fee, status')
          .eq('seller_id', user.id)
          .in('status', PENDING_ORDER_STATUSES),
        supabase
          .from('credit_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      setAvailable(Number(profile?.balance || 0))
      const pendingTotal = (orders || []).reduce(
        (sum, o) => sum + (Number(o.subtotal) - Number(o.platform_fee)),
        0,
      )
      setPending(pendingTotal)
      setTransactions((txns as CreditTransaction[]) || [])
      setLoading(false)
    }
    load()
  }, [supabase, router])

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <Link href="/mystuff" className="text-sm text-zinc-500 hover:text-zinc-700 mb-4 inline-block">
        &larr; Back to My Stuff
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
          <p className="text-xs text-zinc-400 mt-2">Sold — released after authentication</p>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-zinc-900">Cash out to bank</p>
            <p className="text-sm text-zinc-500 mt-1">Connect a bank account to withdraw your available balance.</p>
          </div>
          <button
            disabled
            className="px-4 py-2 rounded-lg bg-zinc-100 text-zinc-400 font-semibold text-sm cursor-not-allowed"
            title="Coming soon"
          >
            Coming soon
          </button>
        </div>
      </div>

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
    </div>
  )
}
