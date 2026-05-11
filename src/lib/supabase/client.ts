import { createBrowserClient } from '@supabase/ssr'
import { processLock } from '@supabase/auth-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton: one browser client per tab. Multiple instances each register
// their own auth lock, which causes "AbortError: signal is aborted without
// reason" under React Strict Mode double-mounts in dev.
//
// We also swap navigator.locks for processLock — the navigator.locks API
// aborts unpredictably in dev (strict-mode unmounts cancel in-flight
// acquisitions). processLock is an in-process JS-Promise mutex that works
// fine for a singleton client.
let client: SupabaseClient | undefined

export function createClient(): SupabaseClient {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
    {
      isSingleton: true,
      auth: { lock: processLock },
    },
  )
  return client
}
