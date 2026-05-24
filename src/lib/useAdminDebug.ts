'use client'

import { useEffect, useState } from 'react'

// LocalStorage key + custom event name for syncing the "show admin debug
// panels" toggle. Custom event is needed because the `storage` event only
// fires in OTHER tabs, not the one that wrote the value, so without it the
// toggle wouldn't update the current tab's UI until a reload.
const STORAGE_KEY = 'nomi:admin-debug-visible'
const EVENT_NAME = 'nomi:admin-debug-toggle'

/** Returns whether admin-only debug panels (e.g. the "data sources" block
 *  on /card/[id]) should currently render, plus a setter that persists the
 *  preference and notifies any other mounted readers. Defaults to visible
 *  for first-time admins; once they hide it, the setting sticks. */
export function useAdminDebug(): readonly [boolean, (v: boolean) => void] {
  const [visible, setVisible] = useState<boolean>(true)

  // Initial sync from localStorage runs after mount to avoid SSR hydration
  // mismatch (the server can't read localStorage).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored !== null) setVisible(stored !== 'false')
    } catch { /* private mode, etc. — fall back to default */ }
  }, [])

  // Cross-tab sync via the standard `storage` event.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setVisible(e.newValue !== 'false')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Same-tab sync via a custom event we emit ourselves.
  useEffect(() => {
    function onToggle(e: Event) {
      setVisible((e as CustomEvent<boolean>).detail)
    }
    window.addEventListener(EVENT_NAME, onToggle)
    return () => window.removeEventListener(EVENT_NAME, onToggle)
  }, [])

  function set(v: boolean) {
    setVisible(v)
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? 'true' : 'false')
    } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: v }))
  }

  return [visible, set] as const
}
