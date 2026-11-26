import { Link, Navigate } from 'react-router-dom'

import { useAuth } from '../lib/app-context'
import { Icon, type IconName } from '../lib/ui'
import { buttonClass, secondaryClass } from './layout'

const modules: { icon: IconName; title: string; description: string }[] = [
  {
    icon: 'box',
    title: 'Product register',
    description: 'Product details, categories, expiry dates and pricing.',
  },
  {
    icon: 'calendar',
    title: 'Expiry monitoring',
    description: 'Expiry dates, priority levels and products requiring action.',
  },
  {
    icon: 'stock',
    title: 'Stock & sales',
    description: 'Deliveries, sales, returns and stock adjustments.',
  },
  {
    icon: 'tag',
    title: 'Promotions',
    description: 'Discount prices, promotion dates and change history.',
  },
  {
    icon: 'chart',
    title: 'Reports',
    description: 'Inventory, purchases and sales with export options.',
  },
  {
    icon: 'bell',
    title: 'Notifications',
    description: 'Website alerts and automatic expiry emails.',
  },
]
export default function HomePage() {
  const { user } = useAuth()
  if (user) return <Navigate to="/dashboard" replace />
  return (
    <div className="bg-white">
      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.2fr_1fr] lg:gap-20 lg:px-8 lg:py-28">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Retail operations
          </p>
          <h1 className="mt-5 max-w-2xl text-4xl font-semibold leading-[1.12] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
            Inventory and
            <br />
            expiry management.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-8 text-slate-500">
            Maintain product records, review expiry alerts, and record sales and stock adjustments.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login" className={`${buttonClass} min-h-11 px-6`}>
              Sign in
              <Icon name="arrow" className="h-4 w-4" />
            </Link>
            <Link to="/register" className={`${secondaryClass} min-h-11 px-6`}>
              Create account
            </Link>
          </div>
          <p className="mt-5 text-xs text-slate-500">Email and Google sign-in supported.</p>
        </div>
        <aside className="self-center rounded-xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-5">
            <Icon name="calendar" className="h-5 w-5 text-indigo-600" />
            <h2 className="text-sm font-semibold text-slate-900">Daily inventory workflow</h2>
          </div>
          <ol className="divide-y divide-slate-200">
            {[
              {
                step: '01',
                title: 'Maintain product records',
                copy: 'Add products and keep stock quantities and expiry dates current.',
              },
              {
                step: '02',
                title: 'Review items requiring action',
                copy: 'Check expiry alerts and low-stock levels before making adjustments.',
              },
              {
                step: '03',
                title: 'Record movements and review reports',
                copy: 'Log deliveries and sales, then review the recorded transactions.',
              },
            ].map((item) => (
              <li key={item.step} className="flex gap-5 py-6 last:pb-0">
                <span className="pt-0.5 font-mono text-xs text-slate-500">{item.step}</span>
                <div>
                  <h3 className="text-sm font-semibold">{item.title}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-slate-500">{item.copy}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </section>
      <section className="border-t border-slate-200 bg-slate-50/70">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight">Application modules</h2>
            <span className="hidden text-xs text-slate-500 sm:inline">
              Smart Expiry Tracking System
            </span>
          </div>
          <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <article key={module.title} className="flex gap-4">
                <span className="pt-0.5 text-slate-500">
                  <Icon name={module.icon} className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{module.title}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-slate-500">{module.description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
