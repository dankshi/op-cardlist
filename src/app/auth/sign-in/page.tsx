'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { OAuthButtons, Divider, FormInput, SubmitButton, AuthError } from '@/components/auth/AuthForm'

export default function SignInPage() {
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPending(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setPending(false)
    } else {
      router.push('/')
      router.refresh()
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-md p-8 rounded-2xl bg-zinc-900 light:bg-white border border-zinc-800 light:border-gray-200">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-zinc-100 light:text-gray-900">Welcome back</h1>
          <p className="text-zinc-400 light:text-gray-500 mt-2">Sign in to your NOMI Market account</p>
        </div>

        <OAuthButtons />
        <Divider />

        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthError message={error} />
          <FormInput label="Email" type="email" name="email" placeholder="you@example.com" autoComplete="email" />
          <FormInput label="Password" type="password" name="password" placeholder="Your password" autoComplete="current-password" />

          <div className="flex justify-end">
            <Link href="/auth/forgot-password" className="text-sm text-sky-400 hover:text-sky-300 light:hover:text-sky-600">
              Forgot password?
            </Link>
          </div>

          <SubmitButton pending={pending}>Sign In</SubmitButton>
        </form>

        <p className="text-center text-zinc-400 light:text-gray-500 text-sm mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/auth/sign-up" className="text-sky-400 hover:text-sky-300 light:hover:text-sky-600 font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
