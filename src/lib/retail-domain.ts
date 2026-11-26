import type { Timestamp } from 'firebase/firestore'

export interface Batch {
  id: string
  productId: string
  productCode: string
  productName: string
  batchNumber: string
  supplierId: string | null
  supplierName: string
  quantityReceived: number
  quantity: number
  unitCostMinor: number
  expiryDate: Timestamp | null
  receivedAt: Timestamp
  updatedAt: Timestamp
  purchaseOrderId: string | null
  notes: string
  legacy: boolean
  version: number
  operationId: string
}
export interface Supplier {
  id: string
  name: string
  contact: string
  email: string
  phone: string
  address: string
  paymentTerms: string
  notes: string
  active: boolean
  version: number
  createdAt: Timestamp
  updatedAt: Timestamp
}
export interface OrderLine {
  productId: string
  productCode: string
  productName: string
  quantity: number
  received: number
  unitCostMinor: number
}
export interface PurchaseOrder {
  id: string
  number: string
  supplierId: string
  supplierName: string
  status: 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled'
  lines: OrderLine[]
  expectedDate: Timestamp | null
  notes: string
  totalMinor: number
  receivedMinor: number
  version: number
  createdAt: Timestamp
  updatedAt: Timestamp
  createdBy: string
}
export interface SupplierReturn {
  id: string
  productId: string
  productCode: string
  productName: string
  batchId: string
  batchNumber: string
  supplierId: string
  supplierName: string
  quantity: number
  reason: string
  expectedCreditMinor: number
  creditMinor: number
  status: 'pending' | 'credited' | 'rejected'
  reference: string
  decisionNotes: string
  version: number
  createdAt: Timestamp
  settledAt: Timestamp | null
  operationId: string
}
export interface Allocation {
  batchId: string
  batchNumber: string
  quantity: number
  unitCostMinor: number
  expiryDate: Timestamp | null
}
export interface AlertEvent {
  id: string
  status: 'reviewing' | 'resolved'
  action: string
  notes: string
  userId: string
  userName: string
  at: Timestamp
  links: { collection: string; id: string }[]
}
export interface AlertResolution {
  id: string
  batchId: string
  productId: string
  condition: string
  status: 'reviewing' | 'resolved'
  responsibleId: string
  responsibleName: string
  history: AlertEvent[]
  version: number
  createdAt: Timestamp
  updatedAt: Timestamp
  resolvedAt: Timestamp | null
}
export const STORE_ZONE = 'Asia/Colombo'
export function storeDate(value: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: STORE_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}
export function expiryDays(date: Timestamp | null, now = new Date()) {
  return date
    ? Math.round((Date.parse(storeDate(date.toDate())) - Date.parse(storeDate(now))) / 86400000)
    : Infinity
}
export function minor(amount: number) {
  const result = Math.round(amount * 100)
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    Math.abs(amount * 100 - result) > 0.0001 ||
    !Number.isSafeInteger(result) ||
    result > 1e12
  )
    throw new Error('Enter a valid non-negative amount with at most two decimal places.')
  return result
}
export function whole(value: number, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > 1000000)
    throw new Error(
      'Quantity must be a whole number between ' + (positive ? 1 : 0) + ' and 1,000,000.'
    )
  return value
}
export function safeTotal(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('The inventory value exceeds the supported safe range.')
  return value
}
export function fefoCompare(a: Batch, b: Batch) {
  const aDate = a.expiryDate?.toMillis() ?? Infinity,
    bDate = b.expiryDate?.toMillis() ?? Infinity
  return (
    (aDate === bDate ? 0 : aDate < bDate ? -1 : 1) ||
    a.receivedAt.toMillis() - b.receivedAt.toMillis() ||
    a.id.localeCompare(b.id)
  )
}
export function allocateFefo(batches: Batch[], quantity: number, now = new Date()): Allocation[] {
  whole(quantity, true)
  let remaining = quantity
  const allocations: Allocation[] = []
  for (const batch of [...batches]
    .filter((item) => item.quantity > 0 && expiryDays(item.expiryDate, now) >= 0)
    .sort(fefoCompare)) {
    const take = Math.min(batch.quantity, remaining)
    if (take)
      allocations.push({
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        quantity: take,
        unitCostMinor: batch.unitCostMinor,
        expiryDate: batch.expiryDate,
      })
    remaining -= take
    if (!remaining) break
  }
  if (remaining)
    throw new Error(
      `Only ${quantity - remaining} sellable units are available. Expired stock is excluded.`
    )
  if (allocations.length > 4)
    throw new Error('This sale spans more than four batches. Record a smaller quantity per sale.')
  return allocations
}
export function batchTotals(batches: Batch[], now = new Date()) {
  const active = batches.filter((batch) => batch.quantity > 0)
  if (active.length > 40)
    throw new Error(
      'A product can have at most 40 active batches. Clear depleted or expired stock before adding another.'
    )
  const quantity = whole(active.reduce((sum, batch) => sum + batch.quantity, 0))
  const value = safeTotal(
    active.reduce((sum, batch) => sum + batch.quantity * batch.unitCostMinor, 0)
  )
  const sellable = active
    .filter((batch) => expiryDays(batch.expiryDate, now) >= 0)
    .reduce((sum, batch) => sum + batch.quantity, 0)
  const earliest =
    active.filter((batch) => batch.expiryDate).sort(fefoCompare)[0]?.expiryDate ?? null
  return {
    quantity,
    stockQuantity: quantity,
    stockValueMinor: value,
    sellableQuantity: sellable,
    expiryDate: earliest,
    activeBatchIds: active.map((batch) => batch.id).sort(),
  }
}
export function alertCondition(batch: Batch, now = new Date()) {
  const days = expiryDays(batch.expiryDate, now)
  return days < 0
    ? 'expired'
    : days <= 3
      ? 'critical'
      : days <= 7
        ? 'warning'
        : days <= 14
          ? 'near'
          : days <= 30
            ? 'approaching'
            : null
}
export function alertIdentity(batch: Batch, now = new Date()) {
  return `${batch.id}_${batch.expiryDate?.toMillis() || 0}_${alertCondition(batch, now) || 'none'}`
}
export interface Demand {
  rate: number
  units: number
  days: number
  observations: number
  warning: string
}
export function demandRate(
  sales: { quantity: number; timestamp: Timestamp }[],
  windowDays: number,
  available: boolean,
  now = new Date(),
  productCreated?: Timestamp
): Demand | null {
  if (!available) return null
  const today = Date.parse(storeDate(now)),
    start = today - (windowDays - 1) * 86400000
  const observedStart = productCreated
    ? Math.max(start, Date.parse(storeDate(productCreated.toDate())))
    : start
  const days = Math.max(1, Math.round((today - observedStart) / 86400000) + 1)
  const observations = sales.filter((sale) => {
    const day = Date.parse(storeDate(sale.timestamp.toDate()))
    return day >= observedStart && day <= today
  })
  const units = observations.reduce((sum, sale) => sum + sale.quantity, 0)
  return {
    rate: units / days,
    units,
    days,
    observations: observations.length,
    warning:
      days < 7 || observations.length < 3
        ? 'Limited history; estimate is low confidence. Sales may understate demand during stockouts.'
        : 'Recorded sales are a baseline, not demand certainty. Stockout periods may bias this estimate.',
  }
}
export function predictUnsold(batches: Batch[], demand: Demand | null, now = new Date()) {
  let demandConsumed = 0
  return [...batches]
    .filter((batch) => batch.quantity > 0 && batch.expiryDate)
    .sort(fefoCompare)
    .map((batch) => {
      const days = expiryDays(batch.expiryDate, now)
      if (days < 0)
        return {
          batch,
          days,
          predictedUnsold: null,
          costAtRiskMinor: null,
          expiredCostMinor: batch.quantity * batch.unitCostMinor,
          explanation: 'Already expired; this is an actual stock exposure, not a future forecast.',
        }
      if (!demand)
        return {
          batch,
          days,
          predictedUnsold: null,
          costAtRiskMinor: null,
          expiredCostMinor: 0,
          explanation: 'Sales data is unavailable; a zero-demand forecast was not assumed.',
        }
      // Today's remaining selling day is included. Earlier batches consume demand first.
      const cumulativeDemand = demand.rate * (days + 1)
      const expectedSales = Math.min(batch.quantity, Math.max(0, cumulativeDemand - demandConsumed))
      demandConsumed += expectedSales
      const unsold = Math.max(0, batch.quantity - expectedSales)
      return {
        batch,
        days,
        predictedUnsold: unsold,
        costAtRiskMinor: Math.round(unsold * batch.unitCostMinor),
        expiredCostMinor: 0,
        explanation: `${demand.units} recorded units / ${demand.days} calendar days = ${demand.rate.toFixed(2)} units/day. Earlier FEFO batches use demand first; ${expectedSales.toFixed(1)} of ${batch.quantity} units are estimated to sell by expiry. ${demand.warning}`,
      }
    })
}
export function simulateDiscount(
  batches: Batch[],
  sellingMinor: number,
  rate: number,
  discount: number,
  uplift: number,
  horizon: number,
  now = new Date(),
  targetBatchId?: string
) {
  if (
    ![sellingMinor, rate, discount, uplift, horizon].every(Number.isFinite) ||
    sellingMinor < 0 ||
    rate < 0 ||
    discount < 0 ||
    discount > 100 ||
    uplift < 0 ||
    uplift > 1000 ||
    !Number.isInteger(horizon) ||
    horizon < 1 ||
    horizon > 365
  )
    throw new Error('Choose valid simulation inputs (horizon 1–365 days; uplift 0–1000%).')
  const price = Math.round(sellingMinor * (1 - discount / 100))
  const eligible = [...batches]
    .filter((batch) => batch.quantity > 0 && expiryDays(batch.expiryDate, now) >= 0)
    .sort(fefoCompare)
  let consumed = 0,
    stock = 0,
    sold = 0,
    cost = 0,
    exposure = 0
  for (const batch of eligible) {
    const days = Math.min(horizon, expiryDays(batch.expiryDate, now) + 1)
    const cumulative = Math.floor(rate * (1 + uplift / 100) * days)
    const take = Math.min(batch.quantity, Math.max(0, cumulative - consumed))
    consumed += take
    if (targetBatchId && targetBatchId !== batch.id) continue
    stock += batch.quantity
    sold += take
    cost += take * batch.unitCostMinor
    exposure += (batch.quantity - take) * batch.unitCostMinor
  }
  const revenue = sold * price
  return {
    discount,
    uplift,
    price,
    sold,
    remaining: stock - sold,
    revenue,
    cost,
    profit: revenue - cost,
    margin: revenue ? ((revenue - cost) / revenue) * 100 : 0,
    exposure,
    belowCost: eligible.some(
      (batch) => (!targetBatchId || batch.id === targetBatchId) && price < batch.unitCostMinor
    ),
  }
}
