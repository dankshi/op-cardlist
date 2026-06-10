'use client'

import type { ReactNode } from 'react'
import { useAdminDebug } from '@/lib/useAdminDebug'

/** Client wrapper for admin-only debug UI. Returns null when the admin has
 *  hidden debug panels via the profile-dropdown toggle. Also renders a quick
 *  inline "hide" button so you can dismiss it right here (it persists + syncs
 *  with the profile toggle) instead of going back to the profile menu. The
 *  server-side caller is responsible for the admin gate — non-admins should
 *  never see this component instantiated at all. */
export function AdminDebugSection({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useAdminDebug()
  if (!visible) return null
  return (
    <div>
      <div className="flex justify-end mb-1">
        <button
          type="button"
          onClick={() => setVisible(false)}
          title="Hide debug panels (re-enable from the profile menu)"
          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors cursor-pointer"
        >
          Hide debug ×
        </button>
      </div>
      {children}
    </div>
  )
}
