'use client'

import { Suspense, useEffect, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { getPrinterStatus, printProductLabel, printTriageLabel } from '@/lib/zebra'
import type { Order, OrderItem, IntakeIssue, IntakeIssueType, TriagePackage, TrackingMatchType } from '@/types/database'

// ============================================
// Constants
// ============================================

const INTAKE_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-zinc-200 text-zinc-600',
  verified: 'bg-green-500/10 text-green-500',
  flagged: 'bg-red-500/10 text-red-500',
  resolved: 'bg-blue-500/10 text-blue-500',
  rejected: 'bg-red-500/10 text-red-700',
}

/** Build an image URL for a card. Uses snapshot_photo_url if present, otherwise
 *  falls back to our R2 CDN using the card_id. */
function cardImageUrl(item: OrderItem): string | null {
  if (item.snapshot_photo_url) return item.snapshot_photo_url
  if (item.card_id && item.card_id !== 'admin-added' && item.card_id !== 'triage-item') {
    return `https://pub-7ca7df93bad849619d03ad7adf4515e8.r2.dev/cards/${item.card_id}.png`
  }
  return null
}

const ISSUE_TYPE_LABELS: Record<IntakeIssueType, string> = {
  wrong_card: 'Wrong Card',
  wrong_condition: 'Wrong Condition',
  missing_item: 'Missing Item',
  counterfeit: 'Counterfeit',
  damaged_in_transit: 'Damaged in Transit',
  wrong_quantity: 'Wrong Quantity',
  other: 'Other',
}

// ============================================
// Types
// ============================================

interface OrderWithIntake extends Order {
  intake_issues?: IntakeIssue[]
  activity_log?: { id: string; action: string; details: Record<string, unknown>; created_at: string }[]
}

type IntakeStep =
  | { step: 'scan' }
  | { step: 'order_found'; order: OrderWithIntake; trackingNumber?: string }
  | { step: 'no_tracking'; trackingNumber: string }
  | { step: 'reused_label'; trackingNumber: string; orders: OrderWithIntake[]; sellerId: string; sellerName: string }
  | { step: 'pon_scan'; context: 'no_tracking' | 'reused_label'; trackingNumber: string; sellerId?: string; sellerName?: string }
  | { step: 'order_details'; order: OrderWithIntake; source: string }
  | { step: 'triage_printed'; triagePackage: TriagePackage; trackingNumber: string; sellerName?: string }
  | { step: 'triage_identify'; triagePackage: TriagePackage }
  | { step: 'triage_search'; triagePackage: TriagePackage; cardType: 'raw' | 'slab'; certNumber?: string; nomiInput?: string }

// ============================================
// Main Page
// ============================================

export default function IntakePage() {
  return (
    <Suspense fallback={
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    }>
      <IntakePageContent />
    </Suspense>
  )
}

