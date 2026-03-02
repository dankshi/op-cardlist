import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { Profile } from '@/types/database'

export async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function requireUser() {
  const user = await getUser()
  if (!user) redirect('/auth/sign-in')
  return user
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return data
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single()
  return data
}

export async function requireSeller() {
  const user = await requireUser()
  const profile = await getProfile(user.id)
  if (!profile?.is_seller || !profile?.seller_approved) {
    redirect('/seller/apply')
  }
  return { user, profile }
}

export async function requireAdmin() {
  const user = await requireUser()
  const profile = await getProfile(user.id)
  if (!profile?.is_admin) {
    redirect('/')
  }
  return { user, profile }
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const user = await getUser()
  if (!user) return null
  return getProfile(user.id)
}
