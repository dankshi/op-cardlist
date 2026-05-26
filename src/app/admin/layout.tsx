'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_SECTIONS: { heading: string; items: { href: string; label: string }[] }[] = [
  {
    heading: 'Overview',
    items: [
      { href: '/admin', label: 'Dashboard' },
    ],
  },
  {
    heading: 'Fulfillment',
    items: [
      // Ordered to mirror the order lifecycle: receive → authenticate
      // → pack → resolve issues / risk → manage post-exception
      // inventory. Reading top-to-bottom walks you through a package's
      // journey including its afterlife when something went wrong.
      { href: '/admin/orders', label: 'Orders' },
      { href: '/admin/intake', label: 'Intake' },
      { href: '/admin/pack', label: 'Pack' },
      { href: '/admin/intake/issues', label: 'Issues' },
      { href: '/admin/risk', label: 'Risk Review' },
      { href: '/admin/inventory', label: 'Inventory' },
    ],
  },
  {
    heading: 'Data Quality',
    items: [
      { href: '/admin/cards', label: 'Edit Cards' },
      { href: '/admin/mappings', label: 'TCGplayer Mappings' },
      { href: '/admin/psa-pops', label: 'PSA Pop Mappings' },
      { href: '/admin/promos', label: 'Promo Cards' },
    ],
  },
  {
    heading: 'Community',
    items: [
      { href: '/admin/raffles', label: 'Raffles' },
    ],
  },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex gap-6">
      <aside className="w-48 flex-shrink-0">
        <div className="sticky top-24">
          <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-3 px-3">Admin</p>
          {NAV_SECTIONS.map(section => (
            <div key={section.heading} className="mb-6">
              <p className="text-xs uppercase tracking-wide text-zinc-400 font-medium mb-2 px-3">
                {section.heading}
              </p>
              <nav className="space-y-0.5">
                {section.items.map(item => {
                  // Dashboard is /admin exactly — without this guard it
                  // would match every nested admin route (since
                  // '/admin/orders'.startsWith('/admin/') is true).
                  const active = item.href === '/admin'
                    ? pathname === '/admin'
                    : pathname === item.href || pathname.startsWith(item.href + '/')
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        active
                          ? 'bg-orange-500/10 text-orange-600'
                          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                      }`}
                    >
                      {item.label}
                    </Link>
                  )
                })}
              </nav>
            </div>
          ))}
        </div>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
