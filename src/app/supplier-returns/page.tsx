import { collection, doc } from 'firebase/firestore'
import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { db, dateInput } from '../../lib/firebase'
import type { Batch, SupplierReturn } from '../../lib/retail-domain'
import { useRetailCollection } from '../../lib/retail-hooks'
import { returnToSupplier, settleReturn } from '../../lib/retail-store'
import {
  RetailHeader,
  RetailNotice,
  RetailLoading,
  Empty,
  Pager,
  FormModal,
  Field,
  TextInput,
  Summary,
  amount,
  tableClass,
  thClass,
  tdClass,
} from '../../lib/retail-ui'
import { ProtectedPage, buttonClass, secondaryClass, inputClass } from '../layout'

export default function ReturnsPage() {
  return (
    <ProtectedPage>
      <Returns />
    </ProtectedPage>
  )
}
function Returns() {
  const source = useRetailCollection<SupplierReturn>('supplierReturns'),
    batches = useRetailCollection<Batch>('batches'),
    [params] = useSearchParams(),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [adding, setAdding] = useState(params.has('batch')),
    [settling, setSettling] = useState<SupplierReturn | null>(null)
  const ready = source.ready && batches.ready,
    rows = source.rows
      .filter(
        (item) =>
          (filter === 'all' || item.status === filter) &&
          `${item.productName} ${item.supplierName} ${item.batchNumber}`
            .toLowerCase()
            .includes(search.toLowerCase())
      )
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis()),
    current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)))
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <RetailHeader
        title="Supplier returns"
        description="Return specific batch quantities and track supplier credit decisions."
      >
        <button className={buttonClass} disabled={!ready} onClick={() => setAdding(true)}>
          Return stock
        </button>
      </RetailHeader>
      <RetailNotice state={source} />
      {batches.error && <RetailNotice state={batches} />}
      {!source.loading && !source.error && (
        <Summary
          items={[
            {
              label: 'Returned units',
              value: String(source.rows.reduce((sum, item) => sum + item.quantity, 0)),
            },
            {
              label: 'Pending expected credit',
              value: amount(
                source.rows
                  .filter((item) => item.status === 'pending')
                  .reduce((sum, item) => sum + item.expectedCreditMinor, 0)
              ),
            },
            {
              label: 'Actual credited amount',
              value: amount(
                source.rows
                  .filter((item) => item.status === 'credited')
                  .reduce((sum, item) => sum + item.creditMinor, 0)
              ),
            },
            {
              label: 'Rejected decisions',
              value: String(source.rows.filter((item) => item.status === 'rejected').length),
            },
          ]}
        />
      )}
      <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <Field label="Search returns">
          <TextInput
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Supplier, product or batch"
          />
        </Field>
        <Field label="Credit status">
          <select
            className={inputClass}
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value)
              setPage(1)
            }}
          >
            {['all', 'pending', 'credited', 'rejected'].map((value) => (
              <option value={value} key={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {source.loading ? (
        <RetailLoading label="Loading supplier returns" />
      ) : (
        !source.error &&
        (rows.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      'Product / batch',
                      'Supplier / date',
                      'Quantity',
                      'Expected credit',
                      'Credit decision',
                      'Reason / reference',
                      'Actions',
                    ].map((label) => (
                      <th key={label} className={thClass}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice((current - 1) * 20, current * 20).map((item) => (
                    <tr key={item.id}>
                      <td className={tdClass}>
                        <p className="font-medium">{item.productName}</p>
                        <p className="text-xs text-slate-500">{item.batchNumber}</p>
                      </td>
                      <td className={tdClass}>
                        {item.supplierName}
                        <p className="text-xs text-slate-500">{dateInput(item.createdAt)}</p>
                      </td>
                      <td className={tdClass}>{item.quantity}</td>
                      <td className={tdClass}>{amount(item.expectedCreditMinor)}</td>
                      <td className={tdClass}>
                        {item.status}
                        <p className="text-xs text-slate-500">
                          {item.status === 'credited'
                            ? amount(item.creditMinor)
                            : 'No credit received'}
                        </p>
                      </td>
                      <td className={tdClass}>
                        <p className="max-w-xs break-words">{item.reason}</p>
                        <p className="text-xs text-slate-500">
                          {item.reference}
                          {item.decisionNotes ? ' · ' + item.decisionNotes : ''}
                        </p>
                      </td>
                      <td className={tdClass}>
                        {item.status === 'pending' && (
                          <button
                            className={secondaryClass}
                            disabled={!ready}
                            onClick={() => setSettling(item)}
                          >
                            Record credit decision
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={current} setPage={setPage} total={rows.length} />
          </div>
        ) : (
          <Empty>No supplier returns match this view.</Empty>
        ))
      )}
      {adding && (
        <ReturnForm
          batches={batches.rows}
          initial={params.get('batch') || ''}
          ready={ready}
          onClose={() => setAdding(false)}
        />
      )}
      {settling && <CreditForm item={settling} ready={ready} onClose={() => setSettling(null)} />}
    </section>
  )
}
function ReturnForm({
  batches,
  initial,
  ready,
  onClose,
}: {
  batches: Batch[]
  initial: string
  ready: boolean
  onClose: () => void
}) {
  const [id, setId] = useState(initial),
    [quantity, setQuantity] = useState('1'),
    [reason, setReason] = useState(''),
    request = useRef(doc(collection(db, 'supplierReturns')).id)
  const batch = batches.find((item) => item.id === id)
  return (
    <FormModal
      title="Return stock to supplier"
      label="Confirm stock return"
      ready={ready}
      onClose={onClose}
      onSubmit={async () => {
        if (!batch) throw new Error('Select a batch with a recorded supplier.')
        await returnToSupplier(batch, Number(quantity), reason, request.current)
      }}
    >
      <Field label="Batch">
        <select
          className={inputClass}
          required
          value={id}
          onChange={(event) => setId(event.target.value)}
        >
          <option value="">Choose batch</option>
          {batches
            .filter((item) => item.quantity > 0 && item.supplierId)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.productName} · {item.batchNumber} · {item.supplierName} · {item.quantity}{' '}
                units
              </option>
            ))}
        </select>
      </Field>
      <Field label="Quantity returned">
        <TextInput
          type="number"
          required
          min={1}
          max={batch?.quantity || 1000000}
          step="1"
          value={quantity}
          onChange={setQuantity}
        />
      </Field>
      <Field label="Return reason">
        <TextInput required maxLength={500} value={reason} onChange={setReason} />
      </Field>
      {batch && (
        <p className="rounded-lg bg-slate-50 p-4 text-sm">
          Expected credit: {amount((Number(quantity) || 0) * batch.unitCostMinor)}. This is an
          estimate, not money received.
        </p>
      )}
      <p className="text-xs leading-5 text-slate-500">
        Confirm when these units are physically returned to the supplier. Stock is deducted
        immediately. Expired batches may be returned. No supplier message is sent.
      </p>
    </FormModal>
  )
}
function CreditForm({
  item,
  ready,
  onClose,
}: {
  item: SupplierReturn
  ready: boolean
  onClose: () => void
}) {
  const [status, setStatus] = useState<'credited' | 'rejected'>('credited'),
    [credit, setCredit] = useState(String(item.expectedCreditMinor / 100)),
    [reference, setReference] = useState(''),
    [notes, setNotes] = useState('')
  return (
    <FormModal
      title="Supplier credit decision"
      ready={ready}
      onClose={onClose}
      onSubmit={() => settleReturn(item, status, Number(credit), reference, notes)}
    >
      <p className="text-sm">
        {item.supplierName} · {item.batchNumber}
      </p>
      <Field label="Decision">
        <select
          className={inputClass}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="credited">Credit received</option>
          <option value="rejected">Credit rejected</option>
        </select>
      </Field>
      {status === 'credited' && (
        <Field label="Actual credit amount (LKR)">
          <TextInput
            required
            type="number"
            min={0}
            max={1e10}
            step="0.01"
            value={credit}
            onChange={setCredit}
          />
        </Field>
      )}
      <Field label={status === 'credited' ? 'Credit-note reference' : 'Decision reference'}>
        <TextInput required maxLength={200} value={reference} onChange={setReference} />
      </Field>
      <Field label="Decision notes">
        <TextInput maxLength={1000} value={notes} onChange={setNotes} />
      </Field>
      <p className="text-xs leading-5 text-slate-500">
        Recording this decision does not change stock again. Rejected credit does not restore
        returned goods; physically returned goods need a new receipt.
      </p>
    </FormModal>
  )
}
