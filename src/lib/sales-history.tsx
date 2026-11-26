import { useState } from 'react'

import { ErrorNotice, inputClass, secondaryClass } from '../app/layout'
import { currentMonth, exportCsv, money, type Sale } from './firebase'
import { useMonthlyLedger } from './hooks'
import { LoadingSkeleton } from './loading-skeleton'

export default function SalesHistory() {
  const [month, setMonth] = useState(() => currentMonth())
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const ledger = useMonthlyLedger<Sale>('sales', month)
  const rows = ledger.rows.filter((sale) =>
    `${sale.productId} ${sale.productName} ${sale.customerName} ${sale.saleId}`
      .toLowerCase()
      .includes(search.toLowerCase())
  )
  const total = rows.reduce((sum, sale) => sum + Math.round(sale.totalAmount * 100), 0) / 100
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)))
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-none">
      <h2 className="text-base font-semibold">Sales history</h2>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="text-[13px]">
          Month
          <input
            type="month"
            required
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
        <label className="min-w-56 flex-1 text-[13px]">
          Search sales
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Product, customer or sale ID"
            className={inputClass}
          />
        </label>
        <button
          className={secondaryClass}
          disabled={ledger.loading || ledger.stale || !!ledger.error}
          onClick={() =>
            exportCsv(
              `sales-${month}`,
              [
                'Sale ID',
                'Date',
                'Product ID',
                'Product',
                'Customer',
                'Quantity',
                'Unit price LKR',
                'Total LKR',
              ],
              rows.map((sale) => [
                sale.saleId,
                sale.timestamp.toDate().toISOString(),
                sale.productId,
                sale.productName,
                sale.customerName,
                sale.quantity,
                sale.unitPrice,
                sale.totalAmount,
              ])
            )
          }
        >
          Export CSV
        </button>
      </div>
      <div className="mt-4">
        <ErrorNotice message={ledger.error} />
        {ledger.error && (
          <button className={`${secondaryClass} mt-3`} onClick={ledger.retry}>
            Retry
          </button>
        )}
      </div>
      {ledger.loading ? (
        <div className="mt-4">
          <LoadingSkeleton rows={3} label="Loading sales" />
        </div>
      ) : (
        !ledger.error && (
          <>
            {ledger.stale && (
              <p className="mt-3 text-[13px] text-amber-800">
                Last confirmed sales; waiting for synchronization.
              </p>
            )}
            <p className="my-4 text-[13px] font-semibold">
              {rows.length} sales · Revenue {money(total)}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-slate-50 text-[11px] text-slate-500">
                  <tr>
                    {['Time', 'Product', 'Customer', 'Quantity', 'Unit price', 'Total'].map(
                      (value) => (
                        <th key={value} scope="col" className="px-4 py-3">
                          {value}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice((current - 1) * 20, current * 20).map((sale) => (
                    <tr key={sale.saleId}>
                      <td className="whitespace-nowrap px-4 py-3">
                        {sale.timestamp.toDate().toLocaleString('en-GB')}
                      </td>
                      <td className="px-4 py-3">
                        {sale.productName}
                        <p className="text-xs text-slate-500">{sale.productId}</p>
                      </td>
                      <td className="px-4 py-3">{sale.customerName}</td>
                      <td className="px-4 py-3">{sale.quantity}</td>
                      <td className="whitespace-nowrap px-4 py-3">{money(sale.unitPrice)}</td>
                      <td className="whitespace-nowrap px-4 py-3">{money(sale.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <p className="p-6 text-[13px] text-slate-500">
                No sales match this period and search.
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                className={secondaryClass}
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </button>
              <button
                className={secondaryClass}
                disabled={current * 20 >= rows.length}
                onClick={() => setPage(current + 1)}
              >
                Next
              </button>
            </div>
          </>
        )
      )}
    </section>
  )
}
