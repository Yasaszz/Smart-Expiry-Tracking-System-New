import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth, useInventory } from '../../lib/app-context'
import {
  db,
  formatDate,
  getErrorMessage,
  getExpiryStatus,
  getExpiryLevel,
  expiryLevels,
  isPromotionActive,
  money,
} from '../../lib/firebase'
import { LoadingSkeleton } from '../../lib/loading-skeleton'
import { openingBatch } from '../../lib/retail-store'
import { Icon, type IconName } from '../../lib/ui'
import {
  ProtectedPage,
  InventoryNotice,
  ExpiryBadge,
  ErrorNotice,
  buttonClass,
  secondaryClass,
} from '../layout'

export default function DashboardPage() {
  return (
    <ProtectedPage>
      <Dashboard />
    </ProtectedPage>
  )
}

function Dashboard() {
  const inventory = useInventory()

  const { user } = useAuth()

  const [name, setName] = useState('')

  const [profileError, setProfileError] = useState('')

  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!user) return

    return onSnapshot(
      doc(db, 'users', user.uid),

      (snapshot) => {
        const value = snapshot.data()?.name

        setName(typeof value === 'string' ? value : '')

        setProfileError(
          snapshot.exists()
            ? ''
            : 'Your profile is missing. Sign in again to finish setting up your account.'
        )
      },

      (cause) => setProfileError(getErrorMessage(cause, 'reading your profile'))
    )
  }, [user])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60000)

    return () => window.clearInterval(timer)
  }, [])

  const batchProducts = inventory.products.flatMap((product) =>
    product.batchManaged
      ? inventory.batches

          .filter((batch) => batch.productId === product.id && batch.quantity > 0)

          .map((batch) => ({
            ...product,

            id: batch.id,

            name: `${product.name} · ${batch.batchNumber}`,

            stockQuantity: batch.quantity,

            expiryDate: batch.expiryDate,
          }))
      : product.stockQuantity > 0
        ? [{ ...product, ...{ id: openingBatch(product).id } }]
        : []
  )

  const alerts = batchProducts

    .filter((product) => ['expired', 'near'].includes(getExpiryStatus(product.expiryDate, now)))

    .sort((a, b) => (a.expiryDate?.toMillis() ?? Infinity) - (b.expiryDate?.toMillis() ?? Infinity))

  const lowStock = inventory.products

    .filter((product) => product.stockQuantity <= (product.lowStockThreshold ?? 5))

    .sort((a, b) => a.stockQuantity - b.stockQuantity)

  const recent = [...inventory.products]

    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())

    .slice(0, 5)

  const stats: { label: string; value: string; note: string; icon: IconName }[] = [
    {
      label: 'Total products',

      value: inventory.products.length.toLocaleString(),

      note: 'Registered product records',

      icon: 'box',
    },

    {
      label: 'Stock value',

      value: money(
        inventory.products.reduce(
          (total, product) =>
            total +
            (product.stockValueMinor !== undefined
              ? product.stockValueMinor / 100
              : product.stockQuantity * product.purchasePrice),

          0
        )
      ),

      note: 'At recorded purchase prices',

      icon: 'stock',
    },

    {
      label: 'Due within 14 days',

      value: batchProducts

        .filter((product) => getExpiryStatus(product.expiryDate, now) === 'near')

        .length.toLocaleString(),

      note: 'Stock batches; excludes expired stock',

      icon: 'calendar',
    },

    {
      label: 'Active promotions',

      value: inventory.products

        .filter((product) => isPromotionActive(product, now) && product.stockQuantity > 0)

        .length.toLocaleString(),

      note: 'Current promotions with stock',

      icon: 'tag',
    },
  ]

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
            Overview
          </h1>

          <p className="mt-2 text-[13px] text-slate-500">
            {name ? `${name} · ` : ''}Inventory status and items requiring action.
          </p>
        </div>

        <div className="flex gap-2">
          <Link to="/stock" className={secondaryClass}>
            Manage stock
          </Link>

          <Link to="/products?add=1" className={buttonClass}>
            <Icon name="plus" className="h-4 w-4" />
            Add product
          </Link>
        </div>
      </header>

      <ErrorNotice message={profileError} />

      <InventoryNotice {...inventory} />

      {inventory.loading && !inventory.error && (
        <LoadingSkeleton variant="dashboard" label="Loading overview" />
      )}

      {!inventory.loading && !inventory.error && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => (
              <article
                key={stat.label}

                className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-[12px] font-medium text-slate-500">{stat.label}</h2>

                  <Icon name={stat.icon} className="h-[18px] w-[18px] text-slate-500" />
                </div>

                <p className="mt-5 break-words text-[28px] font-semibold leading-tight tracking-tight tabular-nums">
                  {stat.value}
                </p>

                <p className="mt-2 text-[11px] text-slate-500">{stat.note}</p>
              </article>
            ))}
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold">Expiry watch</h2>

                  <p className="mt-1 text-xs text-slate-500">
                    Expired products and products due within 14 days.
                  </p>
                </div>

                <Link
                  to="/notifications"

                  className="shrink-0 text-xs font-medium text-indigo-600 hover:underline"
                >
                  View alerts
                </Link>
              </div>

              {alerts.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead className="border-b border-slate-100 bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-500">
                      <tr>
                        {['Product', 'Stock', 'Expiry date', 'Status', ''].map((heading, index) => (
                          <th scope="col" key={index} className="whitespace-nowrap px-5 py-3">
                            {heading || <span className="sr-only">Action</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {alerts.slice(0, 8).map((product) => (
                        <tr key={product.id} className="hover:bg-slate-50/70">
                          <td className="px-5 py-4">
                            <Link
                              to={`/products?search=${encodeURIComponent(product.productId)}`}

                              className="font-medium text-slate-800 hover:text-indigo-600"
                            >
                              {product.name}
                            </Link>

                            <p className="mt-1 text-[11px] text-slate-500">{product.productId}</p>
                          </td>

                          <td className="px-5 py-4 tabular-nums">{product.stockQuantity}</td>

                          <td className="whitespace-nowrap px-5 py-4 text-slate-500">
                            {formatDate(product.expiryDate)}
                          </td>

                          <td className="px-5 py-4">
                            <ExpiryBadge product={product} />
                          </td>

                          <td className="whitespace-nowrap px-5 py-4">
                            {getExpiryStatus(product.expiryDate, now) !== 'expired' &&
                            product.stockQuantity > 0 ? (
                              <Link
                                to={`/promotions?product=${encodeURIComponent(product.productId)}`}

                                className="text-xs font-medium text-indigo-600 hover:underline"
                              >
                                Set promotion
                              </Link>
                            ) : (
                              <span className="text-xs text-slate-500">Review stock</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="px-5 py-12 text-center">
                  <Icon name="calendar" className="mx-auto h-7 w-7 text-slate-300" />

                  <p className="mt-3 text-sm font-medium text-slate-600">No expiry alerts</p>

                  <p className="mt-1 text-xs text-slate-500">
                    {inventory.products.length
                      ? 'No products are expired or due within 14 days.'
                      : 'Add products to begin tracking expiry dates.'}
                  </p>
                </div>
              )}

              {alerts.length > 8 && (
                <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                  Showing 8 of {alerts.length} stock batches.
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-semibold">Stock attention</h2>

                <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium tabular-nums text-slate-500">
                  {lowStock.length}
                </span>
              </div>

              {lowStock.length ? (
                <ul className="divide-y divide-slate-100">
                  {lowStock.slice(0, 5).map((product) => (
                    <li key={product.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <Link
                          to={`/stock?search=${encodeURIComponent(product.productId)}`}

                          className="text-[13px] font-medium hover:text-indigo-600"
                        >
                          {product.name}
                        </Link>

                        <span
                          className={`shrink-0 text-xs font-semibold tabular-nums ${product.stockQuantity === 0 ? 'text-red-600' : 'text-amber-700'}`}
                        >
                          {product.stockQuantity} left
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] text-slate-500">
                        {product.productId} ·{' '}
                        {product.stockQuantity === 0
                          ? 'Out of stock'
                          : `Threshold: ${product.lowStockThreshold ?? 5}`}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-8 text-xs leading-6 text-slate-500">
                  {inventory.products.length
                    ? 'No products are below their stock threshold.'
                    : 'Stock levels appear after products are added.'}
                </p>
              )}

              <div className="border-t border-slate-100 px-5 py-3">
                <Link to="/stock" className="text-xs font-medium text-indigo-600 hover:underline">
                  View stock records
                </Link>
              </div>
            </section>
          </div>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <h2 className="text-sm font-semibold">Recent products</h2>

                <Link
                  to="/products"

                  className="text-xs font-medium text-indigo-600 hover:underline"
                >
                  View products
                </Link>
              </div>

              {recent.length ? (
                <ul className="divide-y divide-slate-100">
                  {recent.map((product) => (
                    <li
                      key={product.id}

                      className="flex items-center justify-between gap-4 px-5 py-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-slate-50 text-slate-500">
                          <Icon name="box" className="h-[18px] w-[18px]" />
                        </span>

                        <div className="min-w-0">
                          <Link
                            to={`/products?search=${encodeURIComponent(product.productId)}`}

                            className="truncate text-[13px] font-medium hover:text-indigo-600"
                          >
                            {product.name}
                          </Link>

                          <p className="mt-1 text-[11px] text-slate-500">
                            {product.productId} · {product.category}
                          </p>
                        </div>
                      </div>

                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        {formatDate(product.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-8 text-xs text-slate-500">No products recorded.</p>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
              <h2 className="text-sm font-semibold">Expiry distribution</h2>

              <p className="mt-1 text-xs text-slate-500">All registered products</p>

              <dl className="mt-5 space-y-4">
                {expiryLevels.map((level) => {
                  const count = inventory.products.filter(
                    (product) => getExpiryLevel(product.expiryDate, now) === level.value
                  ).length

                  return (
                    <div key={level.value}>
                      <div className="mb-1.5 flex justify-between text-xs">
                        <dt className="text-slate-500">{level.label}</dt>

                        <dd className="font-medium tabular-nums text-slate-700">{count}</dd>
                      </div>

                      <progress
                        aria-label={`${level.label}: ${count} products`}

                        value={count}

                        max={Math.max(inventory.products.length, 1)}

                        className="block h-1.5 w-full accent-indigo-500"
                      />
                    </div>
                  )
                })}
              </dl>
            </section>
          </div>
        </>
      )}
    </section>
  )
}
