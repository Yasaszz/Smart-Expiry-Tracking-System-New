import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../../lib/app-context'
import { getErrorMessage, loginWithEmail, loginWithGoogle } from '../../lib/firebase'
import { AuthFrame } from '../../lib/ui'
import { buttonClass, secondaryClass, inputClass, ErrorNotice } from '../layout'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { user } = useAuth()
  const location = useLocation()
  const requested = (location.state as { from?: string } | null)?.from
  const destination = [
    '/dashboard',
    '/products',
    '/stock',
    '/promotions',
    '/reports',
    '/notifications',
    '/batches',
    '/suppliers',
    '/purchase-orders',
    '/supplier-returns',
    '/insights',
  ].includes((requested || '').split('?')[0])
    ? requested!
    : '/dashboard'
  async function login(google: boolean) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (google) await loginWithGoogle()
      else await loginWithEmail(email, password)
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    void login(false)
  }
  if (user && !busy && !error) return <Navigate to={destination} replace />
  return (
    <AuthFrame>
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 text-[13px] leading-6 text-slate-500">
        Use your account to access the inventory workspace.
      </p>
      <div className="mt-6">
        <ErrorNotice message={error} />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void login(true)}
        className={`${secondaryClass} mt-5 w-full`}
      >
        Continue with Google
      </button>
      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] text-slate-400">or use email</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="space-y-5">
          <label htmlFor="email" className="block text-[13px] font-medium">
            Email address
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={inputClass}
            />
          </label>
          <div>
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-[13px] font-medium">
                Password
              </label>
              <button
                type="button"
                aria-pressed={showPassword}
                aria-controls="password"
                onClick={() => setShowPassword(!showPassword)}
                className="rounded text-xs font-medium text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-600"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </div>
          <button className={`${buttonClass} w-full`} type="submit">
            {busy ? 'Signing in...' : 'Sign in'}
          </button>
        </fieldset>
      </form>
      <p className="mt-7 border-t border-slate-100 pt-6 text-center text-xs text-slate-500">
        Need an account?{' '}
        <Link to="/register" className="font-semibold text-indigo-600 hover:underline">
          Create account
        </Link>
      </p>
    </AuthFrame>
  )
}
