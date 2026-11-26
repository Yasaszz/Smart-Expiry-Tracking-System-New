import type { User } from 'firebase/auth'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { AuthContext, InventoryContext, useAuth, useInventory } from '../lib/app-context'
import {
  getErrorMessage,
  logout,
  subscribeToAuth,
  subscribeToProducts,
  getExpiryLevel,
  expiryLevels,
  type Product,
} from '../lib/firebase'
import { batchTotals, type Batch } from '../lib/retail-domain'
import { useRetailCollection, useRetailNow } from '../lib/retail-hooks'
import StoreAssistant from '../lib/store-assistant'
import { Brand, ErrorNotice, Icon, secondaryClass, type IconName } from '../lib/ui'
import { useAutomaticExpiryEmail } from '../lib/use-automatic-expiry-email'
import { buildWebNotifications, useNotificationReads } from '../lib/web-notifications'

import './globals.css'

// bini-overlay 2.1.2 assumes every keydown is a KeyboardEvent with a string key.
// Legacy/synthetic events can omit it. Normalize those before document listeners
// run; real keyboard events and production builds are unaffected.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const normalizeOverlayKey = (event: KeyboardEvent) => {
    if (typeof event.key === 'string') return
    try {
      Object.defineProperty(event, 'key', { value: 'Unidentified', configurable: true })
    } catch {
      // A frozen malformed event cannot be repaired or safely sent to the overlay.
      event.stopImmediatePropagation()
    }
  }
  window.addEventListener('keydown', normalizeOverlayKey, true)
  import.meta.hot?.dispose(() => {
    window.removeEventListener('keydown', normalizeOverlayKey, true)
  })
}

export const document = {
  head: (
    <>
      <title>Smart Expiry | Retail inventory tracking</title>
      <meta
        name="description"
        content="Track expiry dates, manage stock, and act on inventory alerts with Smart Expiry."
      />
      <meta name="theme-color" content="#4f46e5" />
    </>
  ),
}

export { buttonClass, secondaryClass, inputClass, ErrorNotice } from '../lib/ui'

