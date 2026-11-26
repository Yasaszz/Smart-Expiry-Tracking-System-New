import { useLocation } from 'react-router-dom'

import { LoadingSkeleton } from '../lib/loading-skeleton'

export default function Loading() {
  const { pathname } = useLocation()
  const page = {
    batches: ['Batches', 'Receipts, batch expiry dates and stock reconciliation.'],
    suppliers: ['Suppliers', 'Supplier contacts, payment terms and archived records.'],
    'purchase-orders': [
      'Purchase orders',
      'Plan purchases and receive deliveries into individual batches.',
    ],
    'supplier-returns': [
      'Supplier returns',
      'Return specific batch quantities and track supplier credit decisions.',
    ],
    insights: [
      'Inventory insights',
      'Explainable stock-risk estimates, discount scenarios and recorded outcomes.',
    ],
    dashboard: ['Overview', 'Inventory status and items requiring action.'],
    products: ['Products', 'Product records, expiry dates and pricing. All amounts in LKR.'],
    stock: ['Stock & sales', 'Record deliveries, sales and stock adjustments.'],
    promotions: ['Promotions', 'Manage discount prices, promotion dates and history.'],
    reports: ['Reports', 'Inventory, expiry, purchase and sales reports.'],
    notifications: ['Notifications', 'Expiry alerts and stock updates for your store.'],
    assistant: ['Store assistant', 'Ask about your inventory or how to use Smart Expiry.'],
  }[pathname.split('/')[1]]
  if (page)
    return (
      <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
            {page[0]}
          </h1>
          <p className="mt-2 text-[13px] text-slate-500">{page[1]}</p>
        </header>
        <LoadingSkeleton label="Loading page content" />
      </section>
    )
  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <LoadingSkeleton variant="page" label="Loading page" />
    </section>
  )
}
