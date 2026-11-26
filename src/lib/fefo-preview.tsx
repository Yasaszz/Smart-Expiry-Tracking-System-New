import { useInventory } from './app-context'
import { dateInput, type Product } from './firebase'
import { allocateFefo } from './retail-domain'
import { openingBatch } from './retail-store'

export default function FefoPreview({ product, quantity }: { product: Product; quantity: number }) {
  const inventory = useInventory()
  if (inventory.batchError)
    return (
      <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        {inventory.batchError}
      </p>
    )
  if (inventory.batchLoading || inventory.batchStale)
    return (
      <p role="status" className="text-xs text-slate-500">
        Waiting for synchronized batches…
      </p>
    )
  const batches = product.batchManaged
    ? inventory.batches.filter((batch) => batch.productId === product.id)
    : [openingBatch(product)]
  if (!Number.isSafeInteger(quantity) || quantity < 1) return null
  let allocation: ReturnType<typeof allocateFefo> = [],
    message = ''
  try {
    allocation = allocateFefo(batches, quantity)
  } catch (error) {
    message = error instanceof Error ? error.message : 'The allocation is unavailable.'
  }
  if (message)
    return (
      <p role="alert" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        {message}
      </p>
    )
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h3 className="text-xs font-semibold">Earliest-expiry allocation</h3>
      {!product.batchManaged && (
        <p className="text-xs text-slate-500">
          The existing balance will be converted to one labelled legacy batch without changing
          stock.
        </p>
      )}
      <ul className="space-y-3">
        {allocation.map((item) => {
          const batch = batches.find((batch) => batch.id === item.batchId)!
          return (
            <li key={item.batchId} className="flex flex-wrap justify-between gap-2 text-xs">
              <span>
                {item.batchNumber}
                <span className="block text-slate-500">
                  {item.expiryDate ? dateInput(item.expiryDate) : 'No expiry date'}
                </span>
              </span>
              <span>
                {item.quantity} units · {batch.quantity - item.quantity} left
              </span>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] leading-5 text-slate-500">
        Expired batches are excluded. Quantities and prices are rechecked atomically when
        confirming.
      </p>
    </div>
  )
}
