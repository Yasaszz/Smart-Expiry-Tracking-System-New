import { Timestamp } from 'firebase/firestore'
import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useInventory } from '../../lib/app-context'
import {
  dateInput,
  daysUntilExpiry,
  expiryFromInput,
  formatDate,
  getErrorMessage,
  isPromotionActive,
  money,
  saveProduct,
  sellableStock,
  type Product,
  type StockHistory,
  currentMonth,
} from '../../lib/firebase'
import { useMonthlyLedger } from '../../lib/hooks'
import { LoadingSkeleton } from '../../lib/loading-skeleton'
import {
  ProtectedPage,
  InventoryNotice,
  ExpiryBadge,
  Modal,
  ErrorNotice,
  buttonClass,
  secondaryClass,
  inputClass,
} from '../layout'

export default function PromotionsPage() {
  return (
    <ProtectedPage>
      <Promotions />
    </ProtectedPage>
  )
}
function Promotions() {
  const inventory = useInventory()
  const [params] = useSearchParams()
  const [selected, setSelected] = useState(params.get('product') || '')
  const [editing, setEditing] = useState<Product | null>(null)
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState('all')
  const [historyMonth, setHistoryMonth] = useState(() => currentMonth())
  const audit = useMonthlyLedger<StockHistory>('StockHistory', historyMonth)
  const available = !inventory.loading && !inventory.stale && !inventory.error
  const products = inventory.products.filter(
    (product) => product.onPromotion && (filter !== 'active' || isPromotionActive(product))
  )
  const inlineHistory = inventory.products
    .flatMap((product) => (product.promotionHistory || []).map((event) => ({ ...event, product })))
    .filter((event) => currentMonth(event.changedAt.toDate()) === historyMonth)
  const immutableHistory = audit.rows
    .filter((row) => row.promotionEvent)
    .map((row) => ({
      ...row.promotionEvent!,
      product: { id: row.productId, productId: row.productId, name: row.productName },
    }))
  const history = [
    ...new Map(
      [...inlineHistory, ...immutableHistory].map((event) => [
        `${event.product.productId}:${event.changedAt.toMillis()}`,
        event,
      ])
    ).values(),
  ].sort((a, b) => b.changedAt.toMillis() - a.changedAt.toMillis())
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
          Promotions
        </h1>
        <p className="mt-2 text-[13px] text-slate-500">
          Manage discount prices, promotion dates and history.
        </p>
      </header>
      <InventoryNotice {...inventory} />
      {message && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-[13px] text-emerald-800">
          {message}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
        <label className="min-w-64 flex-1 text-[13px] font-medium">
          Choose a product
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            className={inputClass}
          >
            <option value="">Select a product</option>
            {inventory.products
              .filter((product) => sellableStock(product) > 0)
              .sort(
                (a, b) =>
                  (a.expiryDate?.toMillis() ?? Infinity) - (b.expiryDate?.toMillis() ?? Infinity)
              )
              .map((product) => (
                <option key={product.id} value={product.productId}>
                  {product.productId} - {product.name} (
                  {product.expiryDate
                    ? `${daysUntilExpiry(product.expiryDate)} days left`
                    : 'No expiry date'}
                  )
                </option>
              ))}
          </select>
        </label>
        <button
          disabled={!available || !selected}
          className={buttonClass}
          onClick={() => {
            const product = inventory.products.find((item) => item.productId === selected)
            if (product) setEditing(product)
          }}
        >
          Create / edit promotion
        </button>
      </div>
      <label className="block max-w-xs text-[13px] font-medium">
        Show
        <select
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className={inputClass}
        >
          <option value="all">All enabled promotions</option>
          <option value="active">Active now</option>
        </select>
      </label>
      {inventory.loading && !inventory.error && (
        <LoadingSkeleton variant="cards" label="Loading promotions" />
      )}
      {!inventory.loading && !inventory.error && (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {products.map((product) => (
              <article
                key={product.id}
                className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold">{product.name}</h2>
                  <ExpiryBadge product={product} />
                </div>
                <p className="text-xs text-slate-500">{product.productId}</p>
                <p className="text-2xl font-semibold text-indigo-700">
                  {money(product.promoPrice)}{' '}
                  <span className="text-[13px] font-normal text-slate-400 line-through">
                    {money(product.sellingPrice)}
                  </span>
                </p>
                <p className="text-[13px] text-slate-600">
                  {product.promotionStartDate
                    ? formatDate(product.promotionStartDate)
                    : 'No start limit'}{' '}
                  -{' '}
                  {product.promotionEndDate
                    ? formatDate(product.promotionEndDate)
                    : 'Until disabled / product expires'}
                </p>
                <p
                  className={`text-[13px] font-semibold ${isPromotionActive(product) ? 'text-emerald-700' : 'text-slate-500'}`}
                >
                  {isPromotionActive(product) ? 'Active now' : 'Scheduled or ended'}
                </p>
                <button
                  disabled={!available}
                  className={secondaryClass}
                  onClick={() => setEditing(product)}
                >
                  Manage promotion
                </button>
              </article>
            ))}
          </div>
          {!products.length && (
            <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
              No promotions match this view.
            </p>
          )}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold">Promotion history</h2>
            <label className="mt-4 block max-w-xs text-[13px]">
              History month
              <input
                type="month"
                value={historyMonth}
                onChange={(event) => {
                  if (event.target.value) setHistoryMonth(event.target.value)
                }}
                className={inputClass}
              />
            </label>
            <ErrorNotice message={audit.error} />
            {audit.error && (
              <button className={secondaryClass} onClick={audit.retry}>
                Retry history
              </button>
            )}
            {audit.loading && (
              <div className="mt-4">
                <LoadingSkeleton rows={3} label="Loading promotion history" />
              </div>
            )}
            {history.length ? (
              <ul className="mt-4 divide-y divide-slate-100">
                {history.map((event, index) => (
                  <li
                    key={`${event.product.id}-${index}`}
                    className="flex flex-wrap justify-between gap-3 py-4 text-[13px]"
                  >
                    <div>
                      <p className="font-semibold">
                        {event.product.name} · {event.enabled ? 'Enabled / updated' : 'Disabled'}
                      </p>
                      <p className="mt-1 text-slate-500">
                        {event.changedAt.toDate().toLocaleString('en-GB')} · {event.userId}
                      </p>
                    </div>
                    <p>
                      {event.enabled
                        ? `${money(event.price)} · ${event.discountPercent}% off`
                        : 'Regular pricing restored'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              !audit.loading &&
              !audit.error && (
                <p className="mt-4 text-[13px] text-slate-500">
                  No promotion changes have been recorded yet.
                </p>
              )
            )}
          </section>
        </>
      )}
      {editing && (
        <PromotionForm
          product={editing}
          suggestedDiscount={Number(params.get('discount'))}
          available={!!available}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setMessage('Promotion saved.')
          }}
        />
      )}
    </section>
  )
}
function PromotionForm({
  product,
  suggestedDiscount,
  available,
  onClose,
  onSaved,
}: {
  product: Product
  suggestedDiscount?: number
  available: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [enabled, setEnabled] = useState(true)
  const [discount, setDiscount] = useState(
    suggestedDiscount && suggestedDiscount > 0 && suggestedDiscount <= 100
      ? String(suggestedDiscount)
      : product.onPromotion && product.sellingPrice
        ? String(Math.round((1 - product.promoPrice / product.sellingPrice) * 10000) / 100)
        : '10'
  )
  const [start, setStart] = useState(
    product.promotionStartDate ? dateInput(product.promotionStartDate) : dateInput(Timestamp.now())
  )
  const [end, setEnd] = useState(
    product.promotionEndDate ? dateInput(product.promotionEndDate) : dateInput(product.expiryDate)
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const promoPrice = Math.round(product.sellingPrice * (1 - Number(discount) / 100) * 100) / 100
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !available) return
    setBusy(true)
    setError('')
    try {
      if (enabled && (!(Number(discount) > 0) || Number(discount) > 100))
        throw new Error('Discount must be greater than 0 and at most 100%.')
      await saveProduct(
        {
          name: product.name,
          category: product.category,
          stockQuantity: product.stockQuantity,
          purchasePrice: product.purchasePrice,
          sellingPrice: product.sellingPrice,
          expiryDate: product.expiryDate,
          barcode: product.barcode || '',
          imageUrl: product.imageUrl || '',
          lowStockThreshold: product.lowStockThreshold ?? 5,
          onPromotion: enabled,
          promoPrice: enabled ? promoPrice : 0,
          promotionStartDate: enabled ? expiryFromInput(start) : null,
          promotionEndDate: enabled ? expiryFromInput(end) : null,
        },
        product
      )
      onSaved()
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={`Promotion: ${product.name}`} busy={busy} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <ErrorNotice message={error} />
        <fieldset disabled={busy} className="space-y-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable promotion
          </label>
          {enabled && (
            <>
              <label className="block text-[13px] font-medium">
                Discount percentage
                <input
                  type="number"
                  required
                  min="0.01"
                  max="100"
                  step="0.01"
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                  className={inputClass}
                />
              </label>
              <p className="rounded-xl bg-indigo-50 p-4 font-semibold text-indigo-800">
                Promotional price: {money(Number.isFinite(promoPrice) ? promoPrice : 0)}
              </p>
              <label className="block text-[13px] font-medium">
                Start date
                <input
                  required
                  type="date"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-[13px] font-medium">
                End date
                <input
                  required
                  type="date"
                  min={start}
                  max={
                    !product.batchManaged && product.expiryDate
                      ? dateInput(product.expiryDate)
                      : undefined
                  }
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className={inputClass}
                />
              </label>
            </>
          )}
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} className={secondaryClass} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !available} className={buttonClass}>
            {busy ? 'Saving...' : 'Save promotion'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
