'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { SubmitButton, AuthError } from '@/components/auth/AuthForm'
import { US_STATES } from '@/lib/us-states'
import type { Profile } from '@/types/database'

export default function EditProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const didLoad = useRef(false)

  useEffect(() => {
    if (didLoad.current) return
    didLoad.current = true
    async function loadProfile() {
      try {
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
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [supabase, router])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    const zip = ((formData.get('zip') as string) || '').replace(/\D/g, '').slice(0, 5)
    const updates = {
      display_name: formData.get('displayName') as string,
      username: (formData.get('username') as string)?.toLowerCase().trim() || null,
      bio: (formData.get('bio') as string) || null,
      shipping_street1: ((formData.get('street') as string) || '').trim() || null,
      shipping_city: ((formData.get('city') as string) || '').trim() || null,
      shipping_state: (formData.get('state') as string) || null,
      shipping_zip: zip || null,
      shipping_phone: ((formData.get('phone') as string) || '').trim() || null,
    }

    if (updates.username && !/^[a-z0-9_-]{3,30}$/.test(updates.username)) {
      setError('Username must be 3-30 characters, lowercase letters, numbers, hyphens and underscores only')
      setPending(false)
      return
    }

    if (updates.shipping_zip && updates.shipping_zip.length !== 5) {
      setError('Please enter a valid 5-digit ZIP code')
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

          <div className="pt-2 border-t border-zinc-200">
            <h2 className="text-lg font-semibold text-zinc-900 mt-4 mb-1">Address &amp; phone</h2>
            <p className="text-sm text-zinc-500 mb-4">
              Used for shipping and order contact. Sellers also use this as their return address.
            </p>

            <div className="space-y-4">
              <div>
                <label htmlFor="street" className="block text-sm font-medium text-zinc-600 mb-1.5">
                  Street address
                </label>
                <input
                  id="street"
                  name="street"
                  type="text"
                  defaultValue={profile.shipping_street1 || ''}
                  placeholder="123 Main St"
                  autoComplete="street-address"
                  className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
                />
              </div>

              <div className="grid grid-cols-6 gap-3">
                <div className="col-span-3">
                  <label htmlFor="city" className="block text-sm font-medium text-zinc-600 mb-1.5">
                    City
                  </label>
                  <input
                    id="city"
                    name="city"
                    type="text"
                    defaultValue={profile.shipping_city || ''}
                    placeholder="City"
                    autoComplete="address-level2"
                    className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
                  />
                </div>
                <div className="col-span-2">
                  <label htmlFor="state" className="block text-sm font-medium text-zinc-600 mb-1.5">
                    State
                  </label>
                  <select
                    id="state"
                    name="state"
                    defaultValue={profile.shipping_state || ''}
                    className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
                  >
                    <option value="">Select</option>
                    {US_STATES.map(s => (
                      <option key={s.value} value={s.value}>{s.value}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-1">
                  <label htmlFor="zip" className="block text-sm font-medium text-zinc-600 mb-1.5">
                    ZIP
                  </label>
                  <input
                    id="zip"
                    name="zip"
                    type="text"
                    inputMode="numeric"
                    defaultValue={profile.shipping_zip || ''}
                    placeholder="00000"
                    autoComplete="postal-code"
                    className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-zinc-600 mb-1.5">
                  Phone number
                </label>
                <input
                  id="phone"
                  name="phone"
                  type="tel"
                  defaultValue={profile.shipping_phone || ''}
                  placeholder="(555) 555-5555"
                  autoComplete="tel"
                  className="w-full px-4 py-3 rounded-lg bg-zinc-100 border border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-colors"
                />
              </div>
            </div>
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
