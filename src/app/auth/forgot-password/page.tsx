'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { FormInput, SubmitButton, AuthError } from '@/components/auth/AuthForm'

export default function ForgotPasswordPage() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState(false)
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/update-password`,
    })

    if (error) {
      setError(error.message)
    } else {
      setSuccess(true)
    }
    setPending(false)
  }

  if (success) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-md p-8 rounded-2xl bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 text-center">
          <div className="w-16 h-16 bg-orange-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 light:text-gray-900">Check your email</h1>
          <p className="text-zinc-400 light:text-gray-500 mt-2">
            If an account exists with that email, we&apos;ve sent a password reset link.
          </p>
          <Link
            href="/auth/sign-in"
            className="inline-block mt-6 text-orange-400 hover:text-orange-300 light:hover:text-orange-500 font-medium"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md p-8 rounded-2xl bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-100 light:text-gray-900">Reset your password</h1>
          <p className="text-zinc-400 light:text-gray-500 mt-2">Enter your email and we&apos;ll send you a reset link</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthError message={error} />
          <FormInput label="Email" type="email" name="email" placeholder="you@example.com" autoComplete="email" />
          <SubmitButton pending={pending}>Send Reset Link</SubmitButton>
        </form>

        <p className="text-center text-zinc-400 light:text-gray-500 text-sm mt-6">
          Remember your password?{' '}
          <Link href="/auth/sign-in" className="text-orange-400 hover:text-orange-300 light:hover:text-orange-500 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
