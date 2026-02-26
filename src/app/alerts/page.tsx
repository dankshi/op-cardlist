'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { PriceAlert } from '@/types/database'

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }

      const { data } = await supabase
        .from('price_alerts')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      setAlerts((data as PriceAlert[]) || [])
      setLoading(false)
    }
    load()
  }, [supabase, router])

  async function toggleAlert(id: string, isActive: boolean) {
    await supabase.from('price_alerts').update({ is_active: !isActive }).eq('id', id)
    setAlerts(alerts.map(a => a.id === id ? { ...a, is_active: !isActive } : a))
  }

  async function removeAlert(id: string) {
    await supabase.from('price_alerts').delete().eq('id', id)
    setAlerts(alerts.filter(a => a.id !== id))
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-100 light:text-gray-900 mb-8">Price Alerts</h1>

      {alerts.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-zinc-400 light:text-gray-500 mb-4">No price alerts set.</p>
          <p className="text-zinc-500 light:text-gray-400 text-sm mb-6">Set alerts on card pages to be notified when prices change.</p>
          <Link href="/" className="text-sky-400 hover:text-sky-300 light:hover:text-sky-600 font-medium">Browse Cards</Link>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div key={alert.id} className={`flex items-center justify-between p-4 rounded-lg bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 ${!alert.is_active ? 'opacity-50' : ''}`}>
              <div>
                <Link href={`/card/${alert.card_id.toLowerCase()}`} className="font-medium text-zinc-100 light:text-gray-900 hover:text-sky-400 transition-colors">
                  {alert.card_id}
                </Link>
                <p className="text-sm text-zinc-400 light:text-gray-500 mt-1">
                  Alert when price {alert.alert_type === 'below' ? 'drops below' : alert.alert_type === 'above' ? 'rises above' : 'changes'}{' '}
                  <span className="text-sky-400 font-medium">${Number(alert.target_price).toFixed(2)}</span>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleAlert(alert.id, alert.is_active)}
                  className={`px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                    alert.is_active ? 'bg-green-500/10 text-green-400' : 'bg-zinc-700 light:bg-gray-200 text-zinc-400 light:text-gray-500'
                  }`}
                >
                  {alert.is_active ? 'Active' : 'Paused'}
                </button>
                <button
                  onClick={() => removeAlert(alert.id)}
                  className="text-zinc-500 light:text-gray-400 hover:text-red-400 light:hover:text-red-600 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