function IntakePageContent() {
  const [currentStep, setCurrentStep] = useState<IntakeStep>({ step: 'scan' })
  const [scanInput, setScanInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [scanLoading, setScanLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [printerStatus, setPrinterStatus] = useState<'ready' | 'offline' | 'error' | 'checking'>('checking')
  const scanRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Auth check
  useEffect(() => {
    async function checkAuth() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()
      if (!profile?.is_admin) { router.push('/'); return }
      setLoading(false)
      scanRef.current?.focus()
    }
    checkAuth()
  }, [supabase, router])

  // Printer status check
  useEffect(() => {
    let interval: NodeJS.Timeout
    async function check() {
      const status = await getPrinterStatus()
      setPrinterStatus(status)
    }
    check()
    interval = setInterval(check, 30000)
    return () => clearInterval(interval)
  }, [])

  const showSuccess = (msg: string) => {
    setSuccessMessage(msg)
    setTimeout(() => setSuccessMessage(''), 4000)
  }

  const resetToScan = () => {
    setCurrentStep({ step: 'scan' })
    setScanInput('')
    setError('')
    setTimeout(() => scanRef.current?.focus(), 100)
  }

  // ============================================
  // Scan handler — detects input type and routes
  // ============================================
  const handleScan = useCallback(async (input?: string) => {
    const raw = (input || scanInput).trim()
    if (!raw) return
    setScanLoading(true)
    setError('')

    try {
      // 1. Triage QR code: starts with "TRIAGE:"
      if (raw.startsWith('TRIAGE:')) {
        const triageId = raw.replace('TRIAGE:', '')
        const res = await fetch(`/api/admin/intake/triage?id=${encodeURIComponent(triageId)}`)
        if (!res.ok) {
          setError('Triage package not found')
          setScanLoading(false)
          return
        }
        const data = await res.json()
        setCurrentStep({ step: 'triage_identify', triagePackage: data.triagePackage })
        setScanInput('')
        setScanLoading(false)
        return
      }

      // 2. UUID format (36 chars with dashes): treat as PON / order ID scan
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (uuidRegex.test(raw) || (raw.length >= 8 && raw.length <= 36 && /^[0-9a-f-]+$/i.test(raw))) {
        const res = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(raw)}`)
        if (!res.ok) {
          setError('Order not found')
          setScanLoading(false)
          return
        }
        const data = await res.json()
        if (data.orders?.length > 0) {
          setCurrentStep({ step: 'order_details', order: data.orders[0], source: 'pon_scan' })
        } else {
          setError('Order not found')
        }
        setScanInput('')
        setScanLoading(false)
        return
      }

      // 3. Default: treat as tracking number
      const res = await fetch(`/api/admin/intake/scan-tracking?tracking=${encodeURIComponent(raw)}`)
      if (!res.ok) {
        setError('Failed to search tracking number')
        setScanLoading(false)
        return
      }
      const data = await res.json()
      const match = data.match as TrackingMatchType

      if (match === 'exact') {
        setCurrentStep({ step: 'order_found', order: data.orders[0], trackingNumber: raw })
      } else if (match === 'none') {
        setCurrentStep({ step: 'no_tracking', trackingNumber: raw })
      } else if (match === 'reused' || match === 'multiple') {
        const sellerName = data.orders[0]?.seller?.display_name || 'Unknown Seller'
        setCurrentStep({
          step: 'reused_label',
          trackingNumber: raw,
          orders: data.orders,
          sellerId: data.seller_id || data.orders[0]?.seller_id,
          sellerName,
        })
      }
    } catch (err) {
      setError('Scan failed — check your connection')
    }

    setScanInput('')
    setScanLoading(false)
  }, [scanInput])

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">Intake Scanner</h1>
          <p className="text-sm text-zinc-500 mt-1">Scan tracking number from shipping label to begin</p>
        </div>
        <div className="flex items-center gap-3">
          <PrinterStatusBadge status={printerStatus} />
          <Link
            href="/admin/intake/issues"
            className="px-4 py-2 bg-zinc-100 text-zinc-700 rounded-lg text-sm font-medium hover:bg-zinc-200 transition-colors"
          >
            View Issues
          </Link>
        </div>
      </div>

      {/* Always-visible scan input */}
      <div className="mb-6">
        <div className="relative max-w-2xl">
          <input
            ref={scanRef}
            type="text"
            placeholder={currentStep.step === 'scan'
              ? 'Scan tracking number from shipping label...'
              : 'Scan next tracking / PON / triage QR...'
            }
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
            autoFocus
            className="w-full px-6 py-4 rounded-xl bg-white border-2 border-zinc-300 text-zinc-900 placeholder-zinc-400 text-lg font-mono focus:border-orange-500 focus:outline-none transition-colors"
          />
          <button
            onClick={() => handleScan()}
            disabled={scanLoading}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-5 py-2 bg-orange-500 text-white rounded-lg font-semibold text-sm hover:bg-orange-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {scanLoading ? 'Searching...' : 'Look Up'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
        {successMessage && <p className="text-green-500 text-sm mt-2 font-medium">{successMessage}</p>}
      </div>

      {/* Step content */}
      {currentStep.step === 'scan' && (
        <ScanWelcome />
      )}

      {currentStep.step === 'order_found' && (
        <OrderFoundStep
          order={currentStep.order}
          trackingNumber={currentStep.trackingNumber}
          printerReady={printerStatus === 'ready'}
          onReceived={(order) => {
            showSuccess('Package received — labels printed')
            setCurrentStep({ step: 'order_details', order, source: 'tracking_scan' })
          }}
          onSkipToDetails={(order) => {
            setCurrentStep({ step: 'order_details', order, source: 'tracking_scan' })
          }}
        />
      )}

      {currentStep.step === 'no_tracking' && (
        <NoTrackingStep
          trackingNumber={currentStep.trackingNumber}
          onPonScan={() => setCurrentStep({
            step: 'pon_scan',
            context: 'no_tracking',
            trackingNumber: currentStep.trackingNumber,
          })}
          onTriage={async () => {
            const res = await fetch('/api/admin/intake/triage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                triageType: 'no_order',
                trackingNumber: currentStep.trackingNumber,
              }),
            })
            if (res.ok) {
              const { triagePackage } = await res.json()
              await printTriageLabel('triage_no_order', triagePackage.id, { trackingNumber: currentStep.trackingNumber })
              setCurrentStep({
                step: 'triage_printed',
                triagePackage,
                trackingNumber: currentStep.trackingNumber,
              })
            } else {
              setError('Failed to create triage record')
            }
          }}
          onReset={resetToScan}
        />
      )}

      {currentStep.step === 'reused_label' && (
        <ReusedLabelStep
          trackingNumber={currentStep.trackingNumber}
          orders={currentStep.orders}
          sellerName={currentStep.sellerName}
          onPonScan={() => setCurrentStep({
            step: 'pon_scan',
            context: 'reused_label',
            trackingNumber: currentStep.trackingNumber,
            sellerId: currentStep.sellerId,
            sellerName: currentStep.sellerName,
          })}
          onTriage={async () => {
            const res = await fetch('/api/admin/intake/triage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                triageType: 'user_id',
                trackingNumber: currentStep.trackingNumber,
                sellerId: currentStep.sellerId,
              }),
            })
            if (res.ok) {
              const { triagePackage } = await res.json()
              await printTriageLabel('triage_user_id', triagePackage.id, {
                sellerName: currentStep.sellerName,
                trackingNumber: currentStep.trackingNumber,
              })
              setCurrentStep({
                step: 'triage_printed',
                triagePackage,
                trackingNumber: currentStep.trackingNumber,
                sellerName: currentStep.sellerName,
              })
            } else {
              setError('Failed to create triage record')
            }
          }}
          onReset={resetToScan}
        />
      )}

      {currentStep.step === 'pon_scan' && (
        <PonScanStep
          context={currentStep.context}
          trackingNumber={currentStep.trackingNumber}
          onOrderFound={(order) => {
            setCurrentStep({ step: 'order_details', order, source: 'pon_scan' })
          }}
          onBack={() => {
            if (currentStep.context === 'no_tracking') {
              setCurrentStep({ step: 'no_tracking', trackingNumber: currentStep.trackingNumber })
            } else {
              // Go back to reused — but we lost the state, so just reset
              resetToScan()
            }
          }}
          onReset={resetToScan}
        />
      )}

      {currentStep.step === 'order_details' && (
        <OrderDetailsStep
          order={currentStep.order}
          source={currentStep.source}
          printerReady={printerStatus === 'ready'}
          onRefresh={async (orderId) => {
            const res = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(orderId)}`)
            if (res.ok) {
              const data = await res.json()
              if (data.orders?.[0]) {
                setCurrentStep({ step: 'order_details', order: data.orders[0], source: currentStep.source })
              }
            }
          }}
          onReset={resetToScan}
          showSuccess={showSuccess}
        />
      )}

      {currentStep.step === 'triage_printed' && (
        <TriagePrintedStep
          triagePackage={currentStep.triagePackage}
          trackingNumber={currentStep.trackingNumber}
          sellerName={currentStep.sellerName}
          onNextPackage={resetToScan}
        />
      )}

      {currentStep.step === 'triage_identify' && (
        <TriageIdentifyStep
          triagePackage={currentStep.triagePackage}
          onSubmit={(cardType, certNumber, nomiInput) => {
            setCurrentStep({
              step: 'triage_search',
              triagePackage: currentStep.triagePackage,
              cardType,
              certNumber,
              nomiInput,
            })
          }}
          onReset={resetToScan}
        />
      )}

      {currentStep.step === 'triage_search' && (
        <TriageSearchStep
          triagePackage={currentStep.triagePackage}
          cardType={currentStep.cardType}
          certNumber={currentStep.certNumber}
          nomiInput={currentStep.nomiInput}
          printerReady={printerStatus === 'ready'}
          onResolved={(orderId) => {
            showSuccess(`Triage resolved — received under order ${orderId.slice(0, 8)}`)
            resetToScan()
          }}
          onConsigned={() => {
            showSuccess('Item consigned to House Account')
            resetToScan()
          }}
          onBack={() => setCurrentStep({ step: 'triage_identify', triagePackage: currentStep.triagePackage })}
          onReset={resetToScan}
        />
      )}
    </div>
  )
}

