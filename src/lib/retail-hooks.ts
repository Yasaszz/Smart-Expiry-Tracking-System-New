import { collection, onSnapshot, query, where, Timestamp } from 'firebase/firestore'
import { useEffect, useState } from 'react'

import { useAuth } from './app-context'
import { db, getErrorMessage } from './firebase'
import { storeDate } from './retail-domain'
import { readBatch } from './retail-store'

export interface RetailRecord {
  id: string
}
export function useRetailCollection<T extends RetailRecord>(name: string, windowDays?: number) {
  const { user } = useAuth()
  const today = storeDate()
  const key = `${user?.uid || 'pending'}:${name}:${windowDays || 'all'}:${today}`
  const [state, setState] = useState<{
    key: string
    rows: T[]
    loading: boolean
    stale: boolean
    error: string
  }>({ key: '', rows: [], loading: true, stale: true, error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!user) return
    let source = query(collection(db, name))
    if (windowDays) {
      const start = new Date(today + 'T00:00:00+05:30')
      start.setUTCDate(start.getUTCDate() - (windowDays - 1))
      source = query(collection(db, name), where('timestamp', '>=', Timestamp.fromDate(start)))
    }
    return onSnapshot(
      source,
      { includeMetadataChanges: true },
      (snapshot) => {
        if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) {
          setState((previous) =>
            previous.key === key
              ? { ...previous, stale: true }
              : { key, rows: [], loading: true, stale: true, error: '' }
          )
          return
        }
        try {
          const rows = snapshot.docs.map((item) => {
            if (name === 'batches') return readBatch(item.id, item.data()) as unknown as T
            const data = item.data()
            if (
              ['suppliers', 'purchaseOrders', 'supplierReturns', 'alertResolutions'].includes(
                name
              ) &&
              (!Number.isInteger(data.version) || data.version < 1)
            )
              throw new Error(`A ${name} record contains an invalid revision.`)
            if (
              name === 'purchaseOrders' &&
              (!Array.isArray(data.lines) ||
                !Number.isSafeInteger(data.totalMinor) ||
                !Number.isSafeInteger(data.receivedMinor))
            )
              throw new Error('A purchase order contains invalid totals or lines.')
            return { ...data, id: item.id } as T
          })
          setState({ key, rows, loading: false, stale: false, error: '' })
        } catch (error) {
          setState({ key, rows: [], loading: false, stale: true, error: getErrorMessage(error) })
        }
      },
      (error) =>
        setState({
          key,
          rows: [],
          loading: false,
          stale: true,
          error:
            error.code === 'permission-denied'
              ? 'This feature needs updated Firestore Security Rules. Publish src/lib/firestore.rules in Firebase Console. No inventory changes have been made.'
              : getErrorMessage(error),
        })
    )
  }, [user, name, windowDays, today, key, attempt])
  const current =
    state.key === key ? state : { rows: [] as T[], loading: true, stale: true, error: '' }
  return {
    ...current,
    ready: !!user && !current.loading && !current.stale && !current.error,
    retry: () => setAttempt((value) => value + 1),
  }
}

export function useRetailNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}