export function ProtectedPage({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (!loading && !user)
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <div key={user?.uid || 'pending-session'}>{children}</div>
}

function useInventorySource() {
  const { user } = useAuth()
  const [state, setState] = useState<{
    owner: string
    products: Product[]
    loading: boolean
    error: string
    stale: boolean
  }>({ owner: '', products: [], loading: true, error: '', stale: true })
  const [attempt, retry] = useState(0)
  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(() => setState((previous) => ({ ...previous })), 60000)
    return () => window.clearInterval(timer)
  }, [user])
  useEffect(() => {
    if (!user) return
    return subscribeToProducts(
      (products) =>
        setState({ owner: user.uid, products, loading: false, error: '', stale: false }),
      (error) =>
        setState((previous) => ({
          owner: user.uid,
          products: previous.owner === user.uid ? previous.products : [],
          loading: false,
          error: getErrorMessage(error),
          stale: true,
        })),
      (stale) =>
        setState((previous) =>
          previous.owner === user.uid
            ? { ...previous, stale }
            : { owner: user.uid, products: [], loading: true, error: '', stale }
        )
    )
  }, [attempt, user])
  const current =
    state.owner === (user?.uid || '')
      ? state
      : { owner: user?.uid || '', products: [] as Product[], loading: true, error: '', stale: true }
  return { ...current, retry: () => retry((value) => value + 1) }
}
function InventoryProvider({ children }: { children: ReactNode }) {
  const source = useInventorySource()
  const batches = useRetailCollection<Batch>('batches')
  const now = useRetailNow()
  const projections = source.products.map((product) => {
    if (!product.batchManaged || !batches.ready) return { product, mismatch: false }
    const active = batches.rows.filter(
      (batch) => batch.productId === product.id && batch.quantity > 0
    )
    try {
      const totals = batchTotals(active, now)
      if (
        totals.quantity !== product.stockQuantity ||
        totals.stockValueMinor !== product.stockValueMinor
      ) {
        return { product, mismatch: true }
      }
      return { product: { ...product, ...totals }, mismatch: false }
    } catch {
      return { product, mismatch: true }
    }
  })
  const products = projections.map((row) => row.product),
    mismatch = projections.some((row) => row.mismatch)
  const needsBatches = products.some((product) => product.batchManaged)
  const inventory = {
    ...source,
    retry: () => {
      source.retry()
      batches.retry()
    },
    products,
    batches: batches.rows,
    batchLoading: batches.loading,
    batchError: batches.error,
    batchStale: batches.stale,
    stale: source.stale || (needsBatches && (!batches.ready || mismatch)),
    error: source.error || (needsBatches ? batches.error : ''),
  }
  return <InventoryContext.Provider value={inventory}>{children}</InventoryContext.Provider>
}
function AutomaticExpiryEmail() {
  useAutomaticExpiryEmail()
  return null
}
function NotificationBell() {
  const { user } = useAuth()
  const inventory = useInventory()
  const { readIds } = useNotificationReads(user!.uid)
  const now = useRetailNow()
  const count =
    inventory.loading || inventory.stale || inventory.error
      ? 0
      : buildWebNotifications(inventory.products, now, inventory.batches).filter(
          (item) => !readIds.includes(item.id)
        ).length
  return (
    <Link
      to="/notifications"
      aria-label={count ? `Notifications: ${count} unread` : 'Notifications'}
      className="relative rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600"
    >
      <Icon name="bell" className="h-[18px] w-[18px]" />
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-indigo-600 px-1 text-[9px] font-semibold tabular-nums text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
export function InventoryNotice({ loading, stale, error, retry }: ReturnType<typeof useInventory>) {
  if (!loading && !stale && !error) return null
  return (
    <div className="space-y-3">
      <ErrorNotice message={error} />
      {error && (
        <button className={secondaryClass} onClick={retry}>
          Reconnect
        </button>
      )}
      {!loading && stale && !error && (
        <p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          Inventory is not synchronized. Editing will resume when the connection is restored.
        </p>
      )}
    </div>
  )
}
export function ExpiryBadge({ product }: { product: Product }) {
  const status = expiryLevels.find((level) => level.value === getExpiryLevel(product.expiryDate))!
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium ${status.className}`}
    >
      {status.label}
    </span>
  )
}
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  busy?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previous = window.document.activeElement as HTMLElement | null
    const overflow = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    element?.showModal()
    return () => {
      element?.close()
      window.document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onClose()
      }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/40"
    >
      <div className="flex items-center justify-between border-b border-slate-200 p-5">
        <h2 id="modal-title" className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50"
          aria-label="Close dialog"
        >
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  )
}

export default function RootLayout({
  children,
  modal,
}: {
  children: ReactNode
  modal?: ReactNode
}) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [menuPath, setMenuPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const location = useLocation()
  const open = menuPath === location.pathname
  const workspace =
    /^\/(dashboard|products|stock|promotions|reports|notifications|batches|suppliers|purchase-orders|supplier-returns|insights)(\/|$)/.test(
      location.pathname
    ) || !!user
  const navigate = useNavigate()
  useEffect(() => {
    if (!workspace || !open || window.matchMedia('(min-width: 1024px)').matches) return
    const navigation = window.document.getElementById('workspace-navigation')
    const previous = window.document.activeElement as HTMLElement | null
    const overflow = window.document.body.style.overflow
    window.document.body.style.overflow = 'hidden'
    const focusable = () =>
      Array.from(navigation?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)') || [])
    focusable()[0]?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuPath(null)
      }
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0],
        last = elements[elements.length - 1]
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.document.addEventListener('keydown', onKey)
    return () => {
      window.document.removeEventListener('keydown', onKey)
      window.document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [open, workspace])
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    void navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          const script =
            registration.active?.scriptURL ||
            registration.waiting?.scriptURL ||
            registration.installing?.scriptURL
          if (script && new URL(script).pathname === '/api/alerts/sw.js')
            void registration.unregister()
        }
      })
      .catch(() => {
        /* Previous push registration cleanup is optional. */
      })
  }, [])
  useEffect(
    () =>
      subscribeToAuth(
        (next) => {
          setUser(next)
          setLoading(false)
        },
        (cause) => {
          setError(getErrorMessage(cause))
          setLoading(false)
        }
      ),
    []
  )
  async function handleLogout() {
    setBusy(true)
    setError('')
    try {
      await logout()
      navigate('/login', { replace: true })
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const navigation: { path: string; label: string; icon: IconName }[] = [
    { path: '/dashboard', label: 'Overview', icon: 'grid' },
    { path: '/products', label: 'Products', icon: 'box' },
    { path: '/stock', label: 'Stock & sales', icon: 'stock' },
    { path: '/batches', label: 'Batches', icon: 'box' },
    { path: '/suppliers', label: 'Suppliers', icon: 'stock' },
    { path: '/purchase-orders', label: 'Purchase orders', icon: 'calendar' },
    { path: '/supplier-returns', label: 'Supplier returns', icon: 'arrow' },
    { path: '/insights', label: 'Inventory insights', icon: 'chart' },
    { path: '/promotions', label: 'Promotions', icon: 'tag' },
    { path: '/reports', label: 'Reports', icon: 'chart' },
    { path: '/notifications', label: 'Notifications', icon: 'bell' },
  ]
  const currentPage =
    navigation.find((item) => location.pathname.startsWith(item.path))?.label || 'Home'
  const accountName = user?.displayName || user?.email || 'Account'
  const initials = accountName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
  return (
    <AuthContext.Provider value={{ user, loading }}>
      <InventoryProvider>
        <AutomaticExpiryEmail key={user?.uid || 'signed-out'} />
        <div className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased selection:bg-indigo-100 selection:text-indigo-950">
          <a
            href="#main-content"
            className="sr-only z-[100] rounded-lg bg-indigo-600 px-4 py-3 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
          >
            Skip to content
          </a>
          {workspace && (
            <>
              {open && (
                <button
                  type="button"
                  aria-label="Close navigation"
                  onClick={() => setMenuPath(null)}
                  className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
                />
              )}
              <aside
                id="workspace-navigation"
                className={`${open ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-slate-800 bg-slate-950 lg:flex`}
              >
                <div className="flex h-20 shrink-0 items-center justify-between border-b border-white/10 px-5">
                  <Link
                    to="/dashboard"
                    onClick={() => setMenuPath(null)}
                    aria-label="Smart Expiry overview"
                    className="rounded-lg focus-visible:outline-2 focus-visible:outline-indigo-400"
                  >
                    <Brand dark />
                  </Link>
                  <button
                    type="button"
                    onClick={() => setMenuPath(null)}
                    aria-label="Close navigation"
                    className="rounded-md p-1 text-slate-400 hover:text-white lg:hidden"
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <nav
                  aria-label="Workspace navigation"
                  className="workspace-scrollbar flex-1 overflow-y-auto px-3 py-7"
                >
                  <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Workspace
                  </p>
                  <div className="space-y-1">
                    {navigation.map((item) => (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={() => setMenuPath(null)}
                        className={({ isActive }) =>
                          `group flex items-center gap-3 rounded-lg border px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-indigo-400 ${isActive ? 'border-indigo-400/20 bg-indigo-500/15 text-indigo-100' : 'border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-100'}`
                        }
                      >
                        <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </nav>
                {user ? (
                  <div className="border-t border-white/10 p-4">
                    <div className="flex items-center gap-3 rounded-lg px-2 py-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-semibold text-slate-200">
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-100">{accountName}</p>
                        {user.displayName && (
                          <p className="mt-0.5 truncate text-xs text-slate-400">{user.email}</p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleLogout()}
                      className="mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium text-slate-400 hover:bg-white/5 hover:text-white focus-visible:outline-2 focus-visible:outline-indigo-400 disabled:opacity-50"
                    >
                      <Icon name="logout" className="h-4 w-4" />
                      {busy ? 'Signing out...' : 'Sign out'}
                    </button>
                  </div>
                ) : (
                  <div
                    role="status"
                    aria-label="Loading account"
                    className="flex items-center gap-3 border-t border-white/10 p-6"
                  >
                    <span
                      aria-hidden="true"
                      className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-slate-800 motion-reduce:animate-none"
                    />
                    <span aria-hidden="true" className="space-y-2">
                      <span className="block h-3 w-28 animate-pulse rounded bg-slate-800 motion-reduce:animate-none" />
                      <span className="block h-2 w-36 animate-pulse rounded bg-slate-800 motion-reduce:animate-none" />
                    </span>
                  </div>
                )}
              </aside>
            </>
          )}
          <div className={`flex min-h-screen flex-col ${workspace ? 'lg:pl-64' : ''}`}>
            <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-sm">
              {workspace ? (
                <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      aria-label="Open navigation"
                      aria-controls="workspace-navigation"
                      aria-expanded={open}
                      onClick={() => setMenuPath(open ? null : location.pathname)}
                      className="rounded-lg border border-slate-200 p-2 text-slate-600 lg:hidden"
                    >
                      <Icon name="menu" />
                    </button>
                    <div className="flex items-center gap-2 text-[13px]">
                      <span className="hidden text-slate-400 sm:inline">Workspace</span>
                      <Icon name="chevron" className="hidden h-3.5 w-3.5 text-slate-300 sm:block" />
                      <span className="font-medium text-slate-700">{currentPage}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {user ? (
                      <NotificationBell />
                    ) : (
                      <span
                        role="status"
                        aria-label="Loading notifications"
                        className="h-9 w-9 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none"
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
                  <Link
                    to="/"
                    aria-label="Smart Expiry home"
                    className="rounded-lg focus-visible:outline-2 focus-visible:outline-indigo-600"
                  >
                    <Brand />
                  </Link>
                </div>
              )}
            </header>
            {error && (
              <div
                role="alert"
                className="mx-4 mt-4 flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 sm:mx-6 lg:mx-8"
              >
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError('')}
                  aria-label="Dismiss error"
                  className="rounded p-0.5"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </div>
            )}
            <main id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
              {children}
            </main>
            {modal}
            <footer
              className={`px-4 py-5 text-[11px] text-slate-500 sm:px-6 lg:px-8 ${workspace ? '' : 'border-t border-slate-200 bg-white'}`}
            >
              <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2">
                <span>Smart Expiry Tracking System</span>
                <span>Inventory management</span>
              </div>
            </footer>
          </div>
          {user && <StoreAssistant key={user.uid} />}
        </div>
      </InventoryProvider>
    </AuthContext.Provider>
  )
}
