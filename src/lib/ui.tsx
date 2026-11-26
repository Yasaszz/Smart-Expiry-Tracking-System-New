import type { ReactNode } from 'react'

export type IconName =
  | 'grid'
  | 'box'
  | 'stock'
  | 'tag'
  | 'chart'
  | 'bell'
  | 'calendar'
  | 'arrow'
  | 'plus'
  | 'menu'
  | 'close'
  | 'logout'
  | 'check'
  | 'search'
  | 'chevron'
  | 'chat'
const paths: Record<IconName, ReactNode> = {
  chat: (
    <path d="M21 11.5a8.3 8.3 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.3 8.3 0 0 1-3.8-.9L3 21l1.9-5.7a8.3 8.3 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.3 8.3 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  box: (
    <>
      <path d="m12 3 9 5v8l-9 5-9-5V8l9-5Z" />
      <path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5" />
    </>
  ),
  stock: (
    <>
      <path d="M4 5h16M4 12h16M4 19h16" />
      <path d="M7 3v4m10 3v4M9 17v4" />
    </>
  ),
  tag: (
    <>
      <path
        d="M20 13 11 22 2 13V3h10l8 8a1.4 1.4 0 0 1 0 2Z"
        transform="translate(1 -1) scale(.95)"
      />
      <circle cx="7.5" cy="7.5" r="1" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v17h17M9 15v-4m5 4V7m5 8V4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18m-13 5 3 3 5-5" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  logout: (
    <>
      <path d="M9 4H4v16h5m5-12 4 4-4 4M8 12h12" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
}
export function Icon({ name, className = 'h-5 w-5' }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {paths[name]}
    </svg>
  )
}
export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${dark ? 'bg-indigo-500 text-white' : 'bg-slate-950 text-white'}`}
      >
        <Icon name="calendar" className="h-5 w-5" />
      </span>
      <span>
        <span
          className={`block text-[15px] font-semibold tracking-tight ${dark ? 'text-white' : 'text-slate-950'}`}
        >
          Smart Expiry
        </span>
        <span
          className={`block text-[10px] font-medium uppercase tracking-[0.16em] ${dark ? 'text-slate-500' : 'text-slate-500'}`}
        >
          Inventory management
        </span>
      </span>
    </span>
  )
}
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <section className="mx-auto grid max-w-5xl px-4 py-10 sm:px-6 sm:py-16 lg:grid-cols-[.9fr_1fr] lg:py-20">
      <aside className="hidden flex-col justify-between rounded-l-xl bg-slate-950 p-10 text-white lg:flex">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
            Smart Expiry Tracking System
          </p>
          <h2 className="mt-10 text-3xl font-medium leading-tight tracking-tight">
            Inventory, expiry dates
            <br />
            and stock records.
          </h2>
          <div className="mt-10 space-y-7">
            {[
              {
                icon: 'calendar' as const,
                title: 'Expiry monitoring',
                copy: 'Review product dates and priority alerts.',
              },
              {
                icon: 'stock' as const,
                title: 'Stock control',
                copy: 'Record deliveries, adjustments and sales.',
              },
              {
                icon: 'chart' as const,
                title: 'Reporting',
                copy: 'Review stock values and transaction history.',
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-4">
                <span className="mt-0.5 text-indigo-300">
                  <Icon name={item.icon} />
                </span>
                <div>
                  <h3 className="text-sm font-medium">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-400">{item.copy}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="mt-16 border-t border-white/10 pt-5 text-xs text-slate-500">
          Retail inventory workspace
        </p>
      </aside>
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-9 sm:px-10 lg:rounded-l-none lg:border-l-0 lg:py-10">
        {children}
      </div>
    </section>
  )
}

export const buttonClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-transparent bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-45'
export const secondaryClass =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-[13px] font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-45'
export const inputClass =
  'mt-1.5 block min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 outline-none transition-shadow placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500'
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      {message}
    </div>
  ) : null
}
