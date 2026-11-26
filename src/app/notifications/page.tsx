import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useAuth, useInventory } from '../../lib/app-context'
import { formatDate } from '../../lib/firebase'
import { LoadingSkeleton } from '../../lib/loading-skeleton'
import { useRetailNow } from '../../lib/retail-hooks'
import { Icon } from '../../lib/ui'
import { buildWebNotifications, useNotificationReads } from '../../lib/web-notifications'
import { ProtectedPage, InventoryNotice, ExpiryBadge, secondaryClass } from '../layout'

export default function NotificationsPage() {
  return (
    <ProtectedPage>
      <Notifications />
    </ProtectedPage>
  )
}

function Notifications() {
  const inventory = useInventory(),
    now = useRetailNow()

  const { user } = useAuth()

  const reads = useNotificationReads(user?.uid || '')

  const [view, setView] = useState<'all' | 'unread'>('all')

  const notifications = buildWebNotifications(inventory.products, now, inventory.batches)

  const unread = notifications.filter((item) => !reads.readIds.includes(item.id))

  const visible = view === 'unread' ? unread : notifications

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
            Notifications
          </h1>

          <p className="mt-2 text-[13px] text-slate-500">
            Expiry alerts and stock updates for your store.
          </p>
        </div>

        <button
          type="button"

          disabled={
            inventory.loading || inventory.batchLoading || !!inventory.error || unread.length === 0
          }

          onClick={() => reads.markAllRead(notifications.map((item) => item.id))}

          className={secondaryClass}
        >
          <Icon name="check" className="h-4 w-4" />
          Mark all as read
        </button>
      </header>

      <InventoryNotice {...inventory} />

      {(inventory.loading || inventory.batchLoading) && !inventory.error && (
        <LoadingSkeleton variant="notifications" label="Loading notifications" />
      )}

      {!inventory.loading && !inventory.batchLoading && !inventory.error && (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5">
            <div className="flex gap-6" role="group" aria-label="Notification view">
              {(['all', 'unread'] as const).map((value) => (
                <button
                  key={value}

                  type="button"

                  aria-pressed={view === value}

                  onClick={() => setView(value)}

                  className={`border-b-2 py-4 text-[13px] font-medium ${view === value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                >
                  {value === 'all' ? 'All notifications' : 'Unread'}

                  <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] tabular-nums text-slate-500">
                    {value === 'all' ? notifications.length : unread.length}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {visible.length ? (
            <ul className="divide-y divide-slate-100">
              {visible.map((item) => {
                const isRead = reads.readIds.includes(item.id)

                return (
                  <li
                    key={item.id}

                    className={`flex items-start gap-4 px-5 py-5 ${isRead ? 'bg-white' : 'bg-indigo-50/30'}`}
                  >
                    <span
                      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.expired ? 'bg-red-50 text-red-700' : item.expiry ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}
                    >
                      <Icon
                        name={item.expiry ? 'calendar' : 'stock'}

                        className="h-[18px] w-[18px]"
                      />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[13px] font-semibold">
                          {item.product.name}

                          {item.batchNumber ? ` · ${item.batchNumber}` : ''}
                        </h2>

                        {!isRead && (
                          <span
                            aria-label="Unread"

                            className="h-1.5 w-1.5 rounded-full bg-indigo-500"
                          />
                        )}
                      </div>

                      <p className="mt-1 text-[13px] leading-6 text-slate-600">
                        {item.expired
                          ? `Expired on ${formatDate(item.product.expiryDate)}. Remove the remaining stock from sale.`
                          : item.expiry
                            ? item.days === 0
                              ? 'Expires today. Review the remaining stock.'
                              : `Expires in ${item.days} days, on ${formatDate(item.product.expiryDate)}.`
                            : item.product.stockQuantity === 0
                              ? 'Out of stock. Review replenishment requirements.'
                              : `Stock is below the threshold of ${item.product.lowStockThreshold ?? 5} units.`}
                      </p>

                      <p className="mt-1 text-xs text-slate-500">
                        {item.product.productId} · {item.product.stockQuantity} units in stock
                        {item.expiry && item.lowStock ? ' · Low stock' : ''}
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                        {item.expiry && <ExpiryBadge product={item.product} />}

                        <Link
                          onClick={() => reads.markRead(item.id)}

                          to={`${item.lowStock && !item.expiry ? '/stock' : '/products'}?search=${encodeURIComponent(item.product.productId)}`}

                          className="text-xs font-medium text-indigo-600 hover:underline"
                        >
                          View {item.lowStock && !item.expiry ? 'stock' : 'product'}
                        </Link>

                        <button
                          type="button"

                          onClick={() =>
                            isRead ? reads.markUnread(item.id) : reads.markRead(item.id)
                          }

                          className="text-xs font-medium text-slate-500 hover:text-slate-800"
                        >
                          {isRead ? 'Mark unread' : 'Mark read'}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="px-6 py-16 text-center">
              <Icon name="bell" className="mx-auto h-8 w-8 text-slate-300" />

              <h2 className="mt-4 text-sm font-medium text-slate-700">
                {view === 'unread' ? 'No unread notifications' : 'No notifications'}
              </h2>

              <p className="mt-2 text-xs text-slate-500">
                {view === 'unread'
                  ? 'You have reviewed all current notifications.'
                  : 'Expiry and low-stock alerts will appear here when products need attention.'}
              </p>
            </div>
          )}
        </section>
      )}
    </section>
  )
}
