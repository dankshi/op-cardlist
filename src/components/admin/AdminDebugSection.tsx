'use client'

import type { ReactNode } from 'react'
import { useAdminDebug } from '@/lib/useAdminDebug'

/** Client wrapper for admin-only debug UI. Returns null when the admin has
 *  hidden debug panels via the profile-dropdown toggle. The server-side
 *  caller is responsible for the admin gate — non-admins should never see
 *  this component instantiated at all. */
export function AdminDebugSection({ children }: { children: ReactNode }) {
  const [visible] = useAdminDebug()
  if (!visible) return null
  return <>{children}</>
}