// ============================================
// Printer Status Badge
// ============================================

function PrinterStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    ready: 'bg-green-100 text-green-700',
    offline: 'bg-red-100 text-red-700',
    error: 'bg-red-100 text-red-700',
    checking: 'bg-zinc-100 text-zinc-500',
  }
  const labels: Record<string, string> = {
    ready: 'Printer Ready',
    offline: 'Printer Offline',
    error: 'Printer Error',
    checking: 'Checking...',
  }
  return (
    <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${styles[status] || styles.offline}`}>
      {labels[status] || 'Unknown'}
    </span>
  )
}

// ============================================
// Step: Scan Welcome
// ============================================

function ScanWelcome() {
  return (
    <div className="text-center py-16 text-zinc-400">
      <div className="text-6xl mb-4">📦</div>
      <p className="text-lg font-medium text-zinc-600">Ready to scan</p>
      <p className="text-sm mt-1">Scan the tracking number from the shipping label to begin intake</p>
      <div className="mt-8 grid grid-cols-3 gap-4 max-w-lg mx-auto text-xs">
        <div className="bg-zinc-50 rounded-lg p-3">
          <p className="font-semibold text-zinc-600">Tracking #</p>
          <p className="text-zinc-400 mt-1">Shipping label barcode</p>
        </div>
        <div className="bg-zinc-50 rounded-lg p-3">
          <p className="font-semibold text-zinc-600">PON / Order ID</p>
          <p className="text-zinc-400 mt-1">Packing slip QR code</p>
        </div>
        <div className="bg-zinc-50 rounded-lg p-3">
          <p className="font-semibold text-zinc-600">Triage QR</p>
          <p className="text-zinc-400 mt-1">From triage pile</p>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Step: Order Found (happy path)
// ============================================

function OrderFoundStep({ order, trackingNumber, printerReady, onReceived, onSkipToDetails }: {
  order: OrderWithIntake
  trackingNumber?: string
  printerReady: boolean
  onReceived: (order: OrderWithIntake) => void
  onSkipToDetails: (order: OrderWithIntake) => void
}) {
  const [receiving, setReceiving] = useState(false)

  const handleReceiveAndPrint = async () => {
    setReceiving(true)

    // 1. Mark as received
    const receiveRes = await fetch('/api/admin/intake/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id, receivedVia: 'tracking_scan' }),
    })

    if (!receiveRes.ok) {
      const data = await receiveRes.json()
      // If already received, just continue
      if (!data.already_received) {
        setReceiving(false)
        return
      }
    }

    // 2. Print product QR labels for each item
    if (order.items) {
      for (const item of order.items) {
        await printProductLabel(item.id, item.card_name, order.id.slice(0, 8).toUpperCase())
      }
    }

    // 3. Refresh order data and move to details
    const refreshRes = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(order.id)}`)
    if (refreshRes.ok) {
      const data = await refreshRes.json()
      onReceived(data.orders?.[0] || order)
    } else {
      onReceived(order)
    }
    setReceiving(false)
  }

  const sellerName = (order.seller as { display_name?: string })?.display_name || 'Unknown'
  const buyerName = (order.buyer as { display_name?: string })?.display_name || 'Unknown'
  const alreadyReceived = order.status === 'received'

  return (
    <div className="bg-white border-2 border-green-200 rounded-xl overflow-hidden">
      <div className="p-5 bg-green-50 border-b border-green-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">✅</span>
          <div>
            <h2 className="text-lg font-bold text-green-800">
              {alreadyReceived ? 'Order Already Received' : 'Order Found — Ready to Receive'}
            </h2>
            <p className="text-sm text-green-600">
              Tracking {trackingNumber} matched to Order #{order.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
          <div><span className="text-zinc-500">Seller:</span> <span className="font-medium text-zinc-900">{sellerName}</span></div>
          <div><span className="text-zinc-500">Buyer:</span> <span className="font-medium text-zinc-900">{buyerName}</span></div>
          <div><span className="text-zinc-500">Total:</span> <span className="font-medium text-zinc-900">${Number(order.total).toFixed(2)}</span></div>
          <div><span className="text-zinc-500">Items:</span> <span className="font-medium text-zinc-900">{order.items?.length || 0}</span></div>
        </div>

        {/* Item cards with large images */}
        {order.items && order.items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-5">
            {order.items.map((item, i) => {
              const imgUrl = cardImageUrl(item)
              return (
                <div key={item.id} className="bg-zinc-50 rounded-xl border border-zinc-200 overflow-hidden">
                  <div className="relative aspect-[63/88] bg-zinc-100">
                    {imgUrl ? (
                      <Image src={imgUrl} alt={item.card_name} fill className="object-cover" unoptimized />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-4xl">🃏</div>
                    )}
                    <span className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center text-xs font-bold">{i + 1}</span>
                    {item.quantity > 1 && (
                      <span className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-orange-500 text-white text-xs font-bold">x{item.quantity}</span>
                    )}
                  </div>
                  <div className="p-2 text-center">
                    <p className="text-xs font-semibold text-zinc-800 truncate">{item.card_name}</p>
                    <p className="text-xs text-zinc-400">${Number(item.unit_price).toFixed(2)}</p>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex gap-3">
          {!alreadyReceived ? (
            <button
              onClick={handleReceiveAndPrint}
              disabled={receiving}
              className="flex-1 py-3 bg-green-500 text-white text-sm font-bold rounded-xl hover:bg-green-600 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {receiving ? 'Receiving & Printing Labels...' : `Receive Package & Print ${order.items?.length || 0} Label(s)`}
            </button>
          ) : (
            <button
              onClick={() => onSkipToDetails(order)}
              className="flex-1 py-3 bg-orange-500 text-white text-sm font-bold rounded-xl hover:bg-orange-600 transition-colors cursor-pointer"
            >
              Continue to Item Verification
            </button>
          )}
          {!printerReady && !alreadyReceived && (
            <p className="text-xs text-red-500 self-center">Printer offline — labels will queue</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// Step: No Tracking Found
// ============================================

function NoTrackingStep({ trackingNumber, onPonScan, onTriage, onReset }: {
  trackingNumber: string
  onPonScan: () => void
  onTriage: () => void
  onReset: () => void
}) {
  const [triaging, setTriaging] = useState(false)

  return (
    <div className="bg-white border-2 border-yellow-200 rounded-xl overflow-hidden">
      <div className="p-5 bg-yellow-50 border-b border-yellow-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h2 className="text-lg font-bold text-yellow-800">Tracking Not Found</h2>
            <p className="text-sm text-yellow-600 font-mono">{trackingNumber}</p>
          </div>
        </div>
      </div>
      <div className="p-5">
        <p className="text-sm text-zinc-600 mb-5">This tracking number is not linked to any order. Check for a packing slip in the package.</p>
        <div className="flex gap-3">
          <button
            onClick={onPonScan}
            className="flex-1 py-3 bg-blue-500 text-white text-sm font-bold rounded-xl hover:bg-blue-600 transition-colors cursor-pointer"
          >
            Scan Packing Slip (PON)
          </button>
          <button
            onClick={async () => { setTriaging(true); await onTriage(); setTriaging(false) }}
            disabled={triaging}
            className="flex-1 py-3 bg-red-500 text-white text-sm font-bold rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {triaging ? 'Creating Triage...' : 'No Packing Slip — Send to Triage'}
          </button>
        </div>
        <button onClick={onReset} className="mt-3 text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
          ← Start over
        </button>
      </div>
    </div>
  )
}

// ============================================
// Step: Re-used Label
// ============================================

function ReusedLabelStep({ trackingNumber, orders, sellerName, onPonScan, onTriage, onReset }: {
  trackingNumber: string
  orders: OrderWithIntake[]
  sellerName: string
  onPonScan: () => void
  onTriage: () => void
  onReset: () => void
}) {
  const [triaging, setTriaging] = useState(false)

  return (
    <div className="bg-white border-2 border-orange-200 rounded-xl overflow-hidden">
      <div className="p-5 bg-orange-50 border-b border-orange-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔄</span>
          <div>
            <h2 className="text-lg font-bold text-orange-800">Re-used Label Detected</h2>
            <p className="text-sm text-orange-600">
              Tracking <span className="font-mono">{trackingNumber}</span> is linked to a previous / multiple order(s)
            </p>
          </div>
        </div>
      </div>
      <div className="p-5">
        <p className="text-sm text-zinc-600 mb-3">Previous orders with this tracking:</p>
        <div className="space-y-2 mb-5">
          {orders.map(o => (
            <div key={o.id} className="bg-zinc-50 rounded-lg p-3 flex items-center justify-between text-sm">
              <div>
                <span className="font-mono font-bold text-zinc-700">#{o.id.slice(0, 8).toUpperCase()}</span>
                <span className="ml-2 text-zinc-400">{new Date(o.created_at).toLocaleDateString()}</span>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${
                o.status === 'received' || o.status === 'authenticated' ? 'bg-green-100 text-green-700' : 'bg-zinc-200 text-zinc-600'
              }`}>{o.status}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-zinc-600 mb-5">
          Seller: <span className="font-semibold">{sellerName}</span> — Check the packing slip to find the correct order.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onPonScan}
            className="flex-1 py-3 bg-blue-500 text-white text-sm font-bold rounded-xl hover:bg-blue-600 transition-colors cursor-pointer"
          >
            Scan Packing Slip (PON)
          </button>
          <button
            onClick={async () => { setTriaging(true); await onTriage(); setTriaging(false) }}
            disabled={triaging}
            className="flex-1 py-3 bg-red-500 text-white text-sm font-bold rounded-xl hover:bg-red-600 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {triaging ? 'Creating Triage...' : 'No Packing Slip — Triage'}
          </button>
        </div>
        <button onClick={onReset} className="mt-3 text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
          ← Start over
        </button>
      </div>
    </div>
  )
}

// ============================================
// Step: PON Scan
// ============================================

function PonScanStep({ context, trackingNumber, onOrderFound, onBack, onReset }: {
  context: 'no_tracking' | 'reused_label'
  trackingNumber: string
  onOrderFound: (order: OrderWithIntake) => void
  onBack: () => void
  onReset: () => void
}) {
  const [ponInput, setPonInput] = useState('')
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const ponRef = useRef<HTMLInputElement>(null)

  useEffect(() => { ponRef.current?.focus() }, [])

  const handlePonScan = async () => {
    const query = ponInput.trim()
    if (!query) return
    setSearching(true)
    setError('')

    const res = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = await res.json()
      if (data.orders?.length > 0) {
        // Receive the order via PON
        await fetch('/api/admin/intake/receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: data.orders[0].id, receivedVia: 'pon_scan' }),
        })
        // Refresh and return
        const refreshRes = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(data.orders[0].id)}`)
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json()
          onOrderFound(refreshData.orders?.[0] || data.orders[0])
        } else {
          onOrderFound(data.orders[0])
        }
      } else {
        setError('No order found for this PON')
      }
    } else {
      setError('Failed to look up PON')
    }
    setSearching(false)
  }

  return (
    <div className="bg-white border-2 border-blue-200 rounded-xl overflow-hidden">
      <div className="p-5 bg-blue-50 border-b border-blue-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📋</span>
          <div>
            <h2 className="text-lg font-bold text-blue-800">Scan Packing Slip</h2>
            <p className="text-sm text-blue-600">
              Scan the QR code on the packing slip or type the order number
            </p>
          </div>
        </div>
      </div>
      <div className="p-5">
        <div className="relative max-w-lg mb-4">
          <input
            ref={ponRef}
            type="text"
            placeholder="Scan PON QR code or enter order ID..."
            value={ponInput}
            onChange={e => setPonInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handlePonScan() }}
            className="w-full px-4 py-3 rounded-lg bg-white border-2 border-blue-200 text-zinc-900 placeholder-zinc-400 font-mono focus:border-blue-500 focus:outline-none"
          />
          <button
            onClick={handlePonScan}
            disabled={searching}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 cursor-pointer"
          >
            {searching ? '...' : 'Look Up'}
          </button>
        </div>
        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
        <div className="flex gap-3">
          <button onClick={onBack} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
            ← Back
          </button>
          <button onClick={onReset} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
            Start over
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Step: Order Details (verify / flag items)
// ============================================

function OrderDetailsStep({ order, source, printerReady, onRefresh, onReset, showSuccess }: {
  order: OrderWithIntake
  source: string
  printerReady: boolean
  onRefresh: (orderId: string) => void
  onReset: () => void
  showSuccess: (msg: string) => void
}) {
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [flagModal, setFlagModal] = useState<{ item: OrderItem; orderId: string } | null>(null)
  const [addItemModal, setAddItemModal] = useState(false)

  const handleVerify = async (itemId: string) => {
    setActionLoading(itemId)
    const res = await fetch('/api/admin/intake/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderItemId: itemId }),
    })
    if (res.ok) {
      showSuccess('Item verified')
      onRefresh(order.id)
    }
    setActionLoading(null)
  }

  const handleVerifyAll = async () => {
    if (!order.items) return
    const pending = order.items.filter(i => i.intake_status === 'pending')
    setActionLoading('all')
    for (const item of pending) {
      await fetch('/api/admin/intake/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderItemId: item.id }),
      })
    }
    showSuccess(`${pending.length} items verified`)
    onRefresh(order.id)
    setActionLoading(null)
  }

  const handlePrintItemLabel = async (item: OrderItem) => {
    await printProductLabel(item.id, item.card_name, order.id.slice(0, 8).toUpperCase())
    showSuccess('Label printed')
  }

  const verifiedCount = order.items?.filter(i => i.intake_status === 'verified' || i.intake_status === 'resolved').length || 0
  const totalCount = order.items?.length || 0
  const allDone = totalCount > 0 && verifiedCount === totalCount
  const sellerName = (order.seller as { display_name?: string })?.display_name || 'Unknown'
  const buyerName = (order.buyer as { display_name?: string })?.display_name || 'Unknown'

  return (
    <>
      <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-zinc-100 bg-zinc-50">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-zinc-900">
                  Order #{order.id.slice(0, 8).toUpperCase()}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 text-zinc-600">{order.status}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-zinc-500">
                <span>Seller: {sellerName}</span>
                <span>&middot;</span>
                <span>Buyer: {buyerName}</span>
                <span>&middot;</span>
                <span>${Number(order.total).toFixed(2)}</span>
              </div>
              {order.seller_tracking_number && (
                <p className="text-xs text-zinc-400 mt-1">
                  Tracking: {order.seller_tracking_carrier && `${order.seller_tracking_carrier} — `}{order.seller_tracking_number}
                </p>
              )}
            </div>
            <button onClick={onReset} className="text-sm text-zinc-400 hover:text-orange-500 cursor-pointer">
              Next Package →
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="px-5 py-3 border-b border-zinc-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-zinc-700">
              Intake Progress: {verifiedCount}/{totalCount} items
            </span>
            {allDone && (
              <span className="text-xs font-semibold text-green-600 bg-green-50 px-2 py-1 rounded">All verified</span>
            )}
          </div>
          <div className="w-full bg-zinc-100 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${allDone ? 'bg-green-500' : 'bg-orange-500'}`}
              style={{ width: `${totalCount > 0 ? (verifiedCount / totalCount) * 100 : 0}%` }}
            />
          </div>
        </div>

        {/* Items — large card image grid */}
        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {order.items?.map((item, index) => {
            const imgUrl = cardImageUrl(item)
            const isPending = item.intake_status === 'pending'
            const isFlagged = item.intake_status === 'flagged'
            const isDone = item.intake_status === 'verified' || item.intake_status === 'resolved'

            return (
              <div
                key={item.id}
                className={`rounded-xl border-2 overflow-hidden transition-colors ${
                  isDone ? 'border-green-300 bg-green-50/30' :
                  isFlagged ? 'border-red-300 bg-red-50/30' :
                  'border-zinc-200 bg-white'
                }`}
              >
                {/* Large card image */}
                <div className="relative aspect-[63/88] bg-zinc-100">
                  {imgUrl ? (
                    <Image src={imgUrl} alt={item.card_name} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-6xl">🃏</div>
                  )}
                  {/* Overlays */}
                  <span className="absolute top-2 left-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center text-sm font-bold">{index + 1}</span>
                  <span className={`absolute top-2 right-2 text-xs px-2 py-1 rounded-full font-semibold ${INTAKE_STATUS_STYLES[item.intake_status] || 'bg-zinc-200 text-zinc-600'}`}>
                    {item.intake_status}
                  </span>
                  {item.quantity > 1 && (
                    <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full bg-orange-500 text-white text-xs font-bold">x{item.quantity}</span>
                  )}
                  {isDone && (
                    <div className="absolute inset-0 bg-green-500/10 flex items-center justify-center">
                      <span className="text-5xl">✅</span>
                    </div>
                  )}
                </div>

                {/* Card info */}
                <div className="p-3">
                  <p className="font-semibold text-zinc-900 text-sm leading-tight">{item.card_name}</p>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mt-1">
                    <span>${Number(item.unit_price).toFixed(2)}</span>
                    <span>&middot;</span>
                    <span>{item.condition === 'near_mint' ? 'NM' : item.condition}</span>
                    {item.card_id && item.card_id !== 'admin-added' && (
                      <><span>&middot;</span><span className="font-mono text-zinc-400">{item.card_id}</span></>
                    )}
                  </div>
                  {item.intake_notes && <p className="text-xs text-zinc-400 mt-1 italic">{item.intake_notes}</p>}

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3">
                    {isPending && (
                      <>
                        <button
                          onClick={() => handleVerify(item.id)}
                          disabled={actionLoading === item.id}
                          className="flex-1 py-2 bg-green-500 text-white text-sm font-bold rounded-lg hover:bg-green-600 disabled:opacity-50 cursor-pointer"
                        >
                          {actionLoading === item.id ? '...' : 'Verify'}
                        </button>
                        <button
                          onClick={() => setFlagModal({ item, orderId: order.id })}
                          className="flex-1 py-2 bg-red-500 text-white text-sm font-bold rounded-lg hover:bg-red-600 cursor-pointer"
                        >
                          Flag
                        </button>
                        <button
                          onClick={() => handlePrintItemLabel(item)}
                          className="py-2 px-3 bg-zinc-200 text-zinc-600 text-sm rounded-lg hover:bg-zinc-300 cursor-pointer"
                          title="Reprint label"
                        >
                          🏷️
                        </button>
                      </>
                    )}
                    {isFlagged && (
                      <button
                        onClick={() => setFlagModal({ item, orderId: order.id })}
                        className="flex-1 py-2 bg-red-100 text-red-700 text-sm font-semibold rounded-lg hover:bg-red-200 cursor-pointer"
                      >
                        View Issue
                      </button>
                    )}
                    {isDone && (
                      <button
                        onClick={() => handlePrintItemLabel(item)}
                        className="py-1.5 px-3 bg-zinc-100 text-zinc-400 text-xs rounded-lg hover:bg-zinc-200 cursor-pointer"
                        title="Reprint label"
                      >
                        🏷️ Reprint
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Actions Footer */}
        <div className="p-4 border-t border-zinc-100 bg-zinc-50 flex items-center gap-3">
          {order.items?.some(i => i.intake_status === 'pending') && (
            <button
              onClick={handleVerifyAll}
              disabled={actionLoading === 'all'}
              className="px-4 py-2 bg-green-500 text-white text-sm font-semibold rounded-lg hover:bg-green-600 disabled:opacity-50 cursor-pointer"
            >
              {actionLoading === 'all' ? 'Verifying...' : 'Verify All Items'}
            </button>
          )}
          <button
            onClick={() => setFlagModal({
              item: { id: '', order_id: order.id, card_name: '', listing_id: '', card_id: '', quantity: 0, unit_price: 0, condition: 'near_mint', snapshot_photo_url: null, intake_status: 'pending', intake_verified_at: null, intake_verified_by: null, intake_notes: null, created_at: '' },
              orderId: order.id,
            })}
            className="px-4 py-2 bg-red-100 text-red-700 text-sm font-semibold rounded-lg hover:bg-red-200 cursor-pointer"
          >
            Report Missing Item
          </button>
          <button
            onClick={() => setAddItemModal(true)}
            className="px-4 py-2 bg-blue-100 text-blue-700 text-sm font-semibold rounded-lg hover:bg-blue-200 cursor-pointer"
          >
            Add Item
          </button>
          <button onClick={onReset} className="ml-auto px-4 py-2 bg-orange-100 text-orange-700 text-sm font-semibold rounded-lg hover:bg-orange-200 cursor-pointer">
            Next Package →
          </button>
        </div>

        {/* Issues */}
        {order.intake_issues && order.intake_issues.length > 0 && (
          <div className="p-4 border-t border-zinc-100">
            <h3 className="text-sm font-semibold text-zinc-700 mb-3">Issues ({order.intake_issues.length})</h3>
            <div className="space-y-2">
              {order.intake_issues.map(issue => (
                <div key={issue.id} className="bg-red-50 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-red-700">{ISSUE_TYPE_LABELS[issue.issue_type]}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      issue.resolution_status === 'open' ? 'bg-red-100 text-red-600' :
                      issue.resolution_status === 'resolved' ? 'bg-green-100 text-green-600' :
                      'bg-yellow-100 text-yellow-600'
                    }`}>{issue.resolution_status}</span>
                  </div>
                  <p className="text-red-600 mt-1">{issue.description}</p>
                  {issue.expected_card_name && (
                    <p className="text-xs text-red-400 mt-1">
                      Expected: {issue.expected_card_name} | Received: {issue.received_card_name || '—'}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity Log */}
        {order.activity_log && order.activity_log.length > 0 && (
          <div className="p-4 border-t border-zinc-100">
            <h3 className="text-sm font-semibold text-zinc-700 mb-3">Activity Log</h3>
            <div className="space-y-1.5">
              {order.activity_log.slice(0, 10).map(log => (
                <div key={log.id} className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="font-medium text-zinc-600">{log.action.replace(/_/g, ' ')}</span>
                  {'card_name' in (log.details || {}) && <span className="text-zinc-400">— {String((log.details as Record<string, unknown>).card_name)}</span>}
                  <span className="text-zinc-300 ml-auto">{new Date(log.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Flag Modal */}
      {flagModal && (
        <FlagModal
          item={flagModal.item}
          orderId={flagModal.orderId}
          onClose={() => setFlagModal(null)}
          onSuccess={() => {
            setFlagModal(null)
            showSuccess('Issue flagged')
            onRefresh(order.id)
          }}
        />
      )}

      {/* Add Item Modal */}
      {addItemModal && (
        <AddItemModal
          orderId={order.id}
          onClose={() => setAddItemModal(false)}
          onSuccess={() => {
            setAddItemModal(false)
            showSuccess('Item added')
            onRefresh(order.id)
          }}
        />
      )}
    </>
  )
}

// ============================================
// Step: Triage Label Printed (confirmation + instructions)
// ============================================

function TriagePrintedStep({ triagePackage, trackingNumber, sellerName, onNextPackage }: {
  triagePackage: TriagePackage
  trackingNumber: string
  sellerName?: string
  onNextPackage: () => void
}) {
  const isUserIdType = triagePackage.triage_type === 'user_id'
  const triageId = triagePackage.id
  const shortId = triageId.slice(0, 8).toUpperCase()

  return (
    <div className="bg-white border-2 border-purple-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="p-5 bg-purple-50 border-b border-purple-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏷️</span>
          <div>
            <h2 className="text-lg font-bold text-purple-800">Triage Label Printed</h2>
            <p className="text-sm text-purple-600">
              {isUserIdType ? `Seller known: ${sellerName || 'Unknown'}` : 'No order found'}
            </p>
          </div>
        </div>
      </div>

      {/* Label preview */}
      <div className="p-6">
        <div className="bg-zinc-50 border-2 border-dashed border-zinc-300 rounded-xl p-6 mb-6">
          <div className="flex items-center gap-6">
            {/* QR placeholder */}
            <div className="w-24 h-24 bg-zinc-200 rounded-lg flex items-center justify-center flex-shrink-0">
              <div className="text-center">
                <span className="text-3xl">📱</span>
                <p className="text-[10px] text-zinc-500 mt-1">QR Code</p>
              </div>
            </div>
            {/* Label info */}
            <div className="flex-1">
              <p className="text-xs text-zinc-400 uppercase tracking-wide font-semibold">Triage Label</p>
              <p className="text-2xl font-bold font-mono text-zinc-900 mt-1">{shortId}</p>
              <div className="flex items-center gap-3 mt-2 text-sm">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                  isUserIdType ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'
                }`}>
                  {isUserIdType ? 'SELLER KNOWN' : 'NO ORDER'}
                </span>
              </div>
              <div className="mt-2 text-sm text-zinc-500 space-y-0.5">
                <p>Tracking: <span className="font-mono">{trackingNumber}</span></p>
                {isUserIdType && sellerName && <p>Seller: <span className="font-semibold text-zinc-700">{sellerName}</span></p>}
                <p>QR Data: <span className="font-mono text-xs">TRIAGE:{triageId.slice(0, 12)}...</span></p>
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <h3 className="font-bold text-amber-800 text-sm mb-3">What to do now:</h3>
          <ol className="space-y-2 text-sm text-amber-700">
            <li className="flex gap-2">
              <span className="font-bold text-amber-500 flex-shrink-0">1.</span>
              <span>Stick the printed triage label onto the package</span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-amber-500 flex-shrink-0">2.</span>
              <span>Place the package in the <strong>Triage pile</strong></span>
            </li>
            <li className="flex gap-2">
              <span className="font-bold text-amber-500 flex-shrink-0">3.</span>
              <span>When processing triage later, scan the QR code on this label to identify the card and match it to an order</span>
            </li>
          </ol>
        </div>

        {/* Summary of what happened */}
        <div className="bg-zinc-50 rounded-xl p-4 mb-6 text-sm text-zinc-600 space-y-1">
          <p><span className="text-zinc-400">Created:</span> Triage package <span className="font-mono font-semibold">{shortId}</span></p>
          <p><span className="text-zinc-400">Type:</span> {isUserIdType ? 'Seller known — can filter by seller when resolving' : 'No order — will need card identification to match'}</p>
          <p><span className="text-zinc-400">Printer:</span> Label sent to Zebra printer</p>
        </div>

        <button
          onClick={onNextPackage}
          className="w-full py-3 bg-orange-500 text-white text-sm font-bold rounded-xl hover:bg-orange-600 transition-colors cursor-pointer"
        >
          Next Package →
        </button>
      </div>
    </div>
  )
}

// ============================================
// Step: Triage Identify (raw vs slab)
// ============================================

function TriageIdentifyStep({ triagePackage, onSubmit, onReset }: {
  triagePackage: TriagePackage
  onSubmit: (cardType: 'raw' | 'slab', certNumber?: string, nomiInput?: string) => void
  onReset: () => void
}) {
  const [cardType, setCardType] = useState<'raw' | 'slab' | null>(null)
  const [certNumber, setCertNumber] = useState('')
  const [nomiInput, setNomiInput] = useState('')

  const sellerName = triagePackage.seller?.display_name || null

  return (
    <div className="bg-white border-2 border-purple-200 rounded-xl overflow-hidden">
      <div className="p-5 bg-purple-50 border-b border-purple-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔍</span>
          <div>
            <h2 className="text-lg font-bold text-purple-800">Triage — Identify Card</h2>
            <p className="text-sm text-purple-600">
              Package ID: {triagePackage.id.slice(0, 8)} •
              Type: {triagePackage.triage_type === 'user_id' ? `Seller Known (${sellerName})` : 'No Order'}
            </p>
          </div>
        </div>
      </div>
      <div className="p-5">
        {/* Card type selection */}
        {!cardType && (
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setCardType('raw')}
              className="py-8 bg-zinc-50 border-2 border-zinc-200 rounded-xl text-center hover:border-purple-400 hover:bg-purple-50 transition-colors cursor-pointer"
            >
              <span className="text-3xl block mb-2">🃏</span>
              <span className="font-bold text-zinc-700">Raw Card</span>
              <span className="text-xs text-zinc-400 block mt-1">Ungraded card</span>
            </button>
            <button
              onClick={() => setCardType('slab')}
              className="py-8 bg-zinc-50 border-2 border-zinc-200 rounded-xl text-center hover:border-purple-400 hover:bg-purple-50 transition-colors cursor-pointer"
            >
              <span className="text-3xl block mb-2">🏆</span>
              <span className="font-bold text-zinc-700">Slab</span>
              <span className="text-xs text-zinc-400 block mt-1">Graded / encased card</span>
            </button>
          </div>
        )}

        {/* Raw card input */}
        {cardType === 'raw' && (
          <div>
            <h3 className="text-sm font-semibold text-zinc-700 mb-3">Card Identification</h3>
            <p className="text-xs text-zinc-400 mb-3">Use the NOMI scanner or manually enter the card info</p>
            <input
              type="text"
              placeholder="Card name or ID (e.g. OP01-001 Roronoa Zoro)"
              value={nomiInput}
              onChange={e => setNomiInput(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 rounded-lg border-2 border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-purple-500 focus:outline-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => onSubmit('raw', undefined, nomiInput || undefined)}
                disabled={!nomiInput}
                className="px-5 py-2 bg-purple-500 text-white text-sm font-bold rounded-lg hover:bg-purple-600 disabled:opacity-50 cursor-pointer"
              >
                Search for Order
              </button>
              <button onClick={() => setCardType(null)} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
                ← Back to type selection
              </button>
            </div>
          </div>
        )}

        {/* Slab input */}
        {cardType === 'slab' && (
          <div>
            <h3 className="text-sm font-semibold text-zinc-700 mb-3">Enter Cert Number</h3>
            <input
              type="text"
              placeholder="Certification number (e.g. PSA 12345678)"
              value={certNumber}
              onChange={e => setCertNumber(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 rounded-lg border-2 border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-purple-500 focus:outline-none mb-4"
            />
            <div className="flex gap-3">
              <button
                onClick={() => onSubmit('slab', certNumber || undefined, undefined)}
                disabled={!certNumber}
                className="px-5 py-2 bg-purple-500 text-white text-sm font-bold rounded-lg hover:bg-purple-600 disabled:opacity-50 cursor-pointer"
              >
                Search for Order
              </button>
              <button onClick={() => setCardType(null)} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
                ← Back to type selection
              </button>
            </div>
          </div>
        )}

        <button onClick={onReset} className="mt-4 text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
          ← Start over
        </button>
      </div>
    </div>
  )
}

// ============================================
// Step: Triage Search for Order
// ============================================

function TriageSearchStep({ triagePackage, cardType, certNumber, nomiInput, printerReady, onResolved, onConsigned, onBack, onReset }: {
  triagePackage: TriagePackage
  cardType: 'raw' | 'slab'
  certNumber?: string
  nomiInput?: string
  printerReady: boolean
  onResolved: (orderId: string) => void
  onConsigned: () => void
  onBack: () => void
  onReset: () => void
}) {
  const [orderSearch, setOrderSearch] = useState('')
  const [searchResults, setSearchResults] = useState<OrderWithIntake[]>([])
  const [searched, setSearched] = useState(false)
  const [searching, setSearching] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = async () => {
    const query = orderSearch.trim()
    if (!query) return
    setSearching(true)
    setError('')

    const res = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(query)}`)
    if (res.ok) {
      const data = await res.json()
      setSearchResults(data.orders || [])
    } else {
      setError('Search failed')
    }
    setSearched(true)
    setSearching(false)
  }

  const handleReceiveUnder = async (orderId: string) => {
    setResolving(true)
    const res = await fetch('/api/admin/intake/triage/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triagePackageId: triagePackage.id,
        orderId,
        cardType,
        certNumber,
        nomiInput,
      }),
    })
    if (res.ok) {
      onResolved(orderId)
    } else {
      const data = await res.json()
      setError(data.error || 'Failed to resolve')
    }
    setResolving(false)
  }

  const handleConsign = async () => {
    setResolving(true)
    const res = await fetch('/api/admin/intake/triage/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triagePackageId: triagePackage.id,
        consignToHouse: true,
        cardType,
        certNumber,
        nomiInput,
      }),
    })
    if (res.ok) {
      onConsigned()
    } else {
      const data = await res.json()
      setError(data.error || 'Failed to consign')
    }
    setResolving(false)
  }

  const cardDisplay = cardType === 'slab' ? `Slab: ${certNumber}` : `Raw: ${nomiInput}`
  const sellerName = triagePackage.seller?.display_name

  return (
    <div className="bg-white border-2 border-purple-200 rounded-xl overflow-hidden">
      <div className="p-5 bg-purple-50 border-b border-purple-100">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔎</span>
          <div>
            <h2 className="text-lg font-bold text-purple-800">Triage — Find Order</h2>
            <p className="text-sm text-purple-600">
              {cardDisplay}
              {sellerName && ` • Seller: ${sellerName}`}
            </p>
          </div>
        </div>
      </div>
      <div className="p-5">
        <div className="relative max-w-lg mb-4">
          <input
            type="text"
            placeholder="Enter possible order number..."
            value={orderSearch}
            onChange={e => setOrderSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
            autoFocus
            className="w-full px-4 py-3 rounded-lg border-2 border-purple-200 text-zinc-900 placeholder-zinc-400 font-mono focus:border-purple-500 focus:outline-none"
          />
          <button
            onClick={handleSearch}
            disabled={searching}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 bg-purple-500 text-white rounded-lg text-sm font-semibold hover:bg-purple-600 disabled:opacity-50 cursor-pointer"
          >
            {searching ? '...' : 'Search'}
          </button>
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        {/* Search results */}
        {searched && searchResults.length > 0 && (
          <div className="space-y-2 mb-5">
            {searchResults.map(o => (
              <div key={o.id} className="bg-zinc-50 rounded-lg p-3 flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-mono font-bold text-zinc-700">#{o.id.slice(0, 8).toUpperCase()}</span>
                  <span className="ml-2 text-zinc-400">{(o.seller as { display_name?: string })?.display_name}</span>
                  <span className="ml-2 text-zinc-400">${Number(o.total).toFixed(2)}</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded bg-zinc-200 text-zinc-600`}>{o.status}</span>
                </div>
                <button
                  onClick={() => handleReceiveUnder(o.id)}
                  disabled={resolving}
                  className="px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 disabled:opacity-50 cursor-pointer"
                >
                  {resolving ? '...' : 'Receive Under This Order'}
                </button>
              </div>
            ))}
          </div>
        )}

        {searched && searchResults.length === 0 && (
          <div className="bg-zinc-50 rounded-lg p-6 text-center mb-5">
            <p className="text-sm text-zinc-500">No matching orders found</p>
          </div>
        )}

        <div className="flex gap-3 items-center">
          <button
            onClick={handleConsign}
            disabled={resolving}
            className="px-5 py-2 bg-zinc-700 text-white text-sm font-bold rounded-lg hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
          >
            {resolving ? 'Consigning...' : 'Consign to House Account'}
          </button>
          <button onClick={onBack} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
            ← Back
          </button>
          <button onClick={onReset} className="text-sm text-zinc-400 hover:text-zinc-600 cursor-pointer">
            Start over
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Modal: Flag Issue
// ============================================

function FlagModal({ item, orderId, onClose, onSuccess }: {
  item: OrderItem
  orderId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [issueType, setIssueType] = useState<IntakeIssueType>('wrong_card')
  const [description, setDescription] = useState('')
  const [expectedCard, setExpectedCard] = useState(item.card_name || '')
  const [receivedCard, setReceivedCard] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const isMissing = !item.id

  const handleSubmit = async () => {
    if (!description) { setError('Description is required'); return }
    setSubmitting(true)

    const body: Record<string, unknown> = {
      issueType: isMissing ? 'missing_item' : issueType,
      description,
      expectedCardName: expectedCard || undefined,
      receivedCardName: receivedCard || undefined,
    }
    if (isMissing) body.orderId = orderId
    else body.orderItemId = item.id

    const res = await fetch('/api/admin/intake/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.ok) onSuccess()
    else {
      const data = await res.json()
      setError(data.error || 'Failed to flag issue')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-zinc-900 mb-4">
          {isMissing ? 'Report Missing Item' : `Flag Issue — ${item.card_name}`}
        </h2>

        {!isMissing && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-zinc-700 mb-1">Issue Type</label>
            <select
              value={issueType}
              onChange={e => setIssueType(e.target.value as IntakeIssueType)}
              className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 text-sm"
            >
              {Object.entries(ISSUE_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Describe the issue..."
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 text-sm placeholder-zinc-400"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Expected Card</label>
            <input type="text" value={expectedCard} onChange={e => setExpectedCard(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Received Card</label>
            <input type="text" value={receivedCard} onChange={e => setReceivedCard(e.target.value)} placeholder="What was actually received" className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 text-sm placeholder-zinc-400" />
          </div>
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-5 py-2 bg-red-500 text-white text-sm font-semibold rounded-lg hover:bg-red-600 disabled:opacity-50 cursor-pointer">
            {submitting ? 'Submitting...' : 'Flag Issue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================
// Modal: Add Item
// ============================================

function AddItemModal({ orderId, onClose, onSuccess }: {
  orderId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [cardName, setCardName] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    if (!cardName) { setError('Card name is required'); return }
    setSubmitting(true)

    const res = await fetch('/api/admin/intake/add-item', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, cardName, quantity, notes }),
    })

    if (res.ok) onSuccess()
    else {
      const data = await res.json()
      setError(data.error || 'Failed to add item')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-zinc-900 mb-4">Add Item to Order</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Card Name</label>
          <input type="text" value={cardName} onChange={e => setCardName(e.target.value)} placeholder="Enter card name" className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 text-sm placeholder-zinc-400" />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Quantity</label>
          <input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} min={1} className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 text-sm" />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 mb-1">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Why is this item being added?" rows={2} className="w-full px-3 py-2 rounded-lg border border-zinc-300 text-zinc-900 text-sm placeholder-zinc-400" />
        </div>

        {error && <p className="text-red-500 text-sm mb-3">{error}</p>}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 cursor-pointer">Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-5 py-2 bg-blue-500 text-white text-sm font-semibold rounded-lg hover:bg-blue-600 disabled:opacity-50 cursor-pointer">
            {submitting ? 'Adding...' : 'Add Item'}
          </button>
        </div>
      </div>
    </div>
  )
}
