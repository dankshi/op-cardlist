'use client'

import { Suspense, useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { getPrinterStatus, printTriageLabel, printOrderQrLabels } from '@/lib/zebra'
import { CopyButton } from '@/components/admin/ui/CopyButton'
import type { Order, OrderItem, IntakeIssue, IntakeIssueType, TriagePackage, TrackingMatchType } from '@/types/database'

/** Intake status pill. "Received" (pending) and verified/resolved read as
 *  green + check so it's unmistakable the package is in hand; problems are
 *  red/rose. */
function IntakeStatusPill({ status }: { status: string }) {
  const received = status === 'pending'
  const ok = received || status === 'verified' || status === 'resolved'
  const label =
    received ? 'Received' :
    status === 'verified' ? 'Verified' :
    status === 'resolved' ? 'Resolved' :
    status === 'flagged' ? 'Flagged' :
    status === 'rejected' ? 'Rejected' : status
  const cls = ok ? 'bg-emerald-100 text-emerald-700' : status === 'flagged' ? 'bg-red-100 text-red-700' : 'bg-rose-100 text-rose-700'
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>
      {ok && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      )}
      {label}
    </span>
  )
}

/** Inline monospace ID + copy chip — used across the intake reference UI. */
function CopyableId({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <span className="font-mono text-xs text-zinc-700 truncate">{value}</span>
      <CopyButton value={value} />
    </span>
  )
}

// ============================================
// Constants
// ============================================

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
  courier_damage: 'Courier Damage',
  seller_packaging: 'Seller Packaging',
  internal_handling: 'Internal Handling',
  missing_item: 'Missing Item',
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

// A package the operator finished this session — pushed to the on-page
// history when they move on (implicit verify commit). Snapshots the
// per-item outcome so the list survives later edits / re-scans.
type VerifyHistoryEntry = {
  orderId: string
  shortId: string
  sellerName: string
  at: string
  items: { id: string; card_name: string; card_id: string; status: string }[]
  verifiedCount: number
  flaggedCount: number
}

// Session history is persisted to localStorage so it survives reloads on
// the warehouse machine. Cleared via the Clear button in the panel.
const INTAKE_HISTORY_KEY = 'nomi.intake.sessionHistory'

// ============================================
// Main Page
// ============================================

