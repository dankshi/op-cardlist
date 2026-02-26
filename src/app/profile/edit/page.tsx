'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FormInput, SubmitButton, AuthError } from '@/components/auth/AuthForm'
import type { Profile } from '@/types/database'

export default function EditProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setProfile(data)
      setLoading(false)
    }
    loadProfile()
  }, [supabase, router])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    const updates = {
      display_name: formData.get('displayName') as string,
      username: (formData.get('username') as string)?.toLowerCase().trim() || null,
      bio: (formData.get('bio') as string) || null,
    }

    if (updates.username && !/^[a-z0-9_-]{3,30}$/.test(updates.username)) {
      setError('Username must be 3-30 characters, lowercase letters, numbers, hyphens and underscores only')
      setPending(false)
      return
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profile!.id)

    if (error) {
      if (error.code === '23505') {
        setError('That username is already taken')
      } else {
        setError(error.message)
      }
      setPending(false)
    } else {
      router.push('/profile')
      router.refresh()
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="text-center py-20">
        <p className="text-zinc-500">Profile not found.</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-zinc-900 mb-8">Edit Profile</h1>

      <div className="bg-white border border-zinc-200 rounded-2xl p-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <AuthError message={error} />

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-zinc-600 mb-1.5">
              Display Name
            </label>
            <input
              id="displayName"
              name="displayName"
              type="text"
              defaultValue={profile.display_name || ''}
              required
              className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
            />
          </div>

          <div>
            <label htmlFor="username" className="block text-sm font-medium text-zinc-600 mb-1.5">
              Username
            </label>
            <div className="flex items-center">
              <span className="px-3 py-3 rounded-l-lg bg-zinc-200 border border-r-0 border-zinc-600 text-zinc-500 text-sm">
                nomimarket.com/seller/
              </span>
              <input
                id="username"
                name="username"
                type="text"
                defaultValue={profile.username || ''}
                placeholder="your-username"
                pattern="[a-z0-9_\-]{3,30}"
                className="w-full px-4 py-3 rounded-r-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
              />
            </div>
            <p className="mt-1 text-xs text-zinc-500">This will be your seller storefront URL</p>
          </div>

          <div>
            <label htmlFor="bio" className="block text-sm font-medium text-zinc-600 mb-1.5">
              Bio
            </label>
            <textarea
              id="bio"
              name="bio"
              rows={4}
              defaultValue={profile.bio || ''}
              placeholder="Tell buyers about yourself..."
              className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors resize-none"
            />
          </div>

          <div className="flex gap-3">
            <SubmitButton pending={pending}>Save Changes</SubmitButton>
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-3 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
