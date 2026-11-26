import { useState } from 'react'
import { useEffect } from 'react'

import { useAuth, useInventory } from '../../lib/app-context'
import {
  currentMonth,
  exportCsv,
  formatDate,
  getErrorMessage,
  getExpiryLevel,
  isPromotionActive,
  money,
  printReport,
  notificationRequest,
  type Sale,
  type StockHistory,
} from '../../lib/firebase'
import { useMonthlyLedger } from '../../lib/hooks'
import { LoadingSkeleton } from '../../lib/loading-skeleton'
import { openingBatch } from '../../lib/retail-store'
import { ProtectedPage, InventoryNotice, ErrorNotice, secondaryClass, inputClass } from '../layout'

type InventoryArchive = {
  month: string
  asOf: string
  timeZone: string
  rows: {
    productId: string
    name: string
    category: string
    quantity: number
    purchasePrice: number
    stockValueMinor?: number
    expiryDate: string | null
  }[]
}
export default function ReportsPage() {
  return (
    <ProtectedPage>
      <Reports />
    </ProtectedPage>
  )
}
function Reports() {
  const { user } = useAuth()
  const inventory = useInventory()
  const [month, setMonth] = useState(() => currentMonth())
  const [view, setView] = useState('inventory')
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [archive, setArchive] = useState<{
    month: string
    data: InventoryArchive | null
    error: string
  }>({ month: '', data: null, error: '' })
  const [archiveAttempt, retryArchive] = useState(0)
  useEffect(() => {
    if (!user || view !== 'month-inventory') return
    let cancelled = false
    void notificationRequest<{ snapshot: InventoryArchive | null }>(
      `/inventory-snapshot?month=${encodeURIComponent(month)}`
    )
      .then((result) => {
        if (!cancelled) setArchive({ month, data: result.snapshot, error: '' })
      })
      .catch((cause) => {
        if (!cancelled) setArchive({ month, data: null, error: getErrorMessage(cause) })
      })
    return () => {
      cancelled = true
    }
  }, [month, view, archiveAttempt, user])
  const sales = useMonthlyLedger<Sale>('sales', month)
  const movements = useMonthlyLedger<StockHistory>('StockHistory', month)
  const purchases = movements.rows.filter(
    (row) =>
      row.changeType === 'Restock' &&
      row.newQuantity > row.previousQuantity &&
      row.movementSource !== 'opening' &&
      row.movementSource !== 'customer-return' &&
      row.movementSource !== 'migration' &&
      row.reason !== 'Initial inventory'
  )
  const knownCosts = purchases.filter((row) => typeof row.totalCost === 'number')
  const cents = (amount: number) => Math.round(amount * 100)
  const revenue = sales.rows.reduce((sum, sale) => sum + cents(sale.totalAmount), 0) / 100
  const purchaseCost = knownCosts.reduce((sum, row) => sum + cents(row.totalCost!), 0) / 100
  const summaries = new Map<
    string,
    { name: string; units: number; revenue: number; promoUnits: number; promoRevenue: number }
  >()
  for (const sale of sales.rows) {
    const item = summaries.get(sale.productId) || {
      name: sale.productName,
      units: 0,
      revenue: 0,
      promoUnits: 0,
      promoRevenue: 0,
    }
    item.units += sale.quantity
    item.revenue += cents(sale.totalAmount)
    if (sale.promotionApplied) {
      item.promoUnits += sale.quantity
      item.promoRevenue += cents(sale.totalAmount)
    }
    summaries.set(sale.productId, item)
  }
  let headers: string[], rows: (string | number)[][]
  if (view === 'sales') {
    headers = ['Product ID', 'Product', 'Units sold', 'Revenue LKR']
    rows = [...summaries.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .map(([id, item]) => [id, item.name, item.units, (item.revenue / 100).toFixed(2)])
  } else if (view === 'purchases') {
    headers = [
      'Date',
      'Product ID',
      'Product',
      'Units received',
      'Unit cost LKR',
      'Total cost LKR',
      'Reason',
    ]
    rows = purchases.map((row) => [
      row.timestamp.toDate().toLocaleString('en-GB'),
      row.productId,
      row.productName,
      row.newQuantity - row.previousQuantity,
      row.unitCost?.toFixed(2) ?? 'Not recorded',
      row.totalCost?.toFixed(2) ?? 'Not recorded',
      row.reason,
    ])
  } else if (view === 'promotions') {
    headers = [
      'Product ID',
      'Product',
      'Promotion status now',
      'Promo units sold in month',
      'Promo revenue LKR',
    ]
    const ids = new Set([
      ...inventory.products
        .filter((product) => product.onPromotion)
        .map((product) => product.productId),
      ...[...summaries].filter(([, item]) => item.promoUnits > 0).map(([id]) => id),
    ])
    rows = [...ids].map((id) => {
      const product = inventory.products.find((item) => item.productId === id)
      const sold = summaries.get(id)
      return [
        id,
        product?.name || sold?.name || id,
        product && isPromotionActive(product)
          ? 'Active'
          : product?.onPromotion
            ? 'Scheduled / ended'
            : 'Not active',
        sold?.promoUnits || 0,
        ((sold?.promoRevenue || 0) / 100).toFixed(2),
      ]
    })
  } else if (view === 'month-inventory') {
    headers = [
      'Product ID',
      'Product',
      'Category',
      'Month-end stock',
      'Purchase price LKR',
      'Stock value LKR',
      'Expiry',
    ]
    rows = (archive.month === month ? archive.data?.rows || [] : []).map((product) => [
      product.productId,
      product.name,
      product.category,
      product.quantity,
      product.purchasePrice.toFixed(2),
      (product.stockValueMinor !== undefined
        ? product.stockValueMinor / 100
        : product.quantity * product.purchasePrice
      ).toFixed(2),
      product.expiryDate
        ? new Date(product.expiryDate).toLocaleDateString('en-GB', {
            timeZone: archive.data?.timeZone || 'Asia/Colombo',
          })
        : 'No expiry date',
    ])
  } else {
    headers = [
      'Product ID',
      'Product',
      'Category',
      'Stock now',
      'Purchase price LKR',
      'Stock value LKR',
      'Expiry',
      'Expiry status',
    ]
    headers = [
      'Product ID',
      'Product',
      'Category',
      'Batch',
      'Supplier',
      'Stock now',
      'Unit cost LKR',
      'Stock value LKR',
      'Expiry',
      'Expiry status',
    ]
    rows = inventory.products.flatMap((product) =>
      (product.batchManaged
        ? inventory.batches.filter((batch) => batch.productId === product.id && batch.quantity > 0)
        : [openingBatch(product)]
      )
        .filter(
          (batch) =>
            view !== 'expiry' ||
            (batch.quantity > 0 &&
              !['safe', 'no-expiry'].includes(getExpiryLevel(batch.expiryDate)))
        )
        .map((batch) => [
          product.productId,
          product.name,
          product.category,
          batch.batchNumber,
          batch.supplierName || 'Not recorded',
          batch.quantity,
          (batch.unitCostMinor / 100).toFixed(2),
          ((batch.quantity * batch.unitCostMinor) / 100).toFixed(2),
          formatDate(batch.expiryDate),
          getExpiryLevel(batch.expiryDate),
        ])
    )
  }
  const monthly = ['sales', 'purchases', 'promotions', 'month-inventory'].includes(view)
  const waiting =
    inventory.loading ||
    (monthly && (sales.loading || movements.loading)) ||
    (view === 'month-inventory' && archive.month !== month)
  const stale = inventory.stale || (monthly && (sales.stale || movements.stale))
  const sourceError =
    inventory.error ||
    (monthly ? sales.error || movements.error : '') ||
    (view === 'month-inventory' ? archive.error : '')
  const archiveMissing = view === 'month-inventory' && archive.month === month && !archive.data
  const description =
    view === 'month-inventory'
      ? archive.data
        ? `Archived inventory as of ${new Date(archive.data.asOf).toLocaleString('en-GB', { timeZone: archive.data.timeZone })} (${archive.data.timeZone}).`
        : 'No inventory archive is available for this month.'
      : view === 'inventory' || view === 'expiry'
        ? 'Current stock by batch, with actual batch costs and expiry dates. Historical balances are available in archived month-end reports.'
        : `Transactions for ${month}. Promotion status shows the current position.`
  const title = `Smart Expiry - ${view} report${monthly ? ` ${month}` : ''}`
  const days = new Map<string, number>()
  for (const sale of sales.rows) {
    const day = String(sale.timestamp.toDate().getDate()).padStart(2, '0')
    days.set(day, (days.get(day) || 0) + cents(sale.totalAmount))
  }
  const maximum = Math.max(1, ...days.values())
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 25)))
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
          Reports
        </h1>
        <p className="mt-2 text-[13px] text-slate-500">
          Inventory, expiry, purchase and sales reports.
        </p>
      </header>
      <InventoryNotice {...inventory} />
      <ErrorNotice message={error} />
      {view === 'month-inventory' && (
        <>
          <ErrorNotice message={archive.error} />
          {archive.error && (
            <button className={secondaryClass} onClick={() => retryArchive((value) => value + 1)}>
              Retry archive
            </button>
          )}
        </>
      )}
      <ErrorNotice message={monthly ? sales.error || movements.error : ''} />
      {monthly && (sales.error || movements.error) && (
        <button
          className={secondaryClass}
          onClick={() => {
            sales.retry()
            movements.retry()
          }}
        >
          Retry transactions
        </button>
      )}
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
        <label className="text-[13px] font-medium">
          Report
          <select
            value={view}
            onChange={(event) => {
              setView(event.target.value)
              setPage(1)
            }}
            className={inputClass}
          >
            <option value="inventory">Inventory snapshot</option>
            <option value="month-inventory">Archived month-end inventory</option>
            <option value="expiry">Expiry report</option>
            <option value="sales">Monthly sales by product</option>
            <option value="purchases">Monthly purchases</option>
            <option value="promotions">Promotion performance</option>
          </select>
        </label>
        <label className="text-[13px] font-medium">
          Transaction month
          <input
            type="month"
            value={month}
            onChange={(event) => {
              if (event.target.value) {
                setMonth(event.target.value)
                setPage(1)
              }
            }}
            className={inputClass}
          />
        </label>
        <button
          className={secondaryClass}
          disabled={waiting || stale || !!sourceError || archiveMissing}
          onClick={() => exportCsv(`smart-expiry-${view}-${month}`, headers, rows)}
        >
          Export CSV
        </button>
        <button
          className={secondaryClass}
          disabled={waiting || stale || !!sourceError || archiveMissing}
          onClick={() => {
            try {
              printReport(title, headers, rows, description)
            } catch (cause) {
              setError(getErrorMessage(cause))
            }
          }}
        >
          Print / Save PDF
        </button>
      </div>
      <p className="text-[13px] text-slate-500">{description}</p>
      {!sales.loading && !movements.loading && !sales.error && !movements.error && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ['Revenue', money(revenue)],
              [
                'Units sold',
                sales.rows.reduce((sum, sale) => sum + sale.quantity, 0).toLocaleString(),
              ],
              ['Recorded purchase cost', money(purchaseCost)],
            ].map(([label, value]) => (
              <article
                key={label}
                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]"
              >
                <h2 className="text-[13px] text-slate-500">
                  {label} · {month}
                </h2>
                <p className="mt-3 text-2xl font-semibold">{value}</p>
              </article>
            ))}
          </div>
          {knownCosts.length < purchases.length && (
            <p className="rounded-xl bg-amber-50 p-4 text-[13px] text-amber-900">
              {purchases.length - knownCosts.length} older purchase entries have no recorded cost.
              They are excluded from the cost total.
            </p>
          )}
          {sales.rows.some((sale) => sale.promotionApplied === undefined) && (
            <p className="text-xs text-slate-500">
              Older sales without a saved promotion flag are excluded from promotion-specific
              metrics.
            </p>
          )}
          {days.size > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold">Daily revenue · {month}</h2>
              <div className="mt-4 space-y-2">
                {[...days.entries()].sort().map(([day, value]) => (
                  <div key={day} className="flex items-center gap-3 text-xs">
                    <span className="w-6">{day}</span>
                    <progress
                      value={value}
                      max={maximum}
                      aria-label={`Revenue on day ${day}: ${money(value / 100)}`}
                      className="h-4 flex-1 accent-indigo-500"
                    />
                    <span className="w-28 text-right">{money(value / 100)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
      {waiting ? (
        <LoadingSkeleton variant="report" label="Loading report" />
      ) : (
        !sourceError && (
          <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            {stale && (
              <p className="p-4 text-[13px] text-amber-800">
                Last confirmed records. Export is paused until synchronized.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">{title}</caption>
                <thead className="bg-slate-50 text-[11px] text-slate-500">
                  <tr>
                    {headers.map((heading) => (
                      <th scope="col" key={heading} className="whitespace-nowrap px-4 py-3">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice((current - 1) * 25, current * 25).map((row, index) => (
                    <tr key={index}>
                      {row.map((value, index) => (
                        <td key={index} className="px-4 py-3">
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <p className="p-8 text-center text-[13px] text-slate-500">
                No records for this report.
              </p>
            )}
            <div className="flex justify-between gap-3 border-t border-slate-200 p-4 text-[13px]">
              <span>{rows.length} rows</span>
              <div className="flex gap-2">
                <button
                  className={secondaryClass}
                  disabled={current === 1}
                  onClick={() => setPage(current - 1)}
                >
                  Previous
                </button>
                <button
                  className={secondaryClass}
                  disabled={current * 25 >= rows.length}
                  onClick={() => setPage(current + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </section>
        )
      )}
    </section>
  )
}
