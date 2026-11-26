import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { useInventory } from '../../lib/app-context'
import {
  dateInput,
  deleteProduct,
  expiryFromInput,
  formatDate,
  getErrorMessage,
  money,
  saveProduct,
  type Product,
  getExpiryLevel,
  expiryLevels,
  isPromotionActive,
} from '../../lib/firebase'
import { useSavedState } from '../../lib/hooks'
import { LoadingSkeleton } from '../../lib/loading-skeleton'
import { Icon } from '../../lib/ui'
import {
  ProtectedPage,
  InventoryNotice,
  ExpiryBadge,
  Modal,
  ErrorNotice,
  buttonClass,
  secondaryClass,
  inputClass,
} from '../layout'

type SavedFilter = {
  name: string
  search: string
  category: string
  expiry: string
  stock: string
  promotion: boolean
  min: string
  max: string
  sort: string
}
function isSavedFilters(value: unknown): value is SavedFilter[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        ['name', 'search', 'category', 'expiry', 'stock', 'min', 'max', 'sort'].every(
          (field) => typeof item[field] === 'string'
        ) &&
        typeof item.promotion === 'boolean'
    )
  )
}
export default function ProductsPage() {
  return (
    <ProtectedPage>
      <Products />
    </ProtectedPage>
  )
}
function Products() {
  const [params] = useSearchParams()
  const inventory = useInventory()
  const [search, setSearch] = useState(() => params.get('search') || '')
  const [category, setCategory] = useState('')
  const [expiry, setExpiry] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(() =>
    params.get('add') === '1' ? 'new' : null
  )
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [page, setPage] = useState(1)
  const [stockFilter, setStockFilter] = useState('')
  const [promotionFilter, setPromotionFilter] = useState(false)
  const [sort, setSort] = useState('id')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [saved, setSaved] = useSavedState<SavedFilter[]>('product-filters', [], isSavedFilters)
  const [recent, setRecent] = useSavedState<string[]>(
    'search-history',
    [],
    (value): value is string[] =>
      Array.isArray(value) && value.every((item) => typeof item === 'string')
  )
  const [filterName, setFilterName] = useState('')
  function rememberSearch(value: string) {
    if (value.trim())
      setRecent([value.trim(), ...recent.filter((item) => item !== value.trim())].slice(0, 10))
  }
  const available = !inventory.loading && !inventory.stale && !inventory.error
  const categories = Array.from(new Set(inventory.products.map((product) => product.category)))
    .filter((value) => value.trim().length > 0)
    .sort((a, b) => a.localeCompare(b))
  const filtered = inventory.products
    .filter(
      (product) =>
        `${product.name} ${product.productId}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()) &&
        (!category || product.category === category) &&
        (!expiry || getExpiryLevel(product.expiryDate) === expiry) &&
        (!stockFilter ||
          (stockFilter === 'out'
            ? product.stockQuantity === 0
            : product.stockQuantity <= (product.lowStockThreshold ?? 5))) &&
        (!promotionFilter || isPromotionActive(product)) &&
        (minPrice === '' || product.sellingPrice >= Number(minPrice)) &&
        (maxPrice === '' || product.sellingPrice <= Number(maxPrice))
    )
    .sort((a, b) =>
      sort === 'name'
        ? a.name.localeCompare(b.name)
        : sort === 'expiry'
          ? (a.expiryDate?.toMillis() ?? Infinity) - (b.expiryDate?.toMillis() ?? Infinity)
          : sort === 'stock'
            ? a.stockQuantity - b.stockQuantity
            : sort === 'price'
              ? a.sellingPrice - b.sellingPrice
              : a.productId.localeCompare(b.productId, undefined, { numeric: true })
    )
  const pages = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pages)
  async function remove() {
    if (!deleting || busy || !available) return
    setBusy(true)
    setError('')
    try {
      await deleteProduct(deleting)
      setDeleting(null)
      setSuccess('Product deleted.')
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-[28px]">
            Products
          </h1>
          <p className="mt-2 text-[13px] text-slate-500">
            Product records, expiry dates and pricing. All amounts in LKR.
          </p>
        </div>
        <button
          disabled={!available}
          onClick={() => {
            setEditing('new')
            setSuccess('')
          }}
          className={buttonClass}
        >
          <Icon name="plus" className="h-4 w-4" /> Add product
        </button>
      </header>
      <InventoryNotice {...inventory} />
      {success && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 text-[13px] text-emerald-800">
          {success}
        </p>
      )}
      <div className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02] sm:grid-cols-3">
        <label htmlFor="search" className="text-[13px] font-medium">
          Search products
          <input
            id="search"
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Name or product ID"
            onBlur={() => rememberSearch(search)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') rememberSearch(search)
            }}
            className={inputClass}
          />
        </label>
        <label htmlFor="category-filter" className="text-[13px] font-medium">
          Category
          <select
            id="category-filter"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value)
              setPage(1)
            }}
            className={inputClass}
          >
            <option value="">All categories</option>
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label htmlFor="expiry-filter" className="text-[13px] font-medium">
          Expiry status
          <select
            id="expiry-filter"
            value={expiry}
            onChange={(event) => {
              setExpiry(event.target.value)
              setPage(1)
            }}
            className={inputClass}
          >
            <option value="">All statuses</option>
            {expiryLevels.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label} ({level.range})
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
        <summary className="cursor-pointer text-[13px] font-semibold">
          Advanced search, sorting & saved filters
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-[13px]">
            Stock
            <select
              value={stockFilter}
              onChange={(event) => {
                setStockFilter(event.target.value)
                setPage(1)
              }}
              className={inputClass}
            >
              <option value="">All stock levels</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </select>
          </label>
          <label className="text-[13px]">
            Sort by
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              className={inputClass}
            >
              <option value="id">Product ID</option>
              <option value="name">Name</option>
              <option value="expiry">Earliest expiry</option>
              <option value="stock">Lowest stock</option>
              <option value="price">Lowest price</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={promotionFilter}
              onChange={(event) => setPromotionFilter(event.target.checked)}
            />
            Active promotions only
          </label>
          <label className="text-[13px]">
            Minimum price
            <input
              type="number"
              min="0"
              step="0.01"
              value={minPrice}
              onChange={(event) => setMinPrice(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="text-[13px]">
            Maximum price
            <input
              type="number"
              min="0"
              step="0.01"
              value={maxPrice}
              onChange={(event) => setMaxPrice(event.target.value)}
              className={inputClass}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={secondaryClass}
            onClick={() => {
              setExpiry('critical')
              setSort('expiry')
            }}
          >
            Critical expiry
          </button>
          <button className={secondaryClass} onClick={() => setStockFilter('low')}>
            Low stock
          </button>
          <button
            className={secondaryClass}
            onClick={() => {
              setSearch('')
              setCategory('')
              setExpiry('')
              setStockFilter('')
              setPromotionFilter(false)
              setMinPrice('')
              setMaxPrice('')
              setSort('id')
              setPage(1)
            }}
          >
            Clear filters
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="text-[13px]">
            Save current filter
            <input
              value={filterName}
              maxLength={60}
              onChange={(event) => setFilterName(event.target.value)}
              className={inputClass}
              placeholder="Filter name"
            />
          </label>
          <button
            className={secondaryClass}
            disabled={!filterName.trim()}
            onClick={() => {
              setSaved(
                [
                  ...saved.filter((item) => item.name !== filterName.trim()),
                  {
                    name: filterName.trim(),
                    search,
                    category,
                    expiry,
                    stock: stockFilter,
                    promotion: promotionFilter,
                    min: minPrice,
                    max: maxPrice,
                    sort,
                  },
                ].slice(-20)
              )
              setFilterName('')
            }}
          >
            Save filter
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {saved.map((item) => (
            <span key={item.name} className="inline-flex rounded-lg border border-indigo-100">
              <button
                className="px-3 py-2 text-[13px] text-indigo-700"
                onClick={() => {
                  setSearch(item.search)
                  setCategory(item.category)
                  setExpiry(item.expiry)
                  setStockFilter(item.stock)
                  setPromotionFilter(item.promotion)
                  setMinPrice(item.min)
                  setMaxPrice(item.max)
                  setSort(item.sort)
                  setPage(1)
                }}
              >
                {item.name}
              </button>
              <button
                className="px-2 text-slate-500"
                aria-label={`Remove filter ${item.name}`}
                onClick={() => setSaved(saved.filter((entry) => entry.name !== item.name))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {recent.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Recent searches:</span>
            {recent.map((value) => (
              <button
                key={value}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs"
                onClick={() => {
                  setSearch(value)
                  setPage(1)
                }}
              >
                {value}
              </button>
            ))}
            <button className="text-xs text-indigo-700" onClick={() => setRecent([])}>
              Clear history
            </button>
          </div>
        )}
      </details>
      {inventory.loading && !inventory.error && (
        <LoadingSkeleton variant="table" label="Loading products" />
      )}
      {!inventory.loading && !inventory.error && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">Products and expiry status</caption>
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wide text-slate-600">
                <tr>
                  {[
                    'Product',
                    'Category',
                    'Stock',
                    'Purchase',
                    'Selling',
                    'Expiry',
                    'Promotion',
                    'Actions',
                  ].map((heading) => (
                    <th
                      scope="col"
                      key={heading}
                      className={`whitespace-nowrap px-5 py-3 ${['Stock', 'Purchase', 'Selling'].includes(heading) ? 'text-right' : ''}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.slice((currentPage - 1) * 20, currentPage * 20).map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4">
                      <p className="font-semibold">{product.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{product.productId}</p>
                    </td>
                    <td className="px-5 py-4">{product.category}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{product.stockQuantity}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">
                      {money(product.purchasePrice)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">
                      {money(product.sellingPrice)}
                    </td>
                    <td className="space-y-2 whitespace-nowrap px-5 py-4">
                      {product.expiryDate && <p>{formatDate(product.expiryDate)}</p>}
                      <ExpiryBadge product={product} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">
                      {isPromotionActive(product)
                        ? money(product.promoPrice)
                        : product.onPromotion
                          ? 'Scheduled / ended'
                          : 'None'}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex gap-2">
                        <button
                          disabled={!available}
                          aria-label={`Edit ${product.name}`}
                          onClick={() => setEditing(product)}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50"
                        >
                          Edit
                        </button>
                        <button
                          disabled={!available}
                          aria-label={`Delete ${product.name}`}
                          onClick={() => {
                            setDeleting(product)
                            setError('')
                          }}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!filtered.length && (
            <p className="p-10 text-center text-[13px] text-slate-500">
              {inventory.products.length
                ? 'No products match your filters.'
                : 'No products recorded. Add a product to begin.'}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-[13px]">
            <span>
              {filtered.length} products · Page {currentPage} of {pages}
            </span>
            <div className="flex gap-2">
              <button
                className={secondaryClass}
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </button>
              <button
                className={secondaryClass}
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <ProductForm
          product={editing === 'new' ? undefined : editing}
          categories={categories}
          available={!!available}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setSuccess('Product saved.')
          }}
        />
      )}
      {deleting && (
        <Modal title="Delete product?" busy={busy} onClose={() => setDeleting(null)}>
          <div className="space-y-5">
            <ErrorNotice message={error} />
            <p className="text-[13px] leading-6 text-slate-600">
              Delete {deleting.name} ({deleting.productId}) and remove its {deleting.stockQuantity}{' '}
              units from inventory? Existing sales and stock history will be kept.
            </p>
            <div className="flex justify-end gap-3">
              <button disabled={busy} className={secondaryClass} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                disabled={busy || !available}
                className={buttonClass}
                onClick={() => void remove()}
              >
                {busy ? 'Deleting...' : 'Delete product'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}
function ProductForm({
  product,
  categories,
  available,
  onClose,
  onSaved,
}: {
  product?: Product
  categories: string[]
  available: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(product?.name || '')
  const [category, setCategory] = useState(product?.category || '')
  const [imageUrl, setImageUrl] = useState(product?.imageUrl || '')
  const [threshold, setThreshold] = useState(String(product?.lowStockThreshold ?? 5))
  const [quantity, setQuantity] = useState(String(product?.stockQuantity ?? 0))
  const [purchase, setPurchase] = useState(String(product?.purchasePrice ?? ''))
  const [selling, setSelling] = useState(String(product?.sellingPrice ?? ''))
  const [hasExpiry, setHasExpiry] = useState<'' | 'yes' | 'no'>(
    product ? (product.expiryDate ? 'yes' : 'no') : ''
  )
  const [expiry, setExpiry] = useState(product ? dateInput(product.expiryDate) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !available) return
    if (!hasExpiry) {
      setError('Select whether this product has an expiry date.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveProduct(
        {
          name,
          category,
          barcode: product?.barcode,
          imageUrl,
          lowStockThreshold: Number(threshold),
          promotionStartDate: product?.promotionStartDate ?? null,
          promotionEndDate: product?.promotionEndDate ?? null,
          stockQuantity: Number(quantity),
          purchasePrice: Number(purchase),
          sellingPrice: Number(selling),
          expiryDate: hasExpiry === 'yes' ? expiryFromInput(expiry) : null,
          onPromotion: product?.onPromotion ?? false,
          promoPrice: product?.promoPrice ?? 0,
        },
        product
      )
      onSaved()
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={product ? `Edit ${product.productId}` : 'Add product'}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-5">
        <ErrorNotice message={error} />
        {!available && (
          <p className="text-[13px] text-amber-800">
            Saving is unavailable until inventory is synchronized.
          </p>
        )}
        <fieldset disabled={busy} className="space-y-4">
          <label htmlFor="product-name" className="block text-[13px] font-medium">
            Product name
            <input
              id="product-name"
              required
              maxLength={150}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
            />
          </label>
          <label htmlFor="product-category" className="block text-[13px] font-medium">
            Category
            <input
              id="product-category"
              list="product-category-options"
              autoComplete="off"
              placeholder="Select or type a category"
              aria-describedby="product-category-help"
              required
              maxLength={80}
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className={inputClass}
            />
            <datalist id="product-category-options">
              {categories.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            <span
              id="product-category-help"
              className="mt-1.5 block text-xs font-normal text-slate-500"
            >
              Select a category or enter a new one.
            </span>
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[13px] font-medium">
              Low stock threshold
              <input
                required
                type="number"
                min="0"
                step="1"
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label htmlFor="purchase" className="text-[13px] font-medium">
              Purchase price (LKR)
              <input
                id="purchase"
                type="number"
                required
                min="0"
                max="10000000000"
                step="0.01"
                value={purchase}
                readOnly={product?.batchManaged}
                onChange={(event) => setPurchase(event.target.value)}
                className={inputClass}
              />
            </label>
            <label htmlFor="selling" className="text-[13px] font-medium">
              Selling price (LKR)
              <input
                id="selling"
                type="number"
                required
                min="0"
                max="10000000000"
                step="0.01"
                value={selling}
                onChange={(event) => setSelling(event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          {product?.batchManaged ? (
            <p className="rounded-lg bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              Stock, purchase value and expiry dates are managed per batch.{' '}
              <Link to={'/batches?product=' + product.id} className="font-semibold text-indigo-600">
                Manage batches
              </Link>
            </p>
          ) : (
            <>
              <label htmlFor="has-expiry" className="block text-[13px] font-medium">
                Does this product have an expiry date?
                <select
                  id="has-expiry"
                  required
                  value={hasExpiry}
                  onChange={(event) => setHasExpiry(event.target.value as typeof hasExpiry)}
                  className={inputClass}
                >
                  <option value="" disabled>
                    Select Yes or No
                  </option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              {hasExpiry === 'yes' && (
                <label htmlFor="expiry-date" className="block text-[13px] font-medium">
                  Expiry date
                  <input
                    id="expiry-date"
                    type="date"
                    required
                    value={expiry}
                    onChange={(event) => setExpiry(event.target.value)}
                    className={inputClass}
                  />
                </label>
              )}
            </>
          )}
          {!product ? (
            <label htmlFor="quantity" className="block text-[13px] font-medium">
              Initial stock quantity
              <input
                id="quantity"
                type="number"
                min="0"
                step="1"
                max={1000000}
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className={inputClass}
              />
            </label>
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              Receive or adjust quantities on the Batches page to preserve stock history.
            </p>
          )}
          <label className="block text-[13px] font-medium">
            Product image URL (optional)
            <input
              type="url"
              value={imageUrl}
              onChange={(event) => setImageUrl(event.target.value)}
              maxLength={2000}
              placeholder="https://..."
              className={inputClass}
            />
            <span className="mt-1 block text-xs font-normal text-slate-500">
              Used in email alert summaries. HTTPS images only.
            </span>
          </label>
        </fieldset>
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className={secondaryClass}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !available} className={buttonClass}>
            {busy ? 'Saving...' : 'Save product'}
          </button>
        </div>
        {!product && (
          <p className="text-xs text-slate-500">
            Product IDs are assigned automatically when saved.
          </p>
        )}
      </form>
    </Modal>
  )
}
