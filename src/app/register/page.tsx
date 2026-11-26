import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'

import { useAuth } from '../../lib/app-context'
import { getErrorMessage, loginWithGoogle, registerWithEmail } from '../../lib/firebase'
import { AuthFrame } from '../../lib/ui'
import { buttonClass, secondaryClass, inputClass, ErrorNotice } from '../layout'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { user } = useAuth()
  async function registerWithGoogle() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await loginWithGoogle()
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (password !== confirm) {
      setError('Passwords must match.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await registerWithEmail(name, email, password)
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  if (user && !busy && !error) return <Navigate to="/dashboard" replace />
  return (
    <AuthFrame>
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="mt-2 text-[13px] leading-6 text-slate-500">
        Enter your details to set up your sign-in.
      </p>
      <div className="mt-5">
        <ErrorNotice message={error} />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void registerWithGoogle()}
        className={`${secondaryClass} mt-5 w-full`}
      >
        Continue with Google
      </button>
      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-[11px] text-slate-400">or use email</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="space-y-4">
          <label htmlFor="name" className="block text-[13px] font-medium">
            Full name
            <input
              id="name"
              autoComplete="name"
              required
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </label>
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
                aria-controls="password confirm"
                onClick={() => setShowPassword(!showPassword)}
                className="rounded text-xs font-medium text-indigo-600 focus-visible:outline-2 focus-visible:outline-indigo-600"
              >
                {showPassword ? 'Hide passwords' : 'Show passwords'}
              </button>
            </div>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
            <p className="mt-1.5 text-[11px] text-slate-400">At least 8 characters.</p>
          </div>
          <label htmlFor="confirm" className="block text-[13px] font-medium">
            Confirm password
            <input
              id="confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              minLength={8}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className={inputClass}
            />
          </label>
          <button type="submit" className={`${buttonClass} w-full`}>
            {busy ? 'Creating account...' : 'Create account'}
          </button>
        </fieldset>
      </form>
      <p className="mt-7 border-t border-slate-100 pt-6 text-center text-xs text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-indigo-600 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthFrame>
  )
}
