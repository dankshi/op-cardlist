import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// ─────────────────────────────────────────────────────────────────
// Admin dashboard — ops cockpit.
//
// Renders queue counts across every fulfillment flow (intake → auth →
// pack → exception review → risk review), today's productivity, and
// a recent activity feed. Every count tile is a CTA into the right
// surface — admins should never have to navigate by hand to find the
// next thing that needs attention.
//
// Server component: auth check via the server supabase client, all
// counts in parallel via head-only count queries.
// ─────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic'

interface QueueTileProps {
  label: string
  count: number
  href: string
  cta: string
  tone: 'orange' | 'purple' | 'blue' | 'amber' | 'red' | 'emerald'
  hint?: string
}

const TONE_CLASSES: Record<QueueTileProps['tone'], { bg: string; ring: string; count: string; cta: string }> = {
  orange:  { bg: 'bg-orange-50',  ring: 'ring-orange-200',  count: 'text-orange-600',  cta: 'text-orange-700 hover:text-orange-800' },
  purple:  { bg: 'bg-purple-50',  ring: 'ring-purple-200',  count: 'text-purple-700',  cta: 'text-purple-800 hover:text-purple-900' },
  blue:    { bg: 'bg-blue-50',    ring: 'ring-blue-200',    count: 'text-blue-700',    cta: 'text-blue-800 hover:text-blue-900' },
  amber:   { bg: 'bg-amber-50',   ring: 'ring-amber-200',   count: 'text-amber-700',   cta: 'text-amber-800 hover:text-amber-900' },
  red:     { bg: 'bg-red-50',     ring: 'ring-red-200',     count: 'text-red-700',     cta: 'text-red-800 hover:text-red-900' },
  emerald: { bg: 'bg-emerald-50', ring: 'ring-emerald-200', count: 'text-emerald-700', cta: 'text-emerald-800 hover:text-emerald-900' },
}

