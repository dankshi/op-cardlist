'use client'

import { useRef, useState, useMemo } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { STATUS_LABELS, statusStyle } from '@/lib/admin/orderStatus'

// Statuses surfaced in the Orders dropdown, ordered like the order list.
// Legacy 'shipped' and 'pending_payment' are intentionally omitted — they
// rarely need a dedicated jump; "All Orders" still surfaces them.
const ORDER_STATUS_LINKS = [
  'exception_review',
  'under_review',
  'paid',
  'seller_shipped',
  'received',
  'authenticated',
  'shipped_to_buyer',
  'delivered',
  'cancelled',
  'refunded',
]

const FULFILLMENT_LINKS = [
  { href: '/admin/intake', label: 'Intake' },
  { href: '/admin/pack', label: 'Pack' },
  { href: '/admin/intake/issues', label: 'Issues' },
  { href: '/admin/risk', label: 'Risk Review' },
  { href: '/admin/inventory', label: 'Inventory' },
]

const DATA_LINKS = [
  { href: '/admin/cards', label: 'Edit Cards' },
  { href: '/admin/mappings', label: 'TCGplayer Mappings' },
  { href: '/admin/psa-pops', label: 'PSA Pop Mappings' },
  { href: '/admin/promos', label: 'Promo Cards' },
]

const COMMUNITY_LINKS = [{ href: '/admin/raffles', label: 'Raffles' }]

export function AdminNav({ adminName, adminEmail }: { adminName: string; adminEmail: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  // A section is "active" when the current route lives under any of its
  // hrefs. Orders is special-cased on the /admin/orders prefix.
  const ordersActive = pathname.startsWith('/admin/orders')
  const fulfillmentActive = FULFILLMENT_LINKS.some(l => pathname === l.href || pathname.startsWith(l.href + '/'))
  const dataActive = DATA_LINKS.some(l => pathname === l.href || pathname.startsWith(l.href + '/'))
  const communityActive = COMMUNITY_LINKS.some(l => pathname === l.href || pathname.startsWith(l.href + '/'))

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-zinc-200">
      <nav className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-1">
        <Link href="/admin" className="flex items-center gap-2 mr-3 flex-shrink-0">
          <span className="text-sm font-bold text-zinc-900">nomi</span>
          <span className="text-[10px] uppercase tracking-widest font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
            admin
          </span>
        </Link>

        <TopLink href="/admin" label="Dashboard" active={pathname === '/admin'} />

        <NavDropdown label="Orders" active={ordersActive}>
          <MenuLink href="/admin/orders" label="All Orders" />
          <MenuDivider />
          {ORDER_STATUS_LINKS.map(key => (
            <MenuLink
              key={key}
              href={`/admin/orders?status=${key}`}
              label={STATUS_LABELS[key] || key}
              dot={statusStyle(key)}
            />
          ))}
        </NavDropdown>

        <NavDropdown label="Fulfillment" active={fulfillmentActive}>
          {FULFILLMENT_LINKS.map(l => (
            <MenuLink key={l.href} href={l.href} label={l.label} />
          ))}
        </NavDropdown>

        <NavDropdown label="Data" active={dataActive}>
          {DATA_LINKS.map(l => (
            <MenuLink key={l.href} href={l.href} label={l.label} />
          ))}
        </NavDropdown>

        <NavDropdown label="Community" active={communityActive}>
          {COMMUNITY_LINKS.map(l => (
            <MenuLink key={l.href} href={l.href} label={l.label} />
          ))}
        </NavDropdown>

        <div className="ml-auto flex items-center gap-3">
          <a
            href="/"
            className="hidden sm:inline text-xs text-zinc-400 hover:text-zinc-700 transition-colors"
          >
            View storefront ↗
          </a>
          <AccountMenu adminName={adminName} adminEmail={adminEmail} onSignOut={signOut} />
        </div>
      </nav>
    </header>
  )
}

function TopLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
      }`}
    >
      {label}
    </Link>
  )
}

/** Hover- AND keyboard-accessible dropdown. Hover intent keeps it open as
 *  the cursor travels to the panel; focus-within keeps it open for Tab
 *  users; click toggles for touch. */
function NavDropdown({ label, active, children }: { label: string; active: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  function closeSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <div
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeSoon()
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
          active ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
        }`}
      >
        {label}
        <svg
          className={`w-3 h-3 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        // pt-1 bridges the gap between trigger and panel so the cursor
        // doesn't fall into dead space and trigger a close.
        <div role="menu" className="absolute left-0 top-full pt-1" onClick={() => setOpen(false)}>
          <div className="min-w-[220px] rounded-xl bg-white border border-zinc-200 shadow-xl py-1.5">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

function MenuLink({ href, label, dot }: { href: string; label: string; dot?: string }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors"
    >
      {dot !== undefined && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dot}`} />}
      <span className="truncate">{label}</span>
    </Link>
  )
}

function MenuDivider() {
  return <div className="my-1 border-t border-zinc-100" />
}

function AccountMenu({
  adminName,
  adminEmail,
  onSignOut,
}: {
  adminName: string
  adminEmail: string
  onSignOut: () => void
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openNow() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  function closeSoon() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  const initial = (adminName?.[0] || adminEmail?.[0] || '?').toUpperCase()

  return (
    <div
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      onFocus={openNow}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) closeSoon()
      }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full bg-indigo-600 text-white text-sm font-bold flex items-center justify-center cursor-pointer"
      >
        {initial}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full pt-1">
          <div className="w-56 rounded-xl bg-white border border-zinc-200 shadow-xl py-1.5">
            <div className="px-3 py-2 border-b border-zinc-100">
              <p className="text-sm font-medium text-zinc-900 truncate">{adminName}</p>
              <p className="text-xs text-zinc-500 truncate">{adminEmail}</p>
            </div>
            <Link href="/" role="menuitem" className="block px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900">
              View storefront
            </Link>
            <Link href="/profile" role="menuitem" className="block px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900">
              My Profile
            </Link>
            <div className="mt-1 pt-1 border-t border-zinc-100">
              <button
                type="button"
                onClick={onSignOut}
                className="block w-full text-left px-3 py-1.5 text-sm text-red-500 hover:bg-zinc-50 cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