export default function IntakePage() {
  return (
    <Suspense fallback={
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
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
  // Ambient queue + today's-received counts in the header so the
  // operator sees "12 packages to receive · 8 received today" at a
  // glance without leaving the screen. Matches /admin/pack pattern.
  const [queueCount, setQueueCount] = useState<number | null>(null)
  const [receivedToday, setReceivedToday] = useState(0)
  const scanRef = useRef<HTMLInputElement>(null)
  const autoScannedRef = useRef(false)
  const didAuthCheck = useRef(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useMemo(() => createClient(), [])

  // Session history fills up under the workspace as packages are received.
  const [sessionHistory, setSessionHistory] = useState<VerifyHistoryEntry[]>([])
  // Guards the save effect from clobbering stored history before the load
  // runs. This is STATE, not a ref, on purpose: state updates are batched,
  // so the save effect on the initial commit still sees `false` and skips
  // — a ref set synchronously in the load effect would read `true` in the
  // same commit and persist the empty initial [] over the stored list
  // (StrictMode's double-mount in dev then re-reads the wiped value).
  const [historyReady, setHistoryReady] = useState(false)

  // Load persisted history once on mount (after first paint, so server and
  // client initial render match — avoids a hydration mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(INTAKE_HISTORY_KEY)
      if (raw) setSessionHistory(JSON.parse(raw))
    } catch { /* ignore corrupt/oversized cache */ }
    setHistoryReady(true)
  }, [])

  // Persist on every change (capped so it can't grow unbounded). Waits for
  // the load to finish so it never overwrites the stored list with [].
  useEffect(() => {
    if (!historyReady) return
    try {
      localStorage.setItem(INTAKE_HISTORY_KEY, JSON.stringify(sessionHistory.slice(0, 200)))
    } catch { /* ignore quota errors */ }
  }, [sessionHistory, historyReady])

  const clearHistory = useCallback(() => setSessionHistory([]), [])

  // Record (or update) a package in the session history. Called when an
  // order is received (items already verified) and again after any flag /
  // refresh, so the row always reflects the order's current item states.
  const upsertHistory = useCallback((order: OrderWithIntake) => {
    const items = (order.items || []).map(i => ({
      id: i.id, card_name: i.card_name, card_id: i.card_id, status: i.intake_status,
    }))
    const snapshot = {
      orderId: order.id,
      shortId: order.id.slice(0, 8).toUpperCase(),
      sellerName: (order.seller as { display_name?: string })?.display_name || 'Unknown',
      items,
      verifiedCount: items.filter(i => i.status === 'verified' || i.status === 'resolved').length,
      flaggedCount: items.filter(i => i.status === 'flagged').length,
    }
    setSessionHistory(h => {
      const idx = h.findIndex(e => e.orderId === order.id)
      if (idx >= 0) {
        const copy = [...h]
        copy[idx] = { ...snapshot, at: h[idx].at } // keep original receive time
        return copy
      }
      return [{ ...snapshot, at: new Date().toISOString() }, ...h]
    })
  }, [])

  // Auth check
  useEffect(() => {
    if (didAuthCheck.current) return
    didAuthCheck.current = true
    async function checkAuth() {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.push('/auth/sign-in'); return }
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('id', user.id)
          .single()
        if (!profile?.is_admin) { router.push('/'); return }
        scanRef.current?.focus()

        // Counts for the header. Best-effort — failure here just
        // leaves the counts blank, doesn't block intake.
        const startOfDay = new Date()
        startOfDay.setHours(0, 0, 0, 0)
        const [{ count: queue }, { count: received }] = await Promise.all([
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'seller_shipped'),
          supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .gte('received_at', startOfDay.toISOString()),
        ])
        setQueueCount(queue ?? 0)
        setReceivedToday(received ?? 0)
      } catch (err) {
        console.error('[intake] auth check failed', err)
        setError(err instanceof Error ? err.message : 'Failed to load intake')
      } finally {
        setLoading(false)
      }
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
      // 1. Triage code: 'T-XXXXXXXX' (current label payload) or the
      //    legacy 'TRIAGE:<uuid>' QR. Resolve by triage_code or id.
      const triageCodeRe = /^T-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/i
      if (triageCodeRe.test(raw) || raw.startsWith('TRIAGE:')) {
        const param = raw.startsWith('TRIAGE:')
          ? `id=${encodeURIComponent(raw.replace('TRIAGE:', ''))}`
          : `code=${encodeURIComponent(raw.toUpperCase())}`
        const res = await fetch(`/api/admin/intake/triage?${param}`)
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

      // 2. UUID format (36 chars with dashes): treat as PON / order ID scan.
      // The fallback catches a typed/scanned order-ID *prefix* (hex chars),
      // but it MUST contain a hex letter (a–f) or a dash. Digits 0–9 are
      // also valid hex, so a purely-numeric string is a carrier tracking
      // number (USPS/FedEx are all digits), NOT an order ID — those fall
      // through to the tracking lookup below. Without the /[a-f-]/ guard a
      // 22-digit USPS tracking matched here and 404'd as "Order not found".
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const looksLikeOrderId = raw.length >= 8 && raw.length <= 36 && /^[0-9a-f-]+$/i.test(raw) && /[a-f-]/i.test(raw)
      if (uuidRegex.test(raw) || looksLikeOrderId) {
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

  // Deep-link: if /admin/intake?orderId=XXX, auto-jump to that order's details.
  // Mirrors what handleScan does for a UUID scan (the "Verify Items First"
  // button on /admin links here).
  useEffect(() => {
    if (loading || autoScannedRef.current) return
    const orderId = searchParams.get('orderId')
    if (!orderId) return
    autoScannedRef.current = true
    handleScan(orderId)
  }, [loading, searchParams, handleScan])

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div>
      {/* Header — matches /admin/pack pattern: title left, ambient
          stats + printer status + tools right. Queue counter gives
          the operator a "how much is on me right now" without leaving
          the screen. */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Intake</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Scan an inbound tracking number or product QR to begin.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <PrinterStatusBadge status={printerStatus} />
          <div className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-700">
            <span className="font-bold tabular-nums">{queueCount ?? '—'}</span>{' '}
            <span className="text-zinc-500">awaiting intake</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700">
            <span className="font-bold tabular-nums">{receivedToday}</span>{' '}
            <span className="text-purple-600">received today</span>
          </div>
          <Link
            href="/admin/intake/issues"
            className="px-3 py-1.5 rounded-lg ring-1 ring-zinc-200 text-zinc-700 text-sm font-medium hover:bg-zinc-50 transition-colors"
          >
            View Issues
          </Link>
        </div>
      </div>

      {/* Always-visible scan input */}
      <div className="mb-6 max-w-2xl">
        <label className="block text-xs uppercase tracking-wide text-zinc-500 font-semibold mb-2">
          {currentStep.step === 'scan' ? 'Scan Tracking / PON / QR' : 'Scan Next'}
        </label>
        <div className="relative">
          <input
            ref={scanRef}
            type="text"
            placeholder={currentStep.step === 'scan'
              ? 'Scanner will type here. Or paste a tracking number / order ID.'
              : 'Scan next tracking, PON, or triage QR…'
            }
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleScan() }}
            autoFocus
            className="w-full px-5 py-4 rounded-xl bg-white border-2 border-zinc-200 text-zinc-900 placeholder-zinc-400 text-lg font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors"
          />
          <button
            onClick={() => handleScan()}
            disabled={scanLoading}
            className="absolute right-3 top-1/2 -translate-y-1/2 px-4 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {scanLoading ? 'Searching…' : 'Look Up'}
          </button>
        </div>
        {error && <p className="text-red-600 text-sm mt-2">{error}</p>}
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
            // Items were verified during receive; record the package in the
            // session history now (no success toast — the order card shows
            // its own green "received & verified" notification).
            upsertHistory(order)
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
          onAlreadyReceived={async (order) => {
            // PON points to an order that was already received — likely a
            // duplicate slip from a previous shipment. Drop into user_id
            // triage so an operator can sort it out instead of double-receiving.
            const trackingNumber = currentStep.step === 'pon_scan' ? currentStep.trackingNumber : ''
            const sellerName = currentStep.step === 'pon_scan' ? currentStep.sellerName : undefined
            const sellerId =
              (currentStep.step === 'pon_scan' && currentStep.sellerId) ||
              (order as { seller_id?: string }).seller_id ||
              undefined
            const res = await fetch('/api/admin/intake/triage', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                triageType: 'user_id',
                trackingNumber,
                sellerId,
                notes: `PON already used — order ${order.id.slice(0, 8)} was previously received`,
              }),
            })
            if (res.ok) {
              const { triagePackage } = await res.json()
              await printTriageLabel('triage_user_id', triagePackage.id, {
                sellerName,
                trackingNumber,
              })
              setCurrentStep({
                step: 'triage_printed',
                triagePackage,
                trackingNumber,
                sellerName,
              })
            } else {
              setError('Failed to create triage record')
            }
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
                // Keep the session-history row in sync (e.g. after a flag).
                upsertHistory(data.orders[0])
                setCurrentStep({ step: 'order_details', order: data.orders[0], source: currentStep.source })
              }
            }
          }}
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

      {/* Session history — fills up as packages are received */}
      <SessionHistory entries={sessionHistory} onClear={clearHistory} />

      {/* Success messages float as a fixed toast so they never push the
          page layout around (the old inline message made it jump). */}
      {successMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium shadow-lg">
          {successMessage}
        </div>
      )}
    </div>
  )
}