export default async function AdminDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect('/auth/sign-in?next=/admin')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin, display_name')
    .eq('id', user.id)
    .single()
  if (!profile?.is_admin) {
    redirect('/')
  }

  // ── Time anchors for "today" / "last 7 days" stats.
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  // ── Fan out every count + the activity feed in parallel.
  // Head-only counts so we don't pull row data we don't render.
  const [
    intakeQ,
    authQ,
    packQ,
    exceptionQ,
    riskQ,
    packedToday,
    authdToday,
    receivedToday,
    packedWeek,
    activityRes,
    exceptionListRes,
  ] = await Promise.all([
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'seller_shipped'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'received'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'authenticated'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'exception_review'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'under_review'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('shipped_to_buyer_at', startOfDay.toISOString()),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('authenticated_at', startOfDay.toISOString()),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('received_at', startOfDay.toISOString()),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .gte('shipped_to_buyer_at', since7d.toISOString()),
    supabase
      .from('intake_activity_log')
      .select('id, action, created_at, order_id, performer:profiles!intake_activity_log_performed_by_fkey(display_name)')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('orders')
      .select('id, created_at, items:order_items(card_name, exception_types)')
      .eq('status', 'exception_review')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const queues = {
    intake: intakeQ.count ?? 0,
    auth: authQ.count ?? 0,
    pack: packQ.count ?? 0,
    exception: exceptionQ.count ?? 0,
    risk: riskQ.count ?? 0,
  }
  const todays = {
    packed: packedToday.count ?? 0,
    authd: authdToday.count ?? 0,
    received: receivedToday.count ?? 0,
  }
  const totalQueue = queues.intake + queues.auth + queues.pack + queues.exception + queues.risk
  // 7-day average for the today-vs-pace context line.
  const packedWeekAvg = (packedWeek.count ?? 0) / 7

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900">
          Hi, {profile.display_name?.split(' ')[0] || 'admin'}.
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {totalQueue === 0 ? (
            <>Nothing in any queue. Inbox zero. ✨</>
          ) : (
            <>
              <span className="font-semibold text-zinc-700">{totalQueue}</span> order{totalQueue === 1 ? '' : 's'} waiting on you across the fulfillment flow.
            </>
          )}
        </p>
      </div>

      {/* ── Queues — things that need action ──────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-3">
          Queues
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <QueueTile
            label="Intake"
            count={queues.intake}
            href="/admin/intake"
            cta="Receive packages →"
            tone="blue"
            hint="seller shipments inbound"
          />
          <QueueTile
            label="Authentication"
            count={queues.auth}
            href="/admin/orders"
            cta="Authenticate items →"
            tone="purple"
            hint="received, awaiting decision"
          />
          <QueueTile
            label="Pack"
            count={queues.pack}
            href="/admin/pack"
            cta="Scan + ship →"
            tone="orange"
            hint="authenticated, ready to ship"
          />
          <QueueTile
            label="Exception Review"
            count={queues.exception}
            href="/admin/orders"
            cta="Resolve exceptions →"
            tone="amber"
            hint="flagged at authentication"
          />
          <QueueTile
            label="Risk Review"
            count={queues.risk}
            href="/admin/risk"
            cta="Review flagged orders →"
            tone="red"
            hint="fraud / radar"
          />
        </div>
      </section>

      {/* ── Today — productivity ──────────────────────────────── */}
      <section className="mb-8">
        <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-3">
          Today
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <StatTile
            label="Packed today"
            value={todays.packed}
            sub={packedWeekAvg > 0 ? `7-day avg ${packedWeekAvg.toFixed(1)}/day` : 'No history yet'}
          />
          <StatTile label="Authenticated today" value={todays.authd} />
          <StatTile label="Received today" value={todays.received} />
        </div>
      </section>

      {/* ── Exception review — quick triage list ──────────────── */}
      {exceptionListRes.data && exceptionListRes.data.length > 0 && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold">
              Exception Review — needs attention
            </h2>
            <Link
              href="/admin/orders"
              className="text-xs text-orange-500 hover:text-orange-600 font-medium"
            >
              View all in Orders →
            </Link>
          </div>
          <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
            {(exceptionListRes.data as Array<{
              id: string
              created_at: string
              items: Array<{ card_name: string | null; exception_types: string[] | null }> | null
            }>).map((order, i, arr) => {
              const exTypes = new Set<string>()
              for (const item of order.items || []) {
                for (const t of item.exception_types || []) exTypes.add(t)
              }
              return (
                <Link
                  key={order.id}
                  href={`/admin/authenticate/${order.id}`}
                  className={`flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors ${
                    i < arr.length - 1 ? 'border-b border-zinc-100' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm text-zinc-900">#{order.id.slice(0, 8)}</p>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {(order.items || []).map(i => i.card_name).filter(Boolean).join(' · ') || 'No items'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {[...exTypes].map(t => (
                      <span
                        key={t}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800"
                      >
                        {t.replace('_', ' ')}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs text-zinc-400 flex-shrink-0">{timeAgo(order.created_at)}</span>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Activity feed ─────────────────────────────────────── */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-zinc-400 font-semibold mb-3">
          Recent Activity
        </h2>
        <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden">
          {activityRes.data && activityRes.data.length > 0 ? (
            (activityRes.data as Array<{
              id: string
              action: string
              created_at: string
              order_id: string
              performer: { display_name: string | null } | { display_name: string | null }[] | null
            }>).map((row, i, arr) => {
              const performerName = Array.isArray(row.performer)
                ? row.performer[0]?.display_name
                : row.performer?.display_name
              return (
                <div
                  key={row.id}
                  className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                    i < arr.length - 1 ? 'border-b border-zinc-100' : ''
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-900">
                      <span className="font-medium">{performerName || 'someone'}</span>{' '}
                      <ActionPhrase action={row.action} />{' '}
                      <Link
                        href={`/admin/orders/${row.order_id}`}
                        className="font-mono text-orange-600 hover:text-orange-700"
                      >
                        #{row.order_id.slice(0, 8)}
                      </Link>
                    </p>
                  </div>
                  <span className="text-xs text-zinc-400 flex-shrink-0">
                    {timeAgo(row.created_at)}
                  </span>
                </div>
              )
            })
          ) : (
            <div className="px-4 py-8 text-center text-sm text-zinc-400">
              No activity yet today.
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────

function QueueTile({ label, count, href, cta, tone, hint }: QueueTileProps) {
  const c = TONE_CLASSES[tone]
  return (
    <Link
      href={href}
      className={`group block p-4 rounded-xl ring-1 transition-all hover:shadow-sm ${c.bg} ${c.ring}`}
    >
      <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">{label}</p>
      <p className={`text-3xl font-light tabular-nums tracking-tight mt-1 ${c.count}`}>
        {count}
      </p>
      {hint && <p className="text-[11px] text-zinc-400 mt-1">{hint}</p>}
      <p className={`text-xs font-semibold mt-3 ${c.cta}`}>{cta}</p>
    </Link>
  )
}

function StatTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="p-4 rounded-xl bg-white border border-zinc-200">
      <p className="text-xs uppercase tracking-wide text-zinc-500 font-semibold">{label}</p>
      <p className="text-3xl font-light tabular-nums tracking-tight text-zinc-900 mt-1">
        {value}
      </p>
      {sub && <p className="text-xs text-zinc-400 mt-1">{sub}</p>}
    </div>
  )
}

/** Maps action codes from intake_activity_log to human-readable verbs.
 *  Falls through to the raw action for unknown values so we don't have
 *  to update this every time we add a new action. */
function ActionPhrase({ action }: { action: string }) {
  if (action === 'verified') return <>verified item on</>
  if (action === 'flagged') return <>flagged item on</>
  if (action === 'packed_out') return <>packed</>
  if (action.startsWith('received_via:')) return <>received</>
  if (action.startsWith('finalize_auth:authenticated')) return <>finalized authentication on</>
  if (action.startsWith('finalize_auth:exception_review')) return <>flagged for exception review on</>
  if (action.startsWith('auth_decision:authentic:near_mint')) return <>marked an item near-mint on</>
  if (action.startsWith('auth_decision:authentic:exception')) return <>flagged an item exception on</>
  if (action.startsWith('auth_decision:fake')) return <>marked an item fake on</>
  return <>did <span className="font-mono text-xs text-zinc-500">{action}</span> on</>
}

/** Relative time ago — server-rendered so no hydration mismatch. */
function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d`
  return new Date(dateStr).toLocaleDateString()
}
