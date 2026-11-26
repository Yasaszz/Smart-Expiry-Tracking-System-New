import { Timestamp } from 'firebase/firestore'
import {
  useState,
  useId,
  cloneElement,
  isValidElement,
  type FormEvent,
  type ReactNode,
  type ReactElement,
} from 'react'

import { ErrorNotice, Modal, buttonClass, secondaryClass, inputClass } from '../app/layout'
import { dateInput, expiryFromInput, money } from './firebase'
import { LoadingSkeleton } from './loading-skeleton'

export const amount = (value: number) => money(value / 100)
export const tableClass = 'w-full text-left text-[13px]'
export const thClass = 'whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-500'
export const tdClass = 'px-4 py-4 align-top'
export function RetailNotice({
  state,
}: {
  state: { loading: boolean; stale: boolean; error: string; retry: () => void }
}) {
  return (
    <>
      <ErrorNotice message={state.error} />
      {state.error && (
        <button className={secondaryClass} onClick={state.retry}>
          Reconnect
        </button>
      )}
      {!state.loading && state.stale && !state.error && (
        <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          Last confirmed records. Changes are paused until synchronized.
        </p>
      )}
    </>
  )
}
export function RetailLoading({ label = 'Loading records' }: { label?: string }) {
  return <LoadingSkeleton label={label} />
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-slate-200 bg-white p-8 text-center text-[13px] text-slate-500">
      {children}
    </p>
  )
}
export function RetailHeader({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
          {title}
        </h1>
        <p className="mt-2 text-[13px] text-slate-500">{description}</p>
      </div>
      {children}
    </header>
  )
}
export function Pager({
  page,
  setPage,
  total,
  size = 20,
}: {
  page: number
  setPage: (value: number) => void
  total: number
  size?: number
}) {
  const pages = Math.max(1, Math.ceil(total / size)),
    current = Math.min(page, pages)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-xs text-slate-500">
      <span>
        {total} records · Page {current} of {pages}
      </span>
      <div className="flex gap-2">
        <button
          className={secondaryClass}
          disabled={current <= 1}
          onClick={() => setPage(current - 1)}
        >
          Previous
        </button>
        <button
          className={secondaryClass}
          disabled={current >= pages}
          onClick={() => setPage(current + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}
export function ExpiryChoice({
  value,
  onChange,
  choice,
  onChoice,
  id = 'batch-expiry',
}: {
  value: string
  onChange: (value: string) => void
  choice: '' | 'yes' | 'no'
  onChoice: (value: '' | 'yes' | 'no') => void
  id?: string
}) {
  return (
    <div className="space-y-4">
      <label className="block text-[13px] font-medium" htmlFor={id + '-choice'}>
        Does this batch have an expiry date?
        <select
          id={id + '-choice'}
          className={inputClass}
          required
          value={choice}
          onChange={(event) => onChoice(event.target.value as typeof choice)}
        >
          <option value="" disabled>
            Select Yes or No
          </option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </label>
      {choice === 'yes' && (
        <label className="block text-[13px] font-medium" htmlFor={id}>
          Expiry date
          <input
            id={id}
            type="date"
            required
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className={inputClass}
          />
        </label>
      )}
    </div>
  )
}
export const choiceDate = (choice: '' | 'yes' | 'no', value: string): Timestamp | null => {
  if (!choice) throw new Error('Select whether the batch has an expiry date.')
  return choice === 'yes' ? expiryFromInput(value) : null
}
export function FormModal({
  title,
  children,
  onClose,
  onSubmit,
  label = 'Save',
  ready = true,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  onSubmit: () => Promise<void>
  label?: string
  ready?: boolean
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !ready) return
    setBusy(true)
    setError('')
    try {
      await onSubmit()
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The change could not be saved.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={title} busy={busy} onClose={onClose}>
      <form className="space-y-5" onSubmit={(event) => void submit(event)}>
        <ErrorNotice message={error} />
        {!ready && (
          <p className="text-xs text-amber-800">
            Saving is paused until all required records are synchronized.
          </p>
        )}
        <fieldset disabled={busy || !ready} className="space-y-4">
          {children}
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className={secondaryClass}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !ready} className={buttonClass}>
            {busy ? 'Saving…' : label}
          </button>
        </div>
      </form>
    </Modal>
  )
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const generatedId = useId()
  const control = isValidElement<{ id?: string }>(children) ? children : null
  const id = control?.props.id || generatedId
  return (
    <div>
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      {control ? cloneElement(control as ReactElement<{ id?: string }>, { id }) : children}
    </div>
  )
}
export function Summary({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs text-slate-500">{item.label}</p>
          <p className="mt-3 break-words text-xl font-semibold tabular-nums">{item.value}</p>
        </div>
      ))}
    </div>
  )
}
export function TextInput({
  value,
  onChange,
  ...props
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  required?: boolean
  type?: string
  min?: string | number
  max?: string | number
  step?: string
  placeholder?: string
  disabled?: boolean
  maxLength?: number
}) {
  return (
    <input
      {...props}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={inputClass}
    />
  )
}
export function dateText(value: Timestamp | null) {
  return value ? dateInput(value) : 'No expiry date'
}
