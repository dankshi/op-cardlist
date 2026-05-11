import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Singleton: one browser client per tab. Multiple instances each register
// a navigator.locks handle for auth refresh, which causes
// "AbortError: signal is aborted without reason" when they race or
// when React Strict Mode double-mounts in dev.
let client: SupabaseClient | undefined

export function createClient(): SupabaseClient {
  if (client) return client
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
  )
  return client
}
