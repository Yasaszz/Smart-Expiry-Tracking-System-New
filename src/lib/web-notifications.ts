import { useEffect, useState } from 'react'

import { daysUntilExpiry, getExpiryLevel, type Product } from './firebase'
import type { Batch } from './retail-domain'

export interface WebNotification {
  id: string
  product: Product
  expiry: boolean
  lowStock: boolean
  expired: boolean
  days: number
  batchId?: string
  batchNumber?: string
}
export function buildWebNotifications(
  products: Product[],
  now = new Date(),
  batches: Batch[] = []
): WebNotification[] {
  const alerts: WebNotification[] = []
  for (const product of products) {
    const days = daysUntilExpiry(product.expiryDate, now),
      lowStock = product.stockQuantity <= (product.lowStockThreshold ?? 5)
    if (product.batchManaged) {
      for (const batch of batches.filter(
        (item) => item.productId === product.id && item.quantity > 0
      )) {
        const batchDays = daysUntilExpiry(batch.expiryDate, now)
        if (batchDays > 30) continue
        alerts.push({
          id: `batch:${batch.id}:${batch.expiryDate?.toMillis()}:${getExpiryLevel(batch.expiryDate, now)}`,
          product: { ...product, expiryDate: batch.expiryDate, stockQuantity: batch.quantity },
          expiry: true,
          lowStock: false,
          expired: batchDays < 0,
          days: batchDays,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
        })
      }
      if (lowStock)
        alerts.push({
          id: `stock:${product.id}:${product.stockQuantity === 0 ? 'out' : 'low'}`,
          product,
          expiry: false,
          lowStock: true,
          expired: false,
          days: Infinity,
        })
    } else {
      const expiry = product.stockQuantity > 0 && days <= 30
      if (expiry || lowStock)
        alerts.push({
          id: `${product.id}:${product.expiryDate?.toMillis() ?? 'no-expiry'}:${expiry ? getExpiryLevel(product.expiryDate, now) : 'stock'}:${product.stockQuantity === 0 ? 'out' : lowStock ? 'low' : 'normal'}`,
          product,
          expiry,
          lowStock,
          expired: expiry && days < 0,
          days,
        })
    }
  }
  return alerts.sort(
    (a, b) =>
      Number(b.expired) - Number(a.expired) ||
      a.days - b.days ||
      a.product.name.localeCompare(b.product.name)
  )
}
const eventName = 'smart-expiry:notification-read'
export function useNotificationReads(uid: string) {
  const key = `smart-expiry:${uid}:read-notifications`
  const [state, setState] = useState<{ key: string; ids: string[] }>({ key: '', ids: [] })
  useEffect(() => {
    if (!uid) return
    const load = () => {
      let ids: string[] = []
      try {
        const data: unknown = JSON.parse(localStorage.getItem(key) || '[]')
        if (Array.isArray(data))
          ids = data.filter((value): value is string => typeof value === 'string').slice(-1000)
      } catch {
        /* reading alerts works without browser storage */
      }
      setState({ key, ids })
    }
    const changed = (event: Event) => {
      if (event instanceof StorageEvent) {
        if (event.key === key) load()
        return
      }
      const detail = (event as CustomEvent<{ key: string; ids: string[] }>).detail
      if (detail?.key === key && Array.isArray(detail.ids)) setState({ key, ids: detail.ids })
    }
    queueMicrotask(load)
    window.addEventListener('storage', changed)
    window.addEventListener(eventName, changed)
    return () => {
      window.removeEventListener('storage', changed)
      window.removeEventListener(eventName, changed)
    }
  }, [key, uid])
  const ids = state.key === key ? state.ids : []
  function update(next: string[]) {
    if (!uid) return
    const values = [...new Set(next)].slice(-1000)
    setState({ key, ids: values })
    try {
      localStorage.setItem(key, JSON.stringify(values))
    } catch {
      /* session-only read state remains available */
    }
    window.dispatchEvent(new CustomEvent(eventName, { detail: { key, ids: values } }))
  }
  return {
    readIds: ids,
    markRead: (id: string) => update([...ids, id]),
    markUnread: (id: string) => update(ids.filter((value) => value !== id)),
    markAllRead: (values: string[]) => update([...ids, ...values]),
  }
}
