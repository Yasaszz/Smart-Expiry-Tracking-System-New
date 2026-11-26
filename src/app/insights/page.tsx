import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useInventory } from '../../lib/app-context'
import {
  dateInput,
  exportCsv,
  type Product,
  type Sale,
  type StockHistory,
} from '../../lib/firebase'
import {
  expiryDays,
  alertCondition,
  alertIdentity,
  demandRate,
  predictUnsold,
  simulateDiscount,
  minor,
  type Batch,
  type AlertResolution,
  type SupplierReturn,
} from '../../lib/retail-domain'
import { useRetailCollection, useRetailNow } from '../../lib/retail-hooks'
import { openingBatch, recordAlertAction } from '../../lib/retail-store'
import {
  RetailHeader,
  RetailNotice,
  RetailLoading,
  Empty,
  Pager,
  Field,
  TextInput,
  FormModal,
  Summary,
  amount,
  tableClass,
  thClass,
  tdClass,
} from '../../lib/retail-ui'
import { ProtectedPage, ExpiryBadge, secondaryClass, inputClass, ErrorNotice } from '../layout'

type SaleRecord = Sale & { id: string }
export default function InsightsPage() {
  return (
    <ProtectedPage>
      <Insights />
    </ProtectedPage>
  )
}
function Insights() {
  const now = useRetailNow()
  const inventory = useInventory(),
    batches = useRetailCollection<Batch>('batches'),
    resolutions = useRetailCollection<AlertResolution>('alertResolutions'),
    returns = useRetailCollection<SupplierReturn>('supplierReturns'),
    [params] = useSearchParams(),
    [windowDays, setWindow] = useState(14),
    [tab, setTab] = useState(params.has('batch') ? 'alerts' : 'risk'),
    [productId, setProductId] = useState(''),
    [page, setPage] = useState(1),
    [reviewPage, setReviewPage] = useState(1),
    [review, setReview] = useState<Batch | null>(null)
  const sales = useRetailCollection<SaleRecord>('sales', windowDays),
    history = useRetailCollection<StockHistory>('StockHistory', windowDays)
  const products = inventory.products,
    all = useMemo(
      () => [
        ...batches.rows,
        ...products.filter((product) => !product.batchManaged).map(openingBatch),
      ],
      [batches.rows, products]
    ),
    ready = batches.ready && !inventory.loading && !inventory.error && !inventory.stale
  const productSales = (product: Product) =>
    sales.rows.filter(
      (sale) =>
        sale.productDocId === product.id ||
        (!sale.productDocId && sale.productId === product.productId)
    )
  const predictions = products
    .filter((product) => !productId || product.id === productId)
    .flatMap((product) =>
      predictUnsold(
        all.filter((batch) => batch.productId === product.id),
        demandRate(productSales(product), windowDays, sales.ready, now, product.createdAt),
        now
      )
    )
    .sort(
      (a, b) =>
        b.expiredCostMinor +
        (b.costAtRiskMinor || 0) -
        (a.expiredCostMinor + (a.costAtRiskMinor || 0))
    )
  const alerts = all
    .filter(
      (batch) =>
        (batch.quantity > 0 ||
          resolutions.rows.some(
            (record) => record.id === alertIdentity(batch) && record.status === 'reviewing'
          )) &&
        alertCondition(batch) &&
        (!productId || batch.productId === productId)
    )
    .sort((a, b) => expiryDays(a.expiryDate) - expiryDays(b.expiryDate))
  const current = Math.min(
    page,
    Math.max(1, Math.ceil((tab === 'risk' ? predictions : alerts).length / 20))
  )
  const confirmedSales = sales.rows.filter((sale) => sale.promotionApplied === true),
    waste = history.rows.filter((row) => row.movementSource === 'disposal')
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <RetailHeader
        title="Inventory insights"
        description="Explainable stock-risk estimates, discount scenarios and recorded outcomes."
      />
      <RetailNotice
        state={{
          ...batches,
          retry: () => {
            batches.retry()
            inventory.retry()
          },
        }}
      />
      <ErrorNotice message={inventory.error} />
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {[
          ['risk', 'Unsold-stock risk'],
          ['simulation', 'Discount simulation'],
          ['alerts', 'Alert actions'],
          ['outcomes', 'Recorded outcomes'],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={`border-b-2 px-3 py-3 text-[13px] font-medium ${tab === value ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            onClick={() => {
              setTab(value)
              setPage(1)
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <Field label="Sales observation window">
          <select
            className={inputClass}
            value={windowDays}
            onChange={(event) => setWindow(Number(event.target.value))}
          >
            {[7, 14, 30].map((value) => (
              <option key={value} value={value}>
                {value} calendar days, including today
              </option>
            ))}
          </select>
        </Field>
        {!['simulation', 'outcomes'].includes(tab) && (
          <Field label="Product">
            <select
              className={inputClass}
              value={productId}
              onChange={(event) => {
                setProductId(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.productId} · {product.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {sales.error && <RetailNotice state={sales} />}
      {batches.loading || inventory.loading ? (
        <RetailLoading label="Loading inventory insights" />
      ) : (
        !batches.error && (
          <>
            {tab === 'risk' && (
              <>
                <p className="text-xs leading-6 text-slate-500">
                  Estimates use recorded sales and calendar days. Earlier FEFO batches consume
                  expected demand first. Undated stock has no expiry forecast; expired stock is
                  shown as an existing exposure. Limited history and stockouts can bias estimates.
                </p>
                {predictions.length ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="overflow-x-auto">
                      <table className={tableClass}>
                        <thead className="bg-slate-50">
                          <tr>
                            {[
                              'Product / batch',
                              'Expiry / stock',
                              'Estimated unsold',
                              'Cost at risk',
                              'Explanation / action',
                            ].map((label) => (
                              <th className={thClass} key={label}>
                                {label}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {predictions.slice((current - 1) * 20, current * 20).map((item) => (
                            <tr key={item.batch.id}>
                              <td className={tdClass}>
                                <p className="font-medium">{item.batch.productName}</p>
                                <p className="text-xs text-slate-500">
                                  {item.batch.productCode} · {item.batch.batchNumber}
                                </p>
                              </td>
                              <td className={tdClass}>
                                <ExpiryBadge
                                  product={{ expiryDate: item.batch.expiryDate } as Product}
                                />
                                <p className="mt-1 text-xs text-slate-500">
                                  {dateInput(item.batch.expiryDate)} · {item.batch.quantity} units
                                </p>
                              </td>
                              <td className={tdClass}>
                                {item.days < 0
                                  ? 'Already expired'
                                  : item.predictedUnsold === null
                                    ? 'Unavailable'
                                    : item.predictedUnsold.toFixed(1) + ' units'}
                              </td>
                              <td className={tdClass}>
                                {item.days < 0
                                  ? amount(item.expiredCostMinor) + ' (expired)'
                                  : item.costAtRiskMinor === null
                                    ? 'Unavailable'
                                    : amount(item.costAtRiskMinor)}
                              </td>
                              <td className={`${tdClass} min-w-64 max-w-lg`}>
                                <p className="text-xs leading-5 text-slate-600">
                                  {item.explanation}
                                </p>
                                <div className="mt-3 flex gap-3">
                                  <Link
                                    className="text-xs font-semibold text-indigo-600"
                                    to={'/batches?product=' + item.batch.productId}
                                  >
                                    View batches
                                  </Link>
                                  <button
                                    className="text-xs font-semibold text-indigo-600"
                                    onClick={() => {
                                      setTab('simulation')
                                      setProductId(item.batch.productId)
                                    }}
                                  >
                                    Simulate discount
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pager page={current} setPage={setPage} total={predictions.length} />
                  </div>
                ) : (
                  <Empty>No dated stock is available for an expiry-risk estimate.</Empty>
                )}
              </>
            )}
            {tab === 'simulation' && (
              <DiscountSimulator
                products={products}
                batches={all}
                sales={sales.rows}
                salesReady={sales.ready}
                windowDays={windowDays}
                initialProduct={productId}
              />
            )}
            {tab === 'alerts' && (
              <>
                <RetailNotice state={resolutions} />
                <p className="text-xs leading-6 text-slate-500">
                  Reading a notification does not resolve an alert. A resolved review remains
                  visible while its batch is still at risk. A changed expiry date or risk level
                  creates a separate review condition.
                </p>
                {resolutions.loading ? (
                  <RetailLoading label="Loading alert reviews" />
                ) : (
                  !resolutions.error &&
                  (alerts.length ? (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <div className="overflow-x-auto">
                        <table className={tableClass}>
                          <thead className="bg-slate-50">
                            <tr>
                              {[
                                'Batch',
                                'Condition',
                                'Review status',
                                'Responsible user',
                                'Last action',
                                'Actions',
                              ].map((label) => (
                                <th key={label} className={thClass}>
                                  {label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {alerts.slice((current - 1) * 20, current * 20).map((batch) => {
                              const record = resolutions.rows.find(
                                  (item) => item.id === alertIdentity(batch)
                                ),
                                legacy = !products.find((product) => product.id === batch.productId)
                                  ?.batchManaged
                              return (
                                <tr key={batch.id}>
                                  <td className={tdClass}>
                                    <p className="font-medium">{batch.productName}</p>
                                    <p className="text-xs text-slate-500">
                                      {batch.batchNumber} · {batch.quantity} units
                                    </p>
                                  </td>
                                  <td className={tdClass}>
                                    <ExpiryBadge
                                      product={{ expiryDate: batch.expiryDate } as Product}
                                    />
                                  </td>
                                  <td className={tdClass}>
                                    {record?.status || 'New'}
                                    {record?.status === 'resolved' && (
                                      <p className="mt-1 text-xs text-amber-700">
                                        Stock still at risk
                                      </p>
                                    )}
                                  </td>
                                  <td className={tdClass}>
                                    {record?.responsibleName || 'Unassigned'}
                                  </td>
                                  <td className={tdClass}>
                                    <p className="max-w-xs break-words text-xs text-slate-500">
                                      {record?.history.at(-1)?.notes || 'Not reviewed yet'}
                                    </p>
                                  </td>
                                  <td className={tdClass}>
                                    <button
                                      className={secondaryClass}
                                      disabled={!ready || !resolutions.ready || legacy}
                                      onClick={() => setReview(batch)}
                                    >
                                      Review / history
                                    </button>
                                    {legacy && (
                                      <Link
                                        className="mt-1 block text-xs text-indigo-600"
                                        to={'/batches?product=' + batch.productId}
                                      >
                                        Convert opening balance
                                      </Link>
                                    )}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <Pager page={current} setPage={setPage} total={alerts.length} />
                    </div>
                  ) : (
                    <Empty>No active expiry alerts.</Empty>
                  ))
                )}
              </>
            )}
            {tab === 'outcomes' && (
              <>
                <RetailNotice state={history} />
                <RetailNotice state={returns} />
                <RetailNotice state={resolutions} />
                <p className="text-xs leading-6 text-slate-500">
                  Sales and disposals below cover the selected observation window. Supplier credits
                  cover all recorded returns. These are recorded outcomes, not estimates of money
                  saved. Review duration starts at the first recorded review.
                </p>
                {sales.loading || history.loading || returns.loading ? (
                  <RetailLoading label="Loading recorded outcomes" />
                ) : (
                  <>
                    <Summary
                      items={[
                        {
                          label: 'Discounted sales revenue (window)',
                          value: sales.error
                            ? 'Unavailable'
                            : amount(
                                confirmedSales.reduce(
                                  (sum, sale) => sum + Math.round(sale.totalAmount * 100),
                                  0
                                )
                              ),
                        },
                        {
                          label: 'Disposed units (window)',
                          value: history.error
                            ? 'Unavailable'
                            : String(
                                waste.reduce(
                                  (sum, row) =>
                                    sum + Math.max(0, row.previousQuantity - row.newQuantity),
                                  0
                                )
                              ),
                        },
                        {
                          label: 'Disposal cost (window)',
                          value: history.error
                            ? 'Unavailable'
                            : amount(waste.reduce((sum, row) => sum + (row.writeOffMinor || 0), 0)),
                        },
                        {
                          label: 'Actual supplier credits (all recorded)',
                          value: returns.error
                            ? 'Unavailable'
                            : amount(
                                returns.rows
                                  .filter((item) => item.status === 'credited')
                                  .reduce((sum, item) => sum + item.creditMinor, 0)
                              ),
                        },
                      ]}
                    />
                    <div className="rounded-xl border border-slate-200 bg-white p-5">
                      <h2 className="text-sm font-semibold">Review history</h2>
                      {resolutions.loading ? (
                        <RetailLoading label="Loading review history" />
                      ) : resolutions.error ? null : resolutions.rows.length ? (
                        <ul className="mt-4 divide-y divide-slate-100">
                          {resolutions.rows
                            .slice()
                            .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis())
                            .slice(
                              (Math.min(
                                reviewPage,
                                Math.max(1, Math.ceil(resolutions.rows.length / 20))
                              ) -
                                1) *
                                20,
                              Math.min(
                                reviewPage,
                                Math.max(1, Math.ceil(resolutions.rows.length / 20))
                              ) * 20
                            )
                            .map((record) => (
                              <li key={record.id} className="py-4 text-[13px]">
                                <p className="font-medium">
                                  {all.find((batch) => batch.id === record.batchId)?.batchNumber ||
                                    record.batchId}{' '}
                                  · {record.condition} · {record.status}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {record.responsibleName} · {record.history.length} actions
                                  {record.resolvedAt
                                    ? ' · ' +
                                      Math.max(
                                        0,
                                        Math.round(
                                          (record.resolvedAt.toMillis() -
                                            record.createdAt.toMillis()) /
                                            60000
                                        )
                                      ) +
                                      ' minutes from first review to resolution'
                                    : ''}
                                </p>
                                <details className="mt-3 rounded-lg bg-slate-50 p-3">
                                  <summary className="cursor-pointer text-xs font-medium text-indigo-600">
                                    View action history
                                  </summary>
                                  <ol className="mt-3 space-y-3">
                                    {record.history.map((event) => (
                                      <li key={event.id} className="text-xs leading-5">
                                        <p className="font-medium">
                                          {event.action} / {event.status} / {event.userName}
                                        </p>
                                        <p>{event.notes}</p>
                                        <p className="text-slate-500">
                                          {event.at
                                            .toDate()
                                            .toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}
                                        </p>
                                        {event.links.map((link) => (
                                          <p
                                            key={link.collection + link.id}
                                            className="break-all text-slate-500"
                                          >
                                            Linked {link.collection}: {link.id}
                                          </p>
                                        ))}
                                      </li>
                                    ))}
                                  </ol>
                                </details>
                              </li>
                            ))}
                        </ul>
                      ) : (
                        <p className="mt-4 text-xs text-slate-500">No review actions recorded.</p>
                      )}
                    </div>
                    {resolutions.ready && resolutions.rows.length > 20 && (
                      <Pager
                        total={resolutions.rows.length}
                        page={reviewPage}
                        setPage={setReviewPage}
                      />
                    )}
                    <button
                      className={secondaryClass}
                      disabled={!sales.ready || !history.ready || !returns.ready}
                      onClick={() =>
                        exportCsv(
                          'confirmed-inventory-outcomes',
                          ['Type', 'Reference', 'Product', 'Quantity', 'Actual value LKR'],
                          [
                            ...confirmedSales.map((sale) => [
                              'Discounted sale',
                              sale.saleId,
                              sale.productName,
                              sale.quantity,
                              sale.totalAmount,
                            ]),
                            ...waste.map((row) => [
                              'Disposal',
                              row.id,
                              row.productName,
                              row.previousQuantity - row.newQuantity,
                              (row.writeOffMinor || 0) / 100,
                            ]),
                            ...returns.rows
                              .filter((item) => item.status === 'credited')
                              .map((item) => [
                                'Supplier credit',
                                item.id,
                                item.productName,
                                item.quantity,
                                item.creditMinor / 100,
                              ]),
                          ]
                        )
                      }
                    >
                      Export recorded outcomes CSV
                    </button>
                  </>
                )}
              </>
            )}
          </>
        )
      )}
      {review && (
        <ReviewForm
          batch={review}
          original={resolutions.rows.find((item) => item.id === alertIdentity(review))}
          sales={sales.rows}
          history={history.rows}
          returns={returns.rows}
          ready={ready && resolutions.ready}
          onClose={() => setReview(null)}
        />
      )}
    </section>
  )
}
function DiscountSimulator({
  products,
  batches,
  sales,
  salesReady,
  windowDays,
  initialProduct,
}: {
  products: Product[]
  batches: Batch[]
  sales: SaleRecord[]
  salesReady: boolean
  windowDays: number
  initialProduct: string
}) {
  const now = useRetailNow()
  const [id, setId] = useState(initialProduct || products[0]?.id || ''),
    [batchId, setBatchId] = useState(''),
    [horizon, setHorizon] = useState('14'),
    [override, setOverride] = useState(''),
    [uplifts, setUplifts] = useState<Record<number, string>>({ 0: '0', 10: '0', 20: '0', 30: '0' })
  const product = products.find((item) => item.id === id),
    selected = batches.filter(
      (batch) => batch.productId === id && batch.quantity > 0 && expiryDays(batch.expiryDate) >= 0
    )
  const demand = product
    ? demandRate(
        sales.filter(
          (sale) =>
            sale.productDocId === id || (!sale.productDocId && sale.productId === product.productId)
        ),
        windowDays,
        salesReady,
        now,
        product.createdAt
      )
    : null
  const rate = override === '' ? demand?.rate : Number(override),
    valid =
      product &&
      rate !== undefined &&
      Number.isFinite(rate) &&
      rate >= 0 &&
      Number.isInteger(Number(horizon)) &&
      Number(horizon) >= 1 &&
      Number(horizon) <= 365 &&
      Object.values(uplifts).every(
        (value) =>
          value !== '' &&
          Number.isFinite(Number(value)) &&
          Number(value) >= 0 &&
          Number(value) <= 1000
      )
  const scenarios = valid
    ? [0, 10, 20, 30].map((discount) =>
        simulateDiscount(
          selected,
          minor(product.sellingPrice),
          rate,
          discount,
          Number(uplifts[discount]),
          Number(horizon),
          now,
          batchId || undefined
        )
      )
    : []
  return (
    <div className="space-y-5">
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <Field label="Product">
          <select
            className={inputClass}
            value={id}
            onChange={(event) => {
              setId(event.target.value)
              setBatchId('')
              setOverride('')
            }}
          >
            <option value="">Choose product</option>
            {products.map((item) => (
              <option value={item.id} key={item.id}>
                {item.productId} · {item.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Simulation scope">
          <select
            className={inputClass}
            value={batchId}
            onChange={(event) => setBatchId(event.target.value)}
          >
            <option value="">All sellable batches</option>
            {selected.map((batch) => (
              <option value={batch.id} key={batch.id}>
                {batch.batchNumber} · {batch.quantity} units
              </option>
            ))}
          </select>
        </Field>
        <Field label="Simulation horizon (days)">
          <TextInput
            type="number"
            min={1}
            max={365}
            step="1"
            value={horizon}
            onChange={setHorizon}
          />
        </Field>
        <Field label="Assumed daily demand (units)">
          <TextInput
            type="number"
            min={0}
            step="0.01"
            value={override === '' ? demand?.rate.toFixed(2) || '' : override}
            onChange={setOverride}
            placeholder="Enter an assumption if sales data is unavailable"
          />
        </Field>
      </div>
      <p className="text-xs leading-6 text-slate-500">
        {demand
          ? `Baseline: ${demand.units} units sold / ${demand.days} observed calendar days = ${demand.rate.toFixed(2)} units/day. ${demand.warning}`
          : 'Sales data is unavailable. Enter an explicit assumed demand to run a scenario.'}{' '}
        Demand increases below are your assumptions, not learned effects. Earlier FEFO batches
        consume demand first; expired units are excluded. Undated stock uses the selected horizon.
      </p>
      {!selected.length ? (
        <Empty>No sellable stock is available for this product.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead className="bg-slate-50">
                <tr>
                  {[
                    'Discount',
                    'Assumed demand increase %',
                    'Unit price',
                    'Expected sold / left',
                    'Revenue / cost',
                    'Gross profit / margin',
                    'Unsold cost exposure',
                    'Review',
                  ].map((label) => (
                    <th key={label} className={thClass}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[0, 10, 20, 30].map((discount, index) => {
                  const row = scenarios[index]
                  return (
                    <tr key={discount}>
                      <td className={tdClass}>{discount}%</td>
                      <td className={tdClass}>
                        <input
                          aria-label={`Assumed demand increase for ${discount}% discount`}
                          className={`${inputClass} w-24`}
                          type="number"
                          min={0}
                          max={1000}
                          value={uplifts[discount]}
                          onChange={(event) =>
                            setUplifts({ ...uplifts, [discount]: event.target.value })
                          }
                        />
                      </td>
                      <td className={tdClass}>
                        {row ? amount(row.price) : '—'}
                        {row?.belowCost && (
                          <p className="mt-1 text-xs font-semibold text-red-700">
                            Below batch purchase cost
                          </p>
                        )}
                      </td>
                      <td className={tdClass}>{row ? `${row.sold} / ${row.remaining}` : '—'}</td>
                      <td className={tdClass}>
                        {row ? (
                          <>
                            {amount(row.revenue)}
                            <p className="text-xs text-slate-500">COGS: {amount(row.cost)}</p>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={tdClass}>
                        {row ? (
                          <>
                            {amount(row.profit)}
                            <p className="text-xs text-slate-500">{row.margin.toFixed(1)}%</p>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={tdClass}>{row ? amount(row.exposure) : '—'}</td>
                      <td className={tdClass}>
                        {discount > 0 && product && (
                          <Link
                            className="text-xs font-semibold text-indigo-600"
                            to={
                              '/promotions?product=' +
                              encodeURIComponent(product.productId) +
                              '&discount=' +
                              discount
                            }
                          >
                            Review promotion
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="rounded-lg bg-slate-100 p-4 text-xs leading-5 text-slate-600">
        Simulation does not change stock or prices. Promotions apply to the product, not one batch.
        Review scope and dates and explicitly save on the Promotions page before applying a
        discount.
      </p>
    </div>
  )
}
function ReviewForm({
  batch,
  original,
  sales,
  history,
  returns,
  ready,
  onClose,
}: {
  batch: Batch
  original?: AlertResolution
  sales: SaleRecord[]
  history: StockHistory[]
  returns: SupplierReturn[]
  ready: boolean
  onClose: () => void
}) {
  const [status, setStatus] = useState<'reviewing' | 'resolved'>('reviewing'),
    [action, setAction] = useState('review'),
    [notes, setNotes] = useState(''),
    [chosen, setChosen] = useState<string[]>([])
  const linked = [
    ...sales
      .filter((sale) => sale.batchAllocations?.some((item) => item.batchId === batch.id))
      .map((sale) => ({
        collection: 'sales',
        id: sale.id,
        label: `Sale · ${sale.saleId} · ${sale.quantity} units`,
      })),
    ...history
      .filter((row) => row.batchIds?.includes(batch.id))
      .map((row) => ({
        collection: 'StockHistory',
        id: row.id,
        label: `${row.eventType === 'promotion' ? 'Promotion' : row.movementSource || row.changeType} · ${row.reason}`,
      })),
    ...returns
      .filter((item) => item.batchId === batch.id)
      .map((item) => ({
        collection: 'supplierReturns',
        id: item.id,
        label: `Supplier return · ${item.quantity} units · ${item.status}`,
      })),
  ]
  return (
    <FormModal
      title={'Review ' + batch.batchNumber}
      ready={ready}
      onClose={onClose}
      onSubmit={() =>
        recordAlertAction(
          batch,
          status,
          action,
          notes,
          linked
            .filter((item) => chosen.includes(item.collection + ':' + item.id))
            .map(({ collection, id }) => ({ collection, id })),
          original
        )
      }
    >
      <p className="text-sm">
        {batch.productName} · {batch.quantity} units · {alertCondition(batch)}
      </p>
      <div className="flex flex-wrap gap-3 text-xs">
        <Link className="text-indigo-600 underline" to={'/promotions?product=' + batch.productCode}>
          Create promotion
        </Link>
        <Link className="text-indigo-600 underline" to={'/supplier-returns?batch=' + batch.id}>
          Return to supplier
        </Link>
        <Link className="text-indigo-600 underline" to={'/batches?product=' + batch.productId}>
          Adjust / dispose batch
        </Link>
      </div>
      <Field label="Review status">
        <select
          className={inputClass}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="reviewing">Reviewing</option>
          <option value="resolved">Resolved review</option>
        </select>
      </Field>
      <Field label="Action recorded">
        <select
          className={inputClass}
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          <option value="review">Reviewed stock</option>
          <option value="promotion">Promotion created</option>
          <option value="supplier-return">Supplier return recorded</option>
          <option value="disposal">Disposal recorded</option>
          <option value="explanation">Resolve with explanation</option>
        </select>
      </Field>
      <Field label="Review notes / explanation">
        <textarea
          required
          maxLength={1000}
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="space-y-2">
        <p className="text-xs font-medium">Link up to four recorded outcomes</p>
        {linked.length ? (
          linked.map((item) => {
            const key = item.collection + ':' + item.id
            return (
              <label key={key} className="flex items-start gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={chosen.includes(key)}
                  disabled={!chosen.includes(key) && chosen.length >= 4}
                  onChange={(event) =>
                    setChosen(
                      event.target.checked
                        ? [...chosen, key]
                        : chosen.filter((value) => value !== key)
                    )
                  }
                />
                {item.label}
              </label>
            )
          })
        ) : (
          <p className="text-xs text-slate-500">
            No matching outcomes in the selected sales/history window. Supplier returns are checked
            across all records.
          </p>
        )}
      </div>
      <p className="text-xs leading-5 text-slate-500">
        Recording a review does not execute its action. Complete the stock, return or promotion
        workflow first, then link its record. A resolved review never hides remaining at-risk stock.
      </p>
      {original && (
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold">Earlier actions</h3>
          {original.history.map((event, index) => (
            <div key={index} className="text-xs text-slate-600">
              <p className="font-medium">
                {event.status} · {event.action} · {event.userName}
              </p>
              <p className="mt-1">{event.notes}</p>
              <p className="mt-1 text-slate-400">{event.at.toDate().toLocaleString('en-GB')}</p>
            </div>
          ))}
        </div>
      )}
    </FormModal>
  )
}
