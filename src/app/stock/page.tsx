import { collection, doc } from 'firebase/firestore'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useAuth, useInventory } from '../../lib/app-context'
import FefoPreview from '../../lib/fefo-preview'
import {
  getErrorMessage,
  db,
  sellableStock,
  money,
  effectivePrice,
  isPromotionActive,
  recordSale,
  subscribeToHistory,
  updateStock,
  type Product,
  type StockHistory,
} from '../../lib/firebase'
import { LoadingSkeleton } from '../../lib/loading-skeleton'
import SalesHistory from '../../lib/sales-history'
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

export default function StockPage() {
  return (
    <ProtectedPage>
      <Stock />
    </ProtectedPage>
  )
}

function Stock() {
  const { user } = useAuth()

  const [params] = useSearchParams()

  const inventory = useInventory()

  const [search, setSearch] = useState(() => params.get('search') || '')

  const [page, setPage] = useState(1)

  const [action, setAction] = useState<{ product: Product; mode: 'stock' | 'sale' } | null>(null)

  const [success, setSuccess] = useState('')

  const [history, setHistory] = useState<StockHistory[] | null>(null)

  const [historyStale, setHistoryStale] = useState(true)

  const [historyError, setHistoryError] = useState('')

  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return

    return subscribeToHistory(
      (rows, stale) => {
        setHistoryStale(stale)

        if (!stale) {
          setHistory(rows)

          setHistoryError('')
        }
      },

      (cause) => setHistoryError(getErrorMessage(cause))
    )
  }, [attempt, user])

  const available = !inventory.loading && !inventory.stale && !inventory.error

  const filtered = inventory.products.filter((product) =>
    `${product.name} ${product.productId}`.toLowerCase().includes(search.trim().toLowerCase())
  )

  const pages = Math.max(1, Math.ceil(filtered.length / 20))

  const currentPage = Math.min(page, pages)

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
          Stock & sales
        </h1>

        <p className="mt-2 text-[13px] text-slate-500">
          Record FEFO sales and review batch stock movements.
        </p>
      </header>

      <InventoryNotice {...inventory} />

      {success && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-[13px] text-emerald-800">
          {success}
        </p>
      )}

      <label htmlFor="stock-search" className="block max-w-md text-[13px] font-medium">
        Find a product
        <input
          id="stock-search"

          type="search"

          placeholder="Search by name or product ID"

          value={search}

          onChange={(event) => {
            setSearch(event.target.value)

            setPage(1)
          }}

          className={inputClass}
        />
      </label>

      {inventory.loading && !inventory.error && (
        <LoadingSkeleton variant="table" label="Loading stock" />
      )}

      {!inventory.loading && !inventory.error && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">Current stock and sale actions</caption>

              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                <tr>
                  {[
                    'Product',

                    'Category',

                    'Current stock',

                    'Unit sale price',

                    'Expiry',

                    'Actions',
                  ].map((value) => (
                    <th key={value} scope="col" className="whitespace-nowrap px-5 py-4">
                      {value}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {filtered.slice((currentPage - 1) * 20, currentPage * 20).map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <p className="font-semibold">{product.name}</p>

                      <p className="mt-1 text-xs text-slate-500">{product.productId}</p>
                    </td>

                    <td className="px-5 py-4">{product.category}</td>

                    <td className="px-5 py-4">
                      <span
                        className={`font-semibold ${product.stockQuantity === 0 ? 'text-red-700' : 'text-slate-900'}`}
                      >
                        {product.stockQuantity}
                      </span>

                      {product.stockQuantity === 0 && (
                        <p className="text-xs text-red-700">Out of stock</p>
                      )}

                      {product.batchManaged && (
                        <p className="mt-1 text-xs text-slate-500">
                          Sellable: {sellableStock(product)} · Expired:{' '}
                          {product.stockQuantity - sellableStock(product)}
                        </p>
                      )}

                      {product.stockQuantity > 0 &&
                        product.stockQuantity <= (product.lowStockThreshold ?? 5) && (
                          <p className="text-xs font-medium text-amber-800">
                            Low stock (threshold {product.lowStockThreshold ?? 5})
                          </p>
                        )}
                    </td>

                    <td className="whitespace-nowrap px-5 py-4">
                      {money(effectivePrice(product))}

                      {isPromotionActive(product) && (
                        <p className="text-xs text-indigo-600">Promotion</p>
                      )}
                    </td>

                    <td className="px-5 py-4">
                      <ExpiryBadge product={product} />
                    </td>

                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <Link
                          className={`${secondaryClass} whitespace-nowrap`}

                          to={'/batches?product=' + product.id}
                        >
                          Manage batches
                        </Link>

                        <button
                          className="whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-indigo-600 hover:bg-indigo-50 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-40"

                          disabled={!available || sellableStock(product) === 0}

                          onClick={() => {
                            setAction({ product, mode: 'sale' })

                            setSuccess('')
                          }}
                        >
                          Record sale
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!filtered.length && (
            <p className="p-10 text-center text-[13px] text-slate-500">
              {inventory.products.length
                ? 'No products match your search.'
                : 'No stock records yet. Create a product on the Products page.'}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-[13px]">
            <span>
              {filtered.length} products · Page {currentPage} of {pages}
            </span>

            <div className="flex gap-2">
              <button
                className={secondaryClass}

                disabled={currentPage === 1}

                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>

              <button
                className={secondaryClass}

                disabled={currentPage === pages}

                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
        <div className="border-b border-slate-200 p-6">
          <h2 className="text-base font-semibold">Recent stock history</h2>

          <p className="mt-1 text-[13px] text-slate-500">Last 50 stock changes.</p>
        </div>

        <div className="p-4">
          <ErrorNotice message={historyError} />

          {historyError && (
            <button
              className={`${secondaryClass} mt-3`}

              onClick={() => setAttempt((value) => value + 1)}
            >
              Reconnect history
            </button>
          )}

          {!history && !historyError && <LoadingSkeleton rows={3} label="Loading stock history" />}

          {history && historyStale && (
            <p className="text-[13px] text-amber-800">
              Showing the last confirmed history while reconnecting.
            </p>
          )}
        </div>

        {history &&
          !historyError &&
          (history.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">Recent stock changes</caption>

                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                  <tr>
                    {['Time', 'Product', 'Change', 'Before', 'After', 'Reason'].map((value) => (
                      <th key={value} scope="col" className="px-5 py-4">
                        {value}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-5 py-4">
                        {row.timestamp?.toDate
                          ? row.timestamp.toDate().toLocaleString('en-GB')
                          : 'Timestamp unavailable'}
                      </td>

                      <td className="px-5 py-4">
                        <p className="font-medium">{row.productName}</p>

                        <p className="text-xs text-slate-500">{row.productId}</p>
                      </td>

                      <td className="px-5 py-4">{row.movementType || row.changeType}</td>

                      <td className="px-5 py-4">{row.previousQuantity}</td>

                      <td className="px-5 py-4">{row.newQuantity}</td>

                      <td className="max-w-xs break-words px-5 py-4">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-8 text-center text-[13px] text-slate-500">
              No stock changes have been recorded.
            </p>
          ))}
      </section>

      <SalesHistory />

      {action && (
        <StockForm
          {...action}

          available={!!available}

          onClose={() => setAction(null)}

          onSaved={() => {
            setSuccess(action.mode === 'sale' ? 'Sale recorded.' : 'Stock updated.')

            setAction(null)
          }}
        />
      )}
    </section>
  )
}

function StockForm({
  product,

  mode,

  available,

  onClose,

  onSaved,
}: {
  product: Product

  mode: 'stock' | 'sale'

  available: boolean

  onClose: () => void

  onSaved: () => void
}) {
  const [quantity, setQuantity] = useState(mode === 'sale' ? '1' : String(product.stockQuantity))

  const [type, setType] = useState<'Restock' | 'Adjustment' | 'Damage' | 'Return'>('Restock')

  const [unitCost, setUnitCost] = useState(String(product.purchasePrice))

  const [reason, setReason] = useState('')

  const [customer, setCustomer] = useState('')

  const [busy, setBusy] = useState(false)

  const [error, setError] = useState('')

  const price = effectivePrice(product)

  const inventory = useInventory()

  const saleRequest = useRef(doc(collection(db, 'sales')).id)

  const batchesReady = !inventory.batchLoading && !inventory.batchStale && !inventory.batchError

  async function submit(event: FormEvent) {
    event.preventDefault()

    if (busy || !available) return

    setBusy(true)

    setError('')

    try {
      if (mode === 'sale')
        await recordSale(product, Number(quantity), customer, price, saleRequest.current)
      else
        await updateStock(
          product,

          Number(quantity),

          type,

          reason,

          type === 'Restock' ? Number(unitCost) : undefined
        )

      onSaved()
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={mode === 'sale' ? 'Record sale' : 'Update stock'} busy={busy} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <div className="rounded-xl bg-indigo-50 p-4">
          <p className="font-semibold text-indigo-950">
            {product.name} · {product.productId}
          </p>

          <p className="mt-1 text-[13px] text-indigo-800">
            Stock when opened: {product.stockQuantity} units
          </p>
        </div>

        <ErrorNotice message={error} />

        {!available && (
          <p className="text-[13px] text-amber-800">
            Saving is unavailable until inventory is synchronized.
          </p>
        )}

        <fieldset disabled={busy} className="space-y-4">
          <label htmlFor="stock-quantity" className="block text-[13px] font-medium">
            {mode === 'sale' ? 'Quantity sold' : 'New total stock quantity'}

            <input
              id="stock-quantity"

              type="number"

              required

              min={mode === 'sale' ? 1 : 0}

              max={mode === 'sale' ? sellableStock(product) : Number.MAX_SAFE_INTEGER}

              step="1"

              value={quantity}

              onChange={(event) => setQuantity(event.target.value)}

              className={inputClass}
            />
          </label>

          {mode === 'stock' ? (
            <>
              <label htmlFor="stock-type" className="block text-[13px] font-medium">
                Change type
                <select
                  id="stock-type"

                  value={type}

                  onChange={(event) => setType(event.target.value as typeof type)}

                  className={inputClass}
                >
                  <option>Restock</option>

                  <option>Return</option>

                  <option>Adjustment</option>

                  <option>Damage</option>
                </select>
              </label>

              {type === 'Restock' && (
                <label className="block text-[13px] font-medium">
                  Purchase unit cost (LKR)
                  <input
                    required

                    type="number"

                    min="0"

                    step="0.01"

                    max="10000000000"

                    value={unitCost}

                    onChange={(event) => setUnitCost(event.target.value)}

                    className={inputClass}
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    Saved with this delivery for purchase reports.
                  </span>
                </label>
              )}

              {type === 'Return' && (
                <p className="text-xs text-slate-500">
                  Adds customer-returned units to stock. It does not issue a refund or modify the
                  original sale.
                </p>
              )}

              <label htmlFor="stock-reason" className="block text-[13px] font-medium">
                Reason
                <textarea
                  id="stock-reason"

                  required

                  maxLength={500}

                  rows={3}

                  value={reason}

                  onChange={(event) => setReason(event.target.value)}

                  className={inputClass}
                />
              </label>

              <p className="text-xs text-slate-500">
                Enter the new total quantity, rather than the number of units added or removed.
              </p>
            </>
          ) : (
            <>
              <label htmlFor="customer" className="block text-[13px] font-medium">
                Customer name (optional)
                <input
                  id="customer"

                  maxLength={150}

                  value={customer}

                  onChange={(event) => setCustomer(event.target.value)}

                  className={inputClass}
                />
              </label>

              <div className="rounded-xl bg-slate-50 p-4 text-[13px]">
                <div className="flex justify-between">
                  <span>Unit price</span>

                  <span>{money(price)}</span>
                </div>

                <div className="mt-3 flex justify-between border-t border-slate-200 pt-3 font-semibold">
                  <span>Total</span>

                  <span>
                    {money(Math.round(Math.round(price * 100) * (Number(quantity) || 0)) / 100)}
                  </span>
                </div>
              </div>

              <FefoPreview product={product} quantity={Number(quantity)} />
            </>
          )}
        </fieldset>

        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className={secondaryClass}>
            Cancel
          </button>

          <button
            type="submit"

            disabled={busy || !available || (mode === 'sale' && !batchesReady)}

            className={buttonClass}
          >
            {busy ? 'Saving...' : mode === 'sale' ? 'Confirm sale' : 'Save stock'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
