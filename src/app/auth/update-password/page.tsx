'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { FormInput, SubmitButton, AuthError } from '@/components/auth/AuthForm'

export default function UpdatePasswordPage() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setPending(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setPending(false)
      return
    }

    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      setError(error.message)
      setPending(false)
    } else {
      router.push('/auth/sign-in?message=password_updated')
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md p-8 rounded-2xl bg-white border border-zinc-200">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-900">Set new password</h1>
          <p className="text-zinc-500 mt-2">Enter your new password below</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthError message={error} />
          <FormInput label="New Password" type="password" name="password" placeholder="At least 6 characters" autoComplete="new-password" />
          <FormInput label="Confirm Password" type="password" name="confirmPassword" placeholder="Confirm your password" autoComplete="new-password" />
          <SubmitButton pending={pending}>Update Password</SubmitButton>
        </form>
      </div>
    </div>
  )
}
