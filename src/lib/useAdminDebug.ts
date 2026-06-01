'use client'

import { makePersistentToggle } from './usePersistentToggle'

/** Returns whether admin-only debug panels (e.g. the "data sources" block
 *  on /card/[id]) should currently render, plus a setter that persists the
 *  preference and notifies any other mounted readers. Hidden by default;
 *  admins opt in via the profile-dropdown toggle and the choice sticks. */
export const useAdminDebug = makePersistentToggle(
  'nomi:admin-debug-visible',
  'nomi:admin-debug-toggle',
)
