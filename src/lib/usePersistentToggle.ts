'use client'

import { useEffect, useState } from 'react'

/** Builds a `[visible, setVisible]` hook backed by localStorage and kept in
 *  sync across tabs (the standard `storage` event) and within the same tab
 *  (a custom event we emit ourselves — `storage` only fires in OTHER tabs,
 *  so without it the writing tab's UI wouldn't update until a reload).
 *
 *  Used for the admin-only UI switches in the profile dropdown (debug
 *  panels, market data). The server is responsible for the admin gate —
 *  these toggles only decide visibility for users who already see the
 *  component instantiated. `defaultVisible` sets the state before any
 *  stored preference is read; once the admin flips it, the choice sticks. */
export function makePersistentToggle(
  storageKey: string,
  eventName: string,
  defaultVisible = false,
) {
  return function usePersistentToggle(): readonly [boolean, (v: boolean) => void] {
    const [visible, setVisible] = useState<boolean>(defaultVisible)

    // Initial sync from localStorage runs after mount to avoid SSR
    // hydration mismatch (the server can't read localStorage).
    useEffect(() => {
      try {
        const stored = window.localStorage.getItem(storageKey)
        if (stored !== null) setVisible(stored !== 'false')
      } catch { /* private mode, etc. — fall back to default */ }
    }, [])

    // Cross-tab sync via the standard `storage` event.
    useEffect(() => {
      function onStorage(e: StorageEvent) {
        if (e.key === storageKey) setVisible(e.newValue !== 'false')
      }
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    }, [])

    // Same-tab sync via a custom event we emit ourselves.
    useEffect(() => {
      function onToggle(e: Event) {
        setVisible((e as CustomEvent<boolean>).detail)
      }
      window.addEventListener(eventName, onToggle)
      return () => window.removeEventListener(eventName, onToggle)
    }, [])

    function set(v: boolean) {
      setVisible(v)
      try {
        window.localStorage.setItem(storageKey, v ? 'true' : 'false')
      } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent(eventName, { detail: v }))
    }

    return [visible, set] as const
  }
}
