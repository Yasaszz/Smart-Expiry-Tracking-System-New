import { useEffect, useState } from 'react'

import { useAuth } from './app-context'
import { getErrorMessage, subscribeToLedger, type Sale, type StockHistory } from './firebase'

export function useMonthlyLedger<T extends Sale | StockHistory>(
  kind: 'sales' | 'StockHistory',
  month: string
) {
  const { user } = useAuth()
  const [state, setState] = useState<{
    key: string
    rows: T[]
    loading: boolean
    stale: boolean
    error: string
  }>({ key: '', rows: [], loading: true, stale: true, error: '' })
  const [attempt, setAttempt] = useState(0)
  const key = `${user?.uid || 'pending'}:${kind}:${month}`
  useEffect(() => {
    if (!user || !/^\d{4}-\d{2}$/.test(month)) return
    try {
      return subscribeToLedger<T>(
        kind,
        month,
        (rows, stale) => {
          if (stale)
            setState((previous) =>
              previous.key === key
                ? { ...previous, stale: true }
                : { key, rows: [], loading: true, stale: true, error: '' }
            )
          else setState({ key, rows, loading: false, stale: false, error: '' })
        },
        (error) =>
          setState({ key, rows: [], loading: false, stale: true, error: getErrorMessage(error) })
      )
    } catch (error) {
      queueMicrotask(() =>
        setState({ key, rows: [], loading: false, stale: true, error: getErrorMessage(error) })
      )
    }
  }, [kind, month, key, attempt, user])
  return {
    ...(state.key === key ? state : { rows: [] as T[], loading: true, stale: true, error: '' }),
    retry: () => setAttempt((value) => value + 1),
  }
}
export function useSavedState<T>(
  name: string,
  initial: T,
  validate: (value: unknown) => value is T
) {
  const { user } = useAuth()
  const key = `smart-expiry:${user?.uid}:${name}`
  const [state, setState] = useState<{ key: string; value: T }>({ key: '', value: initial })
  useEffect(() => {
    if (!user) return
    let value = initial
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(key) || 'null')
      if (validate(stored)) value = stored
    } catch {
      /* storage is optional */
    }
    queueMicrotask(() => setState({ key, value }))
    // Callers use stable schemas and initial values; reload only when the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user])
  function update(value: T) {
    if (!user) return
    setState({ key, value })
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* private browsing may disable storage */
    }
  }
  return [state.key === key ? state.value : initial, update] as const
}
