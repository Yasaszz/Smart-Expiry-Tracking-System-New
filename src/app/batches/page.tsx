import { collection, doc } from 'firebase/firestore'
import { useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'

import { useInventory } from '../../lib/app-context'
import { db, dateInput, expiryLevels, getExpiryLevel, type Product } from '../../lib/firebase'
import { expiryDays, type Batch, type Supplier } from '../../lib/retail-domain'
import { useRetailCollection } from '../../lib/retail-hooks'
import {
  openingBatch,
  ensureProductBatches,
  receiveBatch,
  changeBatch,
} from '../../lib/retail-store'
import {
  RetailHeader,
  RetailNotice,
  RetailLoading,
  Empty,
  Pager,
  FormModal,
  Field,
  TextInput,
  ExpiryChoice,
  choiceDate,
  Summary,
  amount,
  tableClass,
  thClass,
  tdClass,
  dateText,
} from '../../lib/retail-ui'
import {
  ProtectedPage,
  ExpiryBadge,
  ErrorNotice,
  buttonClass,
  secondaryClass,
  inputClass,
  Modal,
} from '../layout'

export default function BatchesPage() {
  return (
    <ProtectedPage>
      <Batches />
    </ProtectedPage>
  )
}
function Batches() {
  const inventory = useInventory(),
    source = useRetailCollection<Batch>('batches'),
    suppliers = useRetailCollection<Supplier>('suppliers'),
    [params] = useSearchParams()
  const [productId, setProductId] = useState(params.get('product') || ''),
    [supplierId, setSupplierId] = useState(''),
    [expiry, setExpiry] = useState(''),
    [search, setSearch] = useState(''),
    [showEmpty, setShowEmpty] = useState(false),
    [page, setPage] = useState(1),
    [action, setAction] = useState<{ mode: 'add' | 'edit' | 'details'; batch?: Batch } | null>(
      null
    ),
    [error, setError] = useState(''),
    [converting, setConverting] = useState(false)
  const products = inventory.products,
    virtual = products.filter((product) => !product.batchManaged).map(openingBatch)
  const all = [...source.rows, ...virtual],
    ready = source.ready && !inventory.loading && !inventory.stale && !inventory.error
  const rows = all
    .filter(
      (batch) =>
        (showEmpty || batch.quantity > 0) &&
        (!productId || batch.productId === productId) &&
        (!supplierId || batch.supplierId === supplierId) &&
        (!expiry || getExpiryLevel(batch.expiryDate) === expiry) &&
        `${batch.batchNumber} ${batch.productName} ${batch.productCode}`
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    .sort((a, b) => b.receivedAt.toMillis() - a.receivedAt.toMillis())
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)))
  const active = all.filter(
    (batch) => batch.quantity > 0 && (!productId || batch.productId === productId)
  )
  async function convert() {
    if (converting) return
    setConverting(true)
    setError('')
    try {
      for (const product of products.filter(
        (product) => !product.batchManaged && (!productId || product.id === productId)
      ))
        await ensureProductBatches(product.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Migration failed.')
    } finally {
      setConverting(false)
    }
  }
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <RetailHeader
        title="Batches"
        description="Receipts, batch expiry dates and stock reconciliation."
      >
        <button
          className={buttonClass}
          disabled={!ready || !suppliers.ready || !products.length}
          onClick={() => setAction({ mode: 'add' })}
        >
          Receive batch
        </button>
      </RetailHeader>
      <RetailNotice
        state={{
          ...source,
          retry: () => {
            source.retry()
            inventory.retry()
          },
        }}
      />
      <ErrorNotice message={inventory.error || error} />
      {!source.loading && !source.error && (
        <Summary
          items={[
            {
              label: 'Total units',
              value: active.reduce((sum, item) => sum + item.quantity, 0).toLocaleString(),
            },
            {
              label: 'Sellable units',
              value: active
                .filter((item) => expiryDays(item.expiryDate) >= 0)
                .reduce((sum, item) => sum + item.quantity, 0)
                .toLocaleString(),
            },
            {
              label: 'Expired units',
              value: active
                .filter((item) => expiryDays(item.expiryDate) < 0)
                .reduce((sum, item) => sum + item.quantity, 0)
                .toLocaleString(),
            },
            {
              label: 'Purchase value',
              value: amount(
                active.reduce((sum, item) => sum + item.quantity * item.unitCostMinor, 0)
              ),
            },
          ]}
        />
      )}
      {virtual.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p>
            Existing balances will become labelled opening batches. Quantities remain unchanged;
            unknown historical receipt details remain unknown.
          </p>
          <button
            className={secondaryClass}
            disabled={!ready || converting}
            onClick={() => void convert()}
          >
            {converting ? 'Converting…' : 'Convert existing balances'}
          </button>
        </div>
      )}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Search batches">
          <TextInput
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Batch, product or ID"
          />
        </Field>
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
              <option value={product.id} key={product.id}>
                {product.productId} · {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier">
          <select
            className={inputClass}
            value={supplierId}
            onChange={(event) => {
              setSupplierId(event.target.value)
              setPage(1)
            }}
          >
            <option value="">All suppliers</option>
            {suppliers.rows.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Expiry status">
          <select
            className={inputClass}
            value={expiry}
            onChange={(event) => {
              setExpiry(event.target.value)
              setPage(1)
            }}
          >
            <option value="">All levels</option>
            {expiryLevels.map((level) => (
              <option value={level.value} key={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </Field>
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(event) => setShowEmpty(event.target.checked)}
          />
          Include depleted batches
        </label>
      </div>
      {source.loading || inventory.loading ? (
        <RetailLoading label="Loading batches" />
      ) : (
        !source.error &&
        (rows.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      'Batch / product',
                      'Supplier',
                      'Received',
                      'Stock',
                      'Unit cost',
                      'Expiry',
                      'Actions',
                    ].map((label) => (
                      <th key={label} className={thClass}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice((current - 1) * 20, current * 20).map((batch) => {
                    const legacy = virtual.some((item) => item.id === batch.id)
                    return (
                      <tr key={batch.id}>
                        <td className={tdClass}>
                          <p className="font-semibold">{batch.batchNumber}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {products.find((product) => product.id === batch.productId)?.name ||
                              batch.productName}{' '}
                            · {batch.productCode}
                          </p>
                          {legacy && (
                            <p className="mt-1 text-xs text-amber-700">
                              Opening balance · conversion pending
                            </p>
                          )}
                        </td>
                        <td className={tdClass}>{batch.supplierName || 'Not recorded'}</td>
                        <td className={tdClass}>
                          {batch.legacy ? 'Unknown (legacy)' : dateInput(batch.receivedAt)}
                        </td>
                        <td className={tdClass}>
                          {batch.quantity}
                          <p className="text-xs text-slate-400">
                            Received: {batch.quantityReceived}
                          </p>
                        </td>
                        <td className={tdClass}>{amount(batch.unitCostMinor)}</td>
                        <td className={tdClass}>
                          <ExpiryBadge product={{ expiryDate: batch.expiryDate } as Product} />
                          {batch.expiryDate && (
                            <p className="mt-1 text-xs text-slate-500">
                              {dateInput(batch.expiryDate)}
                            </p>
                          )}
                        </td>
                        <td className={tdClass}>
                          <div className="flex gap-2">
                            <button
                              className={secondaryClass}
                              onClick={() => setAction({ mode: 'details', batch })}
                            >
                              Details
                            </button>
                            <button
                              className={secondaryClass}
                              disabled={
                                !ready || legacy || batch.quantity === 0 || !suppliers.ready
                              }
                              onClick={() => setAction({ mode: 'edit', batch })}
                            >
                              Adjust
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={current} setPage={setPage} total={rows.length} />
          </div>
        ) : (
          <Empty>No batches match this view.</Empty>
        ))
      )}
      {action?.mode === 'add' && (
        <ReceiveForm
          products={products}
          suppliers={suppliers.rows}
          productId={productId}
          ready={ready && suppliers.ready}
          onClose={() => setAction(null)}
        />
      )}
      {action?.mode === 'edit' && action.batch && (
        <BatchForm
          batch={action.batch}
          suppliers={suppliers.rows}
          ready={ready && suppliers.ready}
          onClose={() => setAction(null)}
        />
      )}
      {action?.mode === 'details' && action.batch && (
        <Modal title={action.batch.batchNumber} onClose={() => setAction(null)}>
          <dl className="space-y-3 text-sm">
            {Object.entries({
              Product: action.batch.productName,
              Supplier: action.batch.supplierName || 'Not recorded',
              'Current stock': action.batch.quantity,
              'Originally received': action.batch.quantityReceived,
              'Purchase unit cost': amount(action.batch.unitCostMinor),
              Expiry: dateText(action.batch.expiryDate),
              Receipt: action.batch.legacy
                ? 'Legacy balance; original receipt date unknown'
                : dateInput(action.batch.receivedAt),
              'Purchase order': action.batch.purchaseOrderId || 'None',
              Notes: action.batch.notes || 'None',
            }).map(([key, value]) => (
              <div key={key}>
                <dt className="text-xs text-slate-500">{key}</dt>
                <dd className="mt-1 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link className={secondaryClass} to={'/supplier-returns?batch=' + action.batch.id}>
              Supplier return
            </Link>
            <Link className={secondaryClass} to={'/insights?batch=' + action.batch.id}>
              Review risk / outcomes
            </Link>
          </div>
        </Modal>
      )}
    </section>
  )
}
function ReceiveForm({
  products,
  suppliers,
  productId,
  ready,
  onClose,
}: {
  products: Product[]
  suppliers: Supplier[]
  productId: string
  ready: boolean
  onClose: () => void
}) {
  const [id, setId] = useState(productId),
    [supplier, setSupplier] = useState(''),
    [number, setNumber] = useState(() => 'B-' + Date.now().toString(36).toUpperCase()),
    [quantity, setQuantity] = useState('1'),
    [cost, setCost] = useState(
      String(products.find((product) => product.id === productId)?.purchasePrice ?? '')
    ),
    [choice, setChoice] = useState<'' | 'yes' | 'no'>(''),
    [expiry, setExpiry] = useState(''),
    [notes, setNotes] = useState(''),
    [source, setSource] = useState<'receipt' | 'customer-return'>('receipt')
  const request = useRef(doc(collection(db, 'batches')).id)
  return (
    <FormModal
      title="Receive batch"
      label="Receive stock"
      ready={ready}
      onClose={onClose}
      onSubmit={async () => {
        const product = products.find((item) => item.id === id)
        if (!product) throw new Error('Select a product.')
        await receiveBatch(
          product,
          {
            batchNumber: number,
            quantity: Number(quantity),
            unitCost: Number(cost),
            expiryDate: choiceDate(choice, expiry),
            supplierId: supplier || null,
            notes,
            source,
          },
          request.current
        )
      }}
    >
      <Field label="Product">
        <select
          required
          className={inputClass}
          value={id}
          onChange={(event) => {
            setId(event.target.value)
            setCost(
              String(
                products.find((product) => product.id === event.target.value)?.purchasePrice ?? ''
              )
            )
          }}
        >
          <option value="">Select product</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.productId} · {product.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Receipt type">
        <select
          className={inputClass}
          value={source}
          onChange={(event) => setSource(event.target.value as typeof source)}
        >
          <option value="receipt">New receipt / restock</option>
          <option value="customer-return">Customer return (no refund)</option>
        </select>
      </Field>
      <Field label="Supplier">
        <select
          className={inputClass}
          value={supplier}
          onChange={(event) => setSupplier(event.target.value)}
        >
          <option value="">Not recorded</option>
          {suppliers
            .filter((item) => item.active)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Internal batch reference / supplier lot">
        <TextInput required maxLength={80} value={number} onChange={setNumber} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quantity received">
          <TextInput
            required
            type="number"
            min={1}
            max={1000000}
            step="1"
            value={quantity}
            onChange={setQuantity}
          />
        </Field>
        <Field label="Purchase unit cost (LKR)">
          <TextInput
            required
            type="number"
            min={0}
            max={1e10}
            step="0.01"
            value={cost}
            onChange={setCost}
          />
        </Field>
      </div>
      <ExpiryChoice value={expiry} onChange={setExpiry} choice={choice} onChoice={setChoice} />
      <Field label="Notes">
        <TextInput maxLength={1000} value={notes} onChange={setNotes} />
      </Field>
    </FormModal>
  )
}
function BatchForm({
  batch,
  suppliers,
  ready,
  onClose,
}: {
  batch: Batch
  suppliers: Supplier[]
  ready: boolean
  onClose: () => void
}) {
  const [number, setNumber] = useState(batch.batchNumber),
    [quantity, setQuantity] = useState(String(batch.quantity)),
    [supplier, setSupplier] = useState(batch.supplierId || ''),
    [choice, setChoice] = useState<'' | 'yes' | 'no'>(batch.expiryDate ? 'yes' : 'no'),
    [expiry, setExpiry] = useState(dateInput(batch.expiryDate)),
    [notes, setNotes] = useState(batch.notes),
    [reason, setReason] = useState(''),
    [disposal, setDisposal] = useState(false),
    request = useRef(doc(collection(db, 'stockOperations')).id)
  return (
    <FormModal
      title={'Adjust ' + batch.batchNumber}
      ready={ready}
      onClose={onClose}
      onSubmit={() =>
        changeBatch(
          batch,
          {
            quantity: Number(quantity),
            expiryDate: choiceDate(choice, expiry),
            batchNumber: number,
            notes,
            reason,
            disposal,
            supplierId: supplier || null,
          },
          request.current
        )
      }
    >
      <Field label="Batch reference">
        <TextInput required maxLength={80} value={number} onChange={setNumber} />
      </Field>
      <Field label="Remaining quantity">
        <TextInput
          required
          type="number"
          min={0}
          max={1000000}
          step="1"
          value={quantity}
          onChange={setQuantity}
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={disposal}
          onChange={(event) => setDisposal(event.target.checked)}
        />
        Record reduction as disposal / write-off
      </label>
      <Field label="Supplier">
        <select
          className={inputClass}
          value={supplier}
          onChange={(event) => setSupplier(event.target.value)}
        >
          <option value="">Not recorded</option>
          {suppliers
            .filter((item) => item.active || item.id === batch.supplierId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {!item.active ? ' (archived)' : ''}
              </option>
            ))}
        </select>
      </Field>
      <ExpiryChoice value={expiry} onChange={setExpiry} choice={choice} onChoice={setChoice} />
      <Field label="Reason for correction / disposal">
        <TextInput required maxLength={500} value={reason} onChange={setReason} />
      </Field>
      <Field label="Notes">
        <TextInput value={notes} maxLength={1000} onChange={setNotes} />
      </Field>
      <p className="text-xs text-slate-500">
        Receipt cost remains {amount(batch.unitCostMinor)} per unit. New deliveries belong in a new
        batch.
      </p>
    </FormModal>
  )
}
