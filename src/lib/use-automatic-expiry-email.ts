import { useEffect } from 'react'

import { useAuth, useInventory } from './app-context'
import { getExpiryLevel, notificationRequest } from './firebase'

export function useAutomaticExpiryEmail() {
  const { user } = useAuth()
  const inventory = useInventory()
  const ready = !inventory.loading && !inventory.stale && !inventory.error
  const candidates = ready
    ? inventory.products
        .filter((product) => {
          const level = getExpiryLevel(product.expiryDate)
          return product.stockQuantity > 0 && (level === 'critical' || level === 'expired')
        })
        .map(
          (product) =>
            `${product.id}:${getExpiryLevel(product.expiryDate)}:${inventory.batches
              .filter((batch) => batch.productId === product.id && batch.quantity > 0)
              .map((batch) => `${batch.id}:${batch.expiryDate?.toMillis()}:${batch.quantity}`)
              .sort()
              .join(',')}`
        )
        .sort()
        .join('|')
    : ''

  useEffect(() => {
    if (!user || !ready || !candidates) return
    let active = true
    let pending = false
    async function check() {
      if (!active || pending || document.visibilityState === 'hidden' || !navigator.onLine) return
      pending = true
      try {
        const result = await notificationRequest<{ status: string }>('/check-email', {})
        if (['not-configured', 'unknown', 'failed'].includes(result.status))
          console.warn(`Expiry email delivery: ${result.status}. Check server delivery logs.`)
      } catch (error) {
        console.warn('Automatic expiry email check failed; it will retry.', error)
      } finally {
        pending = false
      }
    }
    const recheck = () => void check()
    const first = window.setTimeout(recheck, 1000)
    const timer = window.setInterval(recheck, 5 * 60000)
    window.addEventListener('focus', recheck)
    window.addEventListener('online', recheck)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      active = false
      window.clearTimeout(first)
      window.clearInterval(timer)
      window.removeEventListener('focus', recheck)
      window.removeEventListener('online', recheck)
      document.removeEventListener('visibilitychange', recheck)
    }
  }, [user, ready, candidates])
}
