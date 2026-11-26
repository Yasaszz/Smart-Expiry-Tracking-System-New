import { collection, doc } from 'firebase/firestore'
import { useRef, useState } from 'react'

import { useInventory } from '../../lib/app-context'
import { db, dateInput, expiryFromInput, type Product } from '../../lib/firebase'
import type { PurchaseOrder, Supplier } from '../../lib/retail-domain'
import { useRetailCollection } from '../../lib/retail-hooks'
import { saveOrder, orderStatus, receiveOrder } from '../../lib/retail-store'
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
} from '../../lib/retail-ui'
import { ProtectedPage, buttonClass, secondaryClass, inputClass } from '../layout'

export default function OrdersPage() {
  return (
    <ProtectedPage>
      <Orders />
    </ProtectedPage>
  )
}
function Orders() {
  const source = useRetailCollection<PurchaseOrder>('purchaseOrders'),
    suppliers = useRetailCollection<Supplier>('suppliers'),
    inventory = useInventory(),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [action, setAction] = useState<{
      mode: 'edit' | 'receive' | 'order' | 'cancel' | 'details'
      item?: PurchaseOrder
    } | null>(null)
  const rows = source.rows
    .filter(
      (item) =>
        (filter === 'all' || item.status === filter) &&
        `${item.number} ${item.supplierName}`.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20))),
    ready =
      source.ready && suppliers.ready && !inventory.loading && !inventory.stale && !inventory.error
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <RetailHeader
        title="Purchase orders"
        description="Plan purchases and receive deliveries into individual batches."
      >
        <button
          className={buttonClass}
          disabled={
            !ready || !inventory.products.length || !suppliers.rows.some((item) => item.active)
          }
          onClick={() => setAction({ mode: 'edit' })}
        >
          New purchase order
        </button>
      </RetailHeader>
      <RetailNotice state={source} />
      {suppliers.error && <RetailNotice state={suppliers} />}
      {!source.loading && !source.error && (
        <Summary
          items={[
            {
              label: 'Open orders',
              value: String(
                source.rows.filter((item) => ['draft', 'ordered', 'partial'].includes(item.status))
                  .length
              ),
            },
            {
              label: 'Open expected cost',
              value: amount(
                source.rows
                  .filter((item) => ['ordered', 'partial'].includes(item.status))
                  .reduce((sum, item) => sum + item.totalMinor - item.receivedMinor, 0)
              ),
            },
            {
              label: 'Received purchase cost',
              value: amount(source.rows.reduce((sum, item) => sum + item.receivedMinor, 0)),
            },
            {
              label: 'Partially received',
              value: String(source.rows.filter((item) => item.status === 'partial').length),
            },
          ]}
        />
      )}
      <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <Field label="Search orders">
          <TextInput
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Order or supplier"
          />
        </Field>
        <Field label="Status">
          <select
            className={inputClass}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
              setPage(1)
            }}
          >
            {['all', 'draft', 'ordered', 'partial', 'received', 'cancelled'].map((value) => (
              <option key={value} value={value}>
                {value === 'partial'
                  ? 'Partially received'
                  : value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {source.loading ? (
        <RetailLoading label="Loading purchase orders" />
      ) : (
        !source.error &&
        (rows.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      'Order / supplier',
                      'Status',
                      'Expected delivery',
                      'Ordered cost',
                      'Received cost',
                      'Actions',
                    ].map((label) => (
                      <th className={thClass} key={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice((current - 1) * 20, current * 20).map((item) => (
                    <tr key={item.id}>
                      <td className={tdClass}>
                        <p className="font-semibold">{item.number}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.supplierName} · {item.lines.length} lines
                        </p>
                      </td>
                      <td className={tdClass}>
                        {item.status === 'partial' ? 'Partially received' : item.status}
                      </td>
                      <td className={tdClass}>
                        {item.expectedDate ? dateInput(item.expectedDate) : 'Not set'}
                      </td>
                      <td className={tdClass}>{amount(item.totalMinor)}</td>
                      <td className={tdClass}>{amount(item.receivedMinor)}</td>
                      <td className={tdClass}>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={secondaryClass}
                            onClick={() => setAction({ mode: 'details', item })}
                          >
                            Details
                          </button>
                          {item.status === 'draft' && (
                            <>
                              <button
                                className={secondaryClass}
                                disabled={!ready}
                                onClick={() => setAction({ mode: 'edit', item })}
                              >
                                Edit
                              </button>
                              <button
                                className={secondaryClass}
                                disabled={!ready}
                                onClick={() => setAction({ mode: 'order', item })}
                              >
                                Mark ordered
                              </button>
                            </>
                          )}
                          {['ordered', 'partial'].includes(item.status) && (
                            <button
                              className={secondaryClass}
                              disabled={!ready}
                              onClick={() => setAction({ mode: 'receive', item })}
                            >
                              Receive
                            </button>
                          )}
                          {['draft', 'ordered', 'partial'].includes(item.status) && (
                            <button
                              className={secondaryClass}
                              disabled={!ready}
                              onClick={() => setAction({ mode: 'cancel', item })}
                            >
                              Cancel remaining
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={current} setPage={setPage} total={rows.length} />
          </div>
        ) : (
          <Empty>No purchase orders match this view.</Empty>
        ))
      )}
      {action?.mode === 'edit' && (
        <OrderForm
          original={action.item}
          suppliers={suppliers.rows}
          products={inventory.products}
          ready={ready}
          onClose={() => setAction(null)}
        />
      )}
      {action?.mode === 'receive' && action.item && (
        <ReceiveOrderForm order={action.item} ready={ready} onClose={() => setAction(null)} />
      )}
      {action?.mode === 'order' && action.item && (
        <FormModal
          title={'Mark ' + action.item.number + ' ordered'}
          label="Mark ordered"
          ready={ready}
          onClose={() => setAction(null)}
          onSubmit={() => orderStatus(action.item!, 'ordered')}
        >
          <p className="text-sm leading-6 text-slate-600">
            This records an order placed with {action.item.supplierName}. It does not send a message
            to the supplier or increase stock.
          </p>
        </FormModal>
      )}
      {action?.mode === 'cancel' && action.item && (
        <FormModal
          title="Cancel outstanding quantities"
          label="Cancel remaining order"
          ready={ready}
          onClose={() => setAction(null)}
          onSubmit={() => orderStatus(action.item!, 'cancelled')}
        >
          <p className="text-sm leading-6 text-slate-600">
            Already received stock and purchase history remain unchanged. The outstanding quantity
            cannot be received after cancellation.
          </p>
        </FormModal>
      )}
      {action?.mode === 'details' && action.item && (
        <FormModal
          title={action.item.number}
          label="Close"
          onClose={() => setAction(null)}
          onSubmit={async () => {}}
        >
          <p className="text-sm">
            {action.item.supplierName} · {action.item.status}
          </p>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  {['Product', 'Ordered', 'Received', 'Unit cost'].map((label) => (
                    <th key={label} className={thClass}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {action.item.lines.map((line) => (
                  <tr key={line.productId}>
                    <td className={tdClass}>
                      {line.productName}
                      <p className="text-xs text-slate-500">{line.productCode}</p>
                    </td>
                    <td className={tdClass}>{line.quantity}</td>
                    <td className={tdClass}>{line.received}</td>
                    <td className={tdClass}>{amount(line.unitCostMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="whitespace-pre-wrap text-xs text-slate-500">
            {action.item.notes || 'No notes'}
          </p>
        </FormModal>
      )}
    </section>
  )
}
function OrderForm({
  original,
  suppliers,
  products,
  ready,
  onClose,
}: {
  original?: PurchaseOrder
  suppliers: Supplier[]
  products: Product[]
  ready: boolean
  onClose: () => void
}) {
  const [supplier, setSupplier] = useState(original?.supplierId || ''),
    [expected, setExpected] = useState(dateInput(original?.expectedDate || null)),
    [notes, setNotes] = useState(original?.notes || ''),
    [lines, setLines] = useState(
      original
        ? original.lines.map((line) => ({
            productId: line.productId,
            quantity: String(line.quantity),
            unitCost: String(line.unitCostMinor / 100),
          }))
        : [{ productId: '', quantity: '1', unitCost: '' }]
    )
  const update = (index: number, field: 'productId' | 'quantity' | 'unitCost', value: string) =>
    setLines((previous) =>
      previous.map((line, i) =>
        i === index
          ? {
              ...line,
              [field]: value,
              ...(field === 'productId'
                ? {
                    unitCost: String(
                      products.find((product) => product.id === value)?.purchasePrice ?? ''
                    ),
                  }
                : {}),
            }
          : line
      )
    )
  const total = lines.reduce(
    (sum, line) =>
      sum + (Number(line.quantity) || 0) * Math.round((Number(line.unitCost) || 0) * 100),
    0
  )
  return (
    <FormModal
      title={original ? 'Edit ' + original.number : 'New purchase order'}
      ready={ready}
      onClose={onClose}
      label="Save draft"
      onSubmit={() =>
        saveOrder(
          {
            supplierId: supplier,
            expectedDate: expected ? expiryFromInput(expected) : null,
            notes,
            lines: lines.map((line) => ({
              productId: line.productId,
              quantity: Number(line.quantity),
              unitCost: Number(line.unitCost),
            })),
          },
          original
        )
      }
    >
      <Field label="Supplier">
        <select
          required
          className={inputClass}
          value={supplier}
          onChange={(event) => setSupplier(event.target.value)}
        >
          <option value="">Choose supplier</option>
          {suppliers
            .filter((item) => item.active || item.id === original?.supplierId)
            .map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
                {!item.active ? ' (archived)' : ''}
              </option>
            ))}
        </select>
      </Field>
      <Field label="Expected delivery date (optional)">
        <TextInput type="date" value={expected} onChange={setExpected} />
      </Field>
      <div className="space-y-4">
        {lines.map((line, index) => (
          <div key={index} className="space-y-3 rounded-lg border border-slate-200 p-4">
            <Field label={'Product ' + (index + 1)}>
              <select
                required
                className={inputClass}
                value={line.productId}
                onChange={(event) => update(index, 'productId', event.target.value)}
              >
                <option value="">Choose product</option>
                {products.map((product) => (
                  <option value={product.id} key={product.id}>
                    {product.productId} · {product.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ordered quantity">
                <TextInput
                  type="number"
                  required
                  min={1}
                  max={1000000}
                  step="1"
                  value={line.quantity}
                  onChange={(value) => update(index, 'quantity', value)}
                />
              </Field>
              <Field label="Unit cost (LKR)">
                <TextInput
                  type="number"
                  required
                  min={0}
                  max={1e10}
                  step="0.01"
                  value={line.unitCost}
                  onChange={(value) => update(index, 'unitCost', value)}
                />
              </Field>
            </div>
            {lines.length > 1 && (
              <button
                type="button"
                className="text-xs text-red-700"
                onClick={() => setLines((previous) => previous.filter((_, i) => i !== index))}
              >
                Remove line
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={lines.length >= 4}
        className={secondaryClass}
        onClick={() =>
          setLines((previous) => [...previous, { productId: '', quantity: '1', unitCost: '' }])
        }
      >
        Add product line
      </button>
      <p className="text-sm font-semibold">Expected order cost: {amount(total)}</p>
      <Field label="Notes">
        <TextInput value={notes} onChange={setNotes} maxLength={1000} />
      </Field>
    </FormModal>
  )
}
function ReceiveOrderForm({
  order,
  ready,
  onClose,
}: {
  order: PurchaseOrder
  ready: boolean
  onClose: () => void
}) {
  const [lines, setLines] = useState(() =>
      order.lines
        .filter((line) => line.received < line.quantity)
        .map((line) => ({
          ...line,
          receive: '0',
          batchNumber: 'B-' + line.productCode + '-' + Date.now().toString(36).toUpperCase(),
          choice: '' as '' | 'yes' | 'no',
          expiry: '',
        }))
    ),
    request = useRef(doc(collection(db, 'purchaseReceipts')).id)
  function patch(index: number, values: Partial<(typeof lines)[number]>) {
    setLines((previous) => previous.map((line, i) => (i === index ? { ...line, ...values } : line)))
  }
  const chosen = lines.filter((line) => Number(line.receive) > 0)
  return (
    <FormModal
      title={'Receive ' + order.number}
      label="Confirm delivery"
      ready={ready}
      onClose={onClose}
      onSubmit={() =>
        receiveOrder(
          order,
          chosen.map((line) => ({
            productId: line.productId,
            quantity: Number(line.receive),
            batchNumber: line.batchNumber,
            expiryDate: choiceDate(line.choice, line.expiry),
          })),
          request.current
        )
      }
    >
      <p className="text-xs leading-5 text-slate-500">
        Receive up to four product lines per confirmation. Additional lines can be received
        separately. Quantities left at zero are not received.
      </p>
      {lines.map((line, index) => (
        <div key={line.productId} className="space-y-3 rounded-lg border border-slate-200 p-4">
          <p className="text-sm font-semibold">{line.productName}</p>
          <p className="text-xs text-slate-500">
            Outstanding: {line.quantity - line.received} units · Agreed cost:{' '}
            {amount(line.unitCostMinor)}
          </p>
          <Field label="Quantity in this delivery">
            <TextInput
              type="number"
              required
              min={0}
              max={line.quantity - line.received}
              step="1"
              value={line.receive}
              onChange={(value) => patch(index, { receive: value })}
            />
          </Field>
          {Number(line.receive) > 0 && (
            <>
              <Field label="Batch reference / supplier lot">
                <TextInput
                  required
                  maxLength={80}
                  value={line.batchNumber}
                  onChange={(value) => patch(index, { batchNumber: value })}
                />
              </Field>
              <ExpiryChoice
                id={'po-expiry-' + index}
                value={line.expiry}
                onChange={(value) => patch(index, { expiry: value })}
                choice={line.choice}
                onChoice={(value) => patch(index, { choice: value })}
              />
            </>
          )}
        </div>
      ))}
      <p className="text-sm font-semibold">
        This delivery:{' '}
        {amount(chosen.reduce((sum, line) => sum + Number(line.receive) * line.unitCostMinor, 0))}
      </p>
    </FormModal>
  )
}
