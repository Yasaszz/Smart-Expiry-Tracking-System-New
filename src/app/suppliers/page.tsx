import { useState } from 'react'

import type { Supplier } from '../../lib/retail-domain'
import { useRetailCollection } from '../../lib/retail-hooks'
import { saveSupplier, type SupplierInput } from '../../lib/retail-store'
import {
  RetailHeader,
  RetailNotice,
  RetailLoading,
  Empty,
  Pager,
  FormModal,
  Field,
  TextInput,
  tableClass,
  thClass,
  tdClass,
} from '../../lib/retail-ui'
import { ProtectedPage, buttonClass, secondaryClass, inputClass } from '../layout'

export default function SuppliersPage() {
  return (
    <ProtectedPage>
      <Suppliers />
    </ProtectedPage>
  )
}
function Suppliers() {
  const source = useRetailCollection<Supplier>('suppliers'),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('active'),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<Supplier | 'new' | null>(null)
  const rows = source.rows
    .filter(
      (item) =>
        (filter === 'all' || (filter === 'active') === item.active) &&
        `${item.name} ${item.contact} ${item.email} ${item.phone}`
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name))
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 20)))
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <RetailHeader
        title="Suppliers"
        description="Supplier contacts, payment terms and archived records."
      >
        <button className={buttonClass} disabled={!source.ready} onClick={() => setEditing('new')}>
          Add supplier
        </button>
      </RetailHeader>
      <RetailNotice state={source} />
      <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <Field label="Search suppliers">
          <TextInput
            value={search}
            onChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            placeholder="Company, contact, email or phone"
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
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All suppliers</option>
          </select>
        </Field>
      </div>
      {source.loading ? (
        <RetailLoading label="Loading suppliers" />
      ) : (
        !source.error &&
        (rows.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      'Company',
                      'Contact',
                      'Phone / email',
                      'Payment terms',
                      'Status',
                      'Actions',
                    ].map((value) => (
                      <th key={value} className={thClass}>
                        {value}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice((current - 1) * 20, current * 20).map((item) => (
                    <tr key={item.id}>
                      <td className={tdClass}>
                        <p className="font-semibold">{item.name}</p>
                        <p className="mt-1 max-w-xs whitespace-pre-wrap text-xs text-slate-500">
                          {item.address}
                        </p>
                      </td>
                      <td className={tdClass}>{item.contact || '—'}</td>
                      <td className={tdClass}>
                        <p>{item.phone || '—'}</p>
                        <p className="text-xs text-slate-500">{item.email}</p>
                      </td>
                      <td className={tdClass}>{item.paymentTerms || '—'}</td>
                      <td className={tdClass}>{item.active ? 'Active' : 'Archived'}</td>
                      <td className={tdClass}>
                        <button
                          className={secondaryClass}
                          disabled={!source.ready}
                          onClick={() => setEditing(item)}
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={current} setPage={setPage} total={rows.length} />
          </div>
        ) : (
          <Empty>No suppliers match this view.</Empty>
        ))
      )}
      {editing && (
        <SupplierForm
          original={editing === 'new' ? undefined : editing}
          ready={source.ready}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  )
}
function SupplierForm({
  original,
  ready,
  onClose,
}: {
  original?: Supplier
  ready: boolean
  onClose: () => void
}) {
  const [form, setForm] = useState<SupplierInput>({
    name: original?.name || '',
    contact: original?.contact || '',
    email: original?.email || '',
    phone: original?.phone || '',
    address: original?.address || '',
    paymentTerms: original?.paymentTerms || '',
    notes: original?.notes || '',
    active: original?.active ?? true,
  })
  return (
    <FormModal
      title={original ? 'Edit supplier' : 'Add supplier'}
      ready={ready}
      onClose={onClose}
      onSubmit={() => saveSupplier(form, original)}
    >
      {(['name', 'contact', 'email', 'phone', 'address', 'paymentTerms', 'notes'] as const).map(
        (key) => (
          <Field
            key={key}
            label={
              {
                name: 'Company name',
                contact: 'Contact person',
                email: 'Email',
                phone: 'Phone',
                address: 'Address',
                paymentTerms: 'Payment terms',
                notes: 'Notes',
              }[key]
            }
          >
            <TextInput
              value={form[key]}
              onChange={(value) => setForm({ ...form, [key]: value })}
              required={key === 'name'}
              type={key === 'email' ? 'email' : 'text'}
              maxLength={['address', 'notes'].includes(key) ? 1000 : 200}
            />
          </Field>
        )
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(event) => setForm({ ...form, active: event.target.checked })}
        />
        Active supplier
      </label>
      <p className="text-xs leading-5 text-slate-500">
        Archiving preserves receipts, orders and return history. Saving does not contact the
        supplier.
      </p>
    </FormModal>
  )
}