// ============================================
// Printer Status Badge
// ============================================

function PrinterStatusBadge({ status }: { status: string }) {
  // Non-ready states are amber, not red — labels still print via the
  // PDF/HTML fallback on any printer (ZSB DP12, AirPrint, inkjet), so
  // "no Zebra" isn't a blocker. Phrasing it "PDF mode" keeps a DP12
  // operator from thinking they're stuck.
  const styles: Record<string, string> = {
    ready: 'bg-green-100 text-green-700',
    offline: 'bg-amber-100 text-amber-700',
    error: 'bg-amber-100 text-amber-700',
    checking: 'bg-zinc-100 text-zinc-500',
  }
  const labels: Record<string, string> = {
    ready: 'Zebra Ready',
    offline: 'PDF Mode',
    error: 'PDF Mode',
    checking: 'Checking...',
  }
  const titles: Record<string, string> = {
    ready: 'Zebra detected — labels print directly via BrowserPrint',
    offline: 'No Zebra detected — labels open as a printable PDF for any printer',
    error: 'No Zebra detected — labels open as a printable PDF for any printer',
    checking: 'Checking for a Zebra printer…',
  }
  return (
    <span
      className={`text-xs px-3 py-1.5 rounded-full font-medium ${styles[status] || styles.offline}`}
      title={titles[status] || ''}
    >
      {labels[status] || 'Unknown'}
    </span>
  )
}

