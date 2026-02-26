'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { OAuthButtons, Divider, FormInput, SubmitButton, AuthError } from '@/components/auth/AuthForm'

export default function SignUpPage() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [success, setSuccess] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const displayName = formData.get('displayName') as string

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: displayName },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (error) {
      setError(error.message)
      setPending(false)
    } else {
      setSuccess(true)
      setPending(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="w-full max-w-md p-8 rounded-2xl bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200 text-center">
          <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-zinc-100 light:text-gray-900">Check your email</h1>
          <p className="text-zinc-400 light:text-gray-500 mt-2">
            We&apos;ve sent you a confirmation link. Click it to activate your account.
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
          <h1 className="text-2xl font-bold text-zinc-100 light:text-gray-900">Create your account</h1>
          <p className="text-zinc-400 light:text-gray-500 mt-2">Join NOMI Market to buy and sell cards</p>
        </div>

        <OAuthButtons />
        <Divider />

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthError message={error} />
          <FormInput label="Display Name" name="displayName" placeholder="Your name" autoComplete="name" />
          <FormInput label="Email" type="email" name="email" placeholder="you@example.com" autoComplete="email" />
          <FormInput label="Password" type="password" name="password" placeholder="At least 6 characters" autoComplete="new-password" />

          <SubmitButton pending={pending}>Create Account</SubmitButton>
        </form>

        <p className="text-center text-zinc-400 light:text-gray-500 text-sm mt-6">
          Already have an account?{' '}
          <Link href="/auth/sign-in" className="text-orange-400 hover:text-orange-300 light:hover:text-orange-500 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