// ============================================
// Session History (fills up under the workspace)
// ============================================

function SessionHistory({ entries, onClear }: { entries: VerifyHistoryEntry[]; onClear: () => void }) {
  if (entries.length === 0) return null
  const totalVerified = entries.reduce((s, e) => s + e.verifiedCount, 0)
  const totalFlagged = entries.reduce((s, e) => s + e.flaggedCount, 0)
  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-zinc-700">This session</h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-zinc-400">
            {entries.length} package{entries.length === 1 ? '' : 's'} · {totalVerified} verified
            {totalFlagged > 0 && <span className="text-red-500"> · {totalFlagged} flagged</span>}
          </span>
          <button
            onClick={() => { if (confirm('Clear this session’s history? This only clears the on-screen list.')) onClear() }}
            className="text-xs text-zinc-400 hover:text-zinc-700 cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="bg-white border border-zinc-200 rounded-xl divide-y divide-zinc-100 overflow-hidden">
        {entries.map((e, idx) => (
          <Link
            key={`${e.orderId}-${idx}`}
            href={`/admin/orders/${e.orderId}`}
            className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors group"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-medium text-zinc-900 group-hover:text-indigo-600 transition-colors">#{e.shortId}</span>
                <span className="text-xs text-zinc-400">{e.sellerName}</span>
                {e.verifiedCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">{e.verifiedCount} verified</span>
                )}
                {e.flaggedCount > 0 && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 font-medium">{e.flaggedCount} flagged</span>
                )}
              </div>
              <p className="text-xs text-zinc-500 truncate mt-0.5">{e.items.map(i => i.card_name).join(', ')}</p>
            </div>
            <span className="text-xs text-zinc-400 flex-shrink-0">
              {new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <svg className="w-4 h-4 text-zinc-300 group-hover:text-zinc-500 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        ))}
      </div>
    </div>
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
  const alreadyReceived = order.status === 'received'
  const [receiving, setReceiving] = useState(!alreadyReceived)
  // Auto-fire guard: effects double-invoke under React Strict Mode and we
  // must only receive + print once per scanned order.
  const autoFiredRef = useRef(false)

  const handleReceiveAndPrint = useCallback(async () => {
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

    // 2. Verify all items right now. Intake verifies on receipt and only
    //    flags exceptions — intake isn't the authenticity gate (that's
    //    /admin/authenticate), so there's no reason to defer it. This is
    //    what makes the flow "scan → done": no separate verify step, and
    //    the last package of a session can't get stranded as pending.
    try {
      await fetch('/api/admin/intake/verify-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      })
    } catch { /* best-effort; flag flow still works */ }

    // 3. Print product QR labels for each item. Printer-agnostic:
    //    ZPL fast path for the team's Zebra ZD printers, HTML
    //    fallback for ZSB DP12 / AirPrint / any other printer.
    if (order.items && order.items.length > 0) {
      await printOrderQrLabels(
        order.id,
        order.items.map(i => ({ id: i.id, card_name: i.card_name, card_id: i.card_id })),
      )
    }

    // 4. Refresh order data (now shows items verified) and move on
    const refreshRes = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(order.id)}`)
    if (refreshRes.ok) {
      const data = await refreshRes.json()
      onReceived(data.orders?.[0] || order)
    } else {
      onReceived(order)
    }
    setReceiving(false)
  }, [order, onReceived])

  // Auto-receive + auto-print the moment the order is found — saves the
  // operator a click. The label print popup (HTML fallback path) may be
  // blocked by the browser when fired outside a direct click; allow popups
  // for this site on the warehouse machine, or use the Zebra ZPL path
  // (no popup). Already-received orders skip straight to verification.
  useEffect(() => {
    if (autoFiredRef.current) return
    autoFiredRef.current = true
    if (alreadyReceived) return
    handleReceiveAndPrint()
  }, [alreadyReceived, handleReceiveAndPrint])

  const sellerName = (order.seller as { display_name?: string })?.display_name || 'Unknown'
  const buyerName = (order.buyer as { display_name?: string })?.display_name || 'Unknown'

  return (
    <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
      <div className="p-3 border-b border-zinc-100">
        <div className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${receiving ? 'bg-indigo-50' : 'bg-emerald-50'}`}>
          {receiving ? (
            <span className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          ) : (
            <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${receiving ? 'text-indigo-800' : 'text-emerald-800'}`}>
              {receiving ? 'Receiving & verifying — printing labels…' : alreadyReceived ? 'Already received' : 'Package received & verified — labels printed'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Tracking <span className="font-mono">{trackingNumber}</span> → Order
              <span className="font-mono ml-1">#{order.id.slice(0, 8).toUpperCase()}</span>
            </p>
          </div>
          {!printerReady && !receiving && (
            <span className="text-xs text-amber-600 flex-shrink-0">PDF mode</span>
          )}
        </div>
      </div>

      <div className="p-5">
        {/* Order reference */}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 mb-5">
          <RefField label="Order ID" mono copy={order.id}>{order.id}</RefField>
          <RefField label="Seller">{sellerName}</RefField>
          <RefField label="Buyer">{buyerName}</RefField>
          <RefField label="Total">${Number(order.total).toFixed(2)}</RefField>
        </dl>

        {/* Items with images + reference IDs */}
        {order.items && order.items.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {order.items.map((item, i) => {
              const imgUrl = cardImageUrl(item)
              return (
                <div key={item.id} className="flex gap-3 rounded-lg border border-zinc-200 p-3">
                  <div className="relative w-16 aspect-[63/88] bg-zinc-100 rounded flex-shrink-0 overflow-hidden">
                    {imgUrl ? (
                      <Image src={imgUrl} alt={item.card_name} fill className="object-cover" unoptimized />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-2xl">🃏</div>
                    )}
                    <span className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-semibold text-zinc-900 text-sm leading-tight truncate">{item.card_name}</p>
                    <p className="text-zinc-500 mt-0.5">
                      ${Number(item.unit_price).toFixed(2)} · {item.condition === 'near_mint' ? 'NM' : item.condition}
                      {item.quantity > 1 && <span className="ml-1 text-indigo-600 font-semibold">×{item.quantity}</span>}
                    </p>
                    <div className="mt-1.5 space-y-0.5">
                      <RefId label="Product" value={item.card_id} />
                      <RefId label="Item ID" value={item.id} />
                      <RefId label="Listing" value={item.listing_id} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {alreadyReceived && (
          <button
            onClick={() => onSkipToDetails(order)}
            className="mt-5 w-full py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors cursor-pointer"
          >
            Continue to Item Verification →
          </button>
        )}
      </div>
    </div>
  )
}

/** Compact label/value cell for the intake reference grid. */
function RefField({ label, children, mono, copy }: { label: string; children: React.ReactNode; mono?: boolean; copy?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-zinc-400 font-medium">{label}</dt>
      <dd className={`mt-0.5 text-sm text-zinc-800 truncate ${mono ? 'font-mono text-xs' : ''}`}>
        {copy ? <CopyableId value={copy} /> : children}
      </dd>
    </div>
  )
}

/** One "label: id [copy]" row inside an item card. */
function RefId({ label, value }: { label: string; value: string | null }) {
  if (!value || value === 'admin-added') {
    return (
      <div className="flex items-center gap-1.5 text-zinc-400">
        <span className="w-12 flex-shrink-0 text-[10px] uppercase tracking-wide">{label}</span>
        <span>—</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-12 flex-shrink-0 text-[10px] uppercase tracking-wide text-zinc-400">{label}</span>
      <CopyableId value={value} />
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

function PonScanStep({ context, trackingNumber, onOrderFound, onAlreadyReceived, onBack, onReset }: {
  context: 'no_tracking' | 'reused_label'
  trackingNumber: string
  onOrderFound: (order: OrderWithIntake) => void
  onAlreadyReceived: (order: OrderWithIntake) => void
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
        const order = data.orders[0]
        // Receive the order via PON
        const receiveRes = await fetch('/api/admin/intake/receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, receivedVia: 'pon_scan' }),
        })
        const receiveData = receiveRes.ok ? await receiveRes.json() : null
        // Scenario 3c / 5c: PON already used (order already received). Route
        // to user_id triage instead of silently re-receiving — the package
        // in our hand is suspect (likely seller printed a duplicate slip).
        if (receiveData?.already_received) {
          onAlreadyReceived(order)
          setSearching(false)
          return
        }
        // Refresh and return
        const refreshRes = await fetch(`/api/admin/intake/scan?orderId=${encodeURIComponent(order.id)}`)
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json()
          onOrderFound(refreshData.orders?.[0] || order)
        } else {
          onOrderFound(order)
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

function OrderDetailsStep({ order, source, printerReady, onRefresh, showSuccess }: {
  order: OrderWithIntake
  source: string
  printerReady: boolean
  onRefresh: (orderId: string) => void
  showSuccess: (msg: string) => void
}) {
  const [flagModal, setFlagModal] = useState<{ item: OrderItem; orderId: string } | null>(null)

  // No explicit "Verify" — items are verified on receipt (see
  // handleReceiveAndPrint). Operators only flag exceptions here.
  const handlePrintItemLabel = async (item: OrderItem) => {
    const { method } = await printOrderQrLabels(
      order.id,
      [{ id: item.id, card_name: item.card_name, card_id: item.card_id }],
    )
    showSuccess(method === 'zpl' ? 'Label printed' : 'Label opened for printing')
  }

  const totalCount = order.items?.length || 0
  const flaggedCount = order.items?.filter(i => i.intake_status === 'flagged').length || 0
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
                {order.status === 'received' ? (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-700">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Received
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded bg-zinc-200 text-zinc-600">{order.status}</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-zinc-500">
                <span>Seller: {sellerName}</span>
                <span>&middot;</span>
                <span>Buyer: {buyerName}</span>
                <span>&middot;</span>
                <span>${Number(order.total).toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-zinc-400">
                <span className="uppercase tracking-wide">Order ID</span>
                <CopyableId value={order.id} />
              </div>
              {order.seller_tracking_number && (
                <p className="text-xs text-zinc-400 mt-1">
                  Tracking: {order.seller_tracking_carrier && `${order.seller_tracking_carrier} — `}{order.seller_tracking_number}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Verify-by-exception hint */}
        <div className="px-5 py-2.5 border-b border-zinc-100 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-zinc-600">
            {totalCount} item{totalCount === 1 ? '' : 's'}
            {flaggedCount > 0 && <span className="text-red-500"> · {flaggedCount} flagged</span>}
          </span>
          <span className="text-xs text-zinc-400">Verified on receipt — flag any problems below.</span>
        </div>

        {/* Items — line view */}
        <div className="divide-y divide-zinc-100">
          {order.items?.map((item, index) => {
            const imgUrl = cardImageUrl(item)
            const isFlagged = item.intake_status === 'flagged'
            const isDone = item.intake_status === 'verified' || item.intake_status === 'resolved'

            return (
              <div
                key={item.id}
                className={`flex items-center gap-3 px-4 py-3 ${isFlagged ? 'bg-red-50/40' : isDone ? 'bg-emerald-50/30' : ''}`}
              >
                <span className="text-xs text-zinc-300 w-4 text-right flex-shrink-0 tabular-nums">{index + 1}</span>
                <div className="relative w-16 h-[5.5rem] bg-zinc-100 rounded overflow-hidden flex-shrink-0">
                  {imgUrl ? (
                    <Image src={imgUrl} alt={item.card_name} fill className="object-cover" unoptimized />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-zinc-300 text-xl">🃏</div>
                  )}
                  {item.quantity > 1 && (
                    <span className="absolute bottom-0.5 left-0.5 px-1 rounded bg-indigo-600 text-white text-[10px] font-bold">×{item.quantity}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium text-zinc-900 text-sm leading-tight truncate">{item.card_name}</p>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 mt-0.5 flex-wrap">
                    <span>${Number(item.unit_price).toFixed(2)}</span>
                    <span className="text-zinc-300">·</span>
                    <span>{item.condition === 'near_mint' ? 'NM' : item.condition}</span>
                    {item.card_id && item.card_id !== 'admin-added' && (
                      <>
                        <span className="text-zinc-300">·</span>
                        <span className="font-mono text-zinc-400">{item.card_id}</span>
                      </>
                    )}
                  </div>
                  {/* Lead identifier: the human-readable product_id short
                      code (the QR label still encodes the Item UUID). */}
                  <div className="flex items-center gap-x-4 gap-y-0.5 mt-1 flex-wrap text-xs">
                    <RefId label="ID" value={item.product_id} />
                  </div>
                  {item.intake_notes && <p className="text-xs text-zinc-400 mt-1 italic">{item.intake_notes}</p>}
                  {item.is_damaged && (
                    <div className="mt-1.5 inline-flex items-start gap-1.5 px-2 py-1 rounded-md bg-amber-50 border border-amber-200">
                      <span className="text-amber-600 text-xs font-bold leading-tight flex-shrink-0">⚠ DAMAGED</span>
                      {item.damage_notes && <span className="text-xs text-amber-700 leading-tight">— {item.damage_notes}</span>}
                    </div>
                  )}
                </div>

                <div className="flex-shrink-0">
                  <IntakeStatusPill status={item.intake_status} />
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isFlagged ? (
                    <button
                      onClick={() => setFlagModal({ item, orderId: order.id })}
                      className="py-1.5 px-3 bg-red-100 text-red-700 text-xs font-semibold rounded-lg hover:bg-red-200 cursor-pointer"
                    >
                      View Issue
                    </button>
                  ) : (
                    <button
                      onClick={() => setFlagModal({ item, orderId: order.id })}
                      className="py-1.5 px-3 bg-white border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 cursor-pointer"
                    >
                      Flag
                    </button>
                  )}
                  <button
                    onClick={() => handlePrintItemLabel(item)}
                    className="py-1.5 px-3 bg-zinc-100 text-zinc-600 text-xs font-semibold rounded-lg hover:bg-zinc-200 cursor-pointer"
                    title="Reprint label"
                  >
                    Print Label
                  </button>
                </div>
              </div>
            )
          })}
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
  const shortId = triagePackage.triage_code

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
                <p>QR Data: <span className="font-mono text-xs">{triagePackage.triage_code}</span></p>
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

function FlagModal({ item, onClose, onSuccess }: {
  item: OrderItem
  orderId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const [issueType, setIssueType] = useState<IntakeIssueType>('courier_damage')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setSubmitting(true)
    setError('')

    const res = await fetch('/api/admin/intake/flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderItemId: item.id,
        issueType,
        // No free-form description in the UI anymore; store the bucket label
        // so the DB's NOT NULL description + the issues list stay populated.
        description: ISSUE_TYPE_LABELS[issueType],
      }),
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
      <div className="bg-white rounded-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-zinc-900 mb-4">
          Flag Issue — {item.card_name}
        </h2>

        <div className="mb-4">
          <label className="block text-sm font-medium text-zinc-700 mb-2">Issue Type</label>
          <div className="grid grid-cols-1 gap-2">
            {(Object.entries(ISSUE_TYPE_LABELS) as [IntakeIssueType, string][]).map(([value, label]) => {
              const checked = issueType === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setIssueType(value)}
                  className={`px-4 py-2.5 rounded-lg text-sm font-semibold text-left transition-colors ${
                    checked
                      ? 'bg-zinc-900 text-white'
                      : 'bg-white text-zinc-700 ring-1 ring-zinc-200 hover:ring-zinc-400'
                  }`}
                >
                  {label}
                </button>
              )
            })}
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
