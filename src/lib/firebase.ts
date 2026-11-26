import { FirebaseError, getApp, getApps, initializeApp, initializeServerApp } from 'firebase/app'
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User as AuthUser,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocsFromServer,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  Timestamp,
  orderBy,
  query,
  limit,
  where,
  type Unsubscribe,
} from 'firebase/firestore'

import { minor, safeTotal } from './retail-domain'

export interface Product {
  id: string
  productId: string
  name: string
  category: string
  quantity: number
  stockQuantity: number
  purchasePrice: number
  sellingPrice: number
  expiryDate: Timestamp | null
  onPromotion: boolean
  promoPrice: number
  createdAt: Timestamp
  batchManaged?: boolean
  activeBatchIds?: string[]
  stockVersion?: number
  stockValueMinor?: number
  sellableQuantity?: number
  lastOperationId?: string
  archived?: boolean
  barcode?: string
  imageUrl?: string
  lowStockThreshold?: number
  promotionStartDate?: Timestamp | null
  promotionEndDate?: Timestamp | null
  promotionHistory?: PromotionEvent[]
}
export interface PromotionEvent {
  enabled: boolean
  price: number
  discountPercent: number
  startDate: Timestamp | null
  endDate: Timestamp | null
  changedAt: Timestamp
  userId: string
}
export interface User {
  uid: string
  name: string
  email: string
  role: 'staff' | 'admin'
  createdAt: Timestamp
}
export interface Sale {
  saleId: string
  productId: string
  productName: string
  quantity: number
  unitPrice: number
  totalAmount: number
  customerName: string
  timestamp: Timestamp
  userId: string
  purchaseUnitPrice?: number
  promotionApplied?: boolean
  regularUnitPrice?: number
  costMinor?: number
  productDocId?: string
  batchAllocations?: import('./retail-domain').Allocation[]
  operationId?: string
}
export interface StockHistory {
  id: string
  productId: string
  productName: string
  previousQuantity: number
  newQuantity: number
  changeType: 'Restock' | 'Adjustment' | 'Damage' | 'Sale'
  reason: string
  timestamp: Timestamp
  movementType?: 'Return'
  movementSource?: string
  unitCost?: number
  totalCost?: number
  eventType?: string
  promotionEvent?: PromotionEvent
  operationId?: string
  batchIds?: string[]
  writeOffMinor?: number
  supplierReturnId?: string
}
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
for (const key of ['apiKey', 'authDomain', 'projectId', 'appId'] as const) {
  if (!config[key]) throw new Error(`Missing Firebase environment setting: ${key}`)
}
export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

// Bini's Node prerender uses the Web SDK's server app without a user token.
// Static HTML is public; user sessions are resolved in the browser after hydration.
export const app = isBrowser
  ? getApps().some((instance) => instance.name === '[DEFAULT]')
    ? getApp()
    : initializeApp(config)
  : initializeServerApp(config, {})
export const auth = getAuth(app)
export const db = getFirestore(app)

function requireBrowser(): void {
  if (!isBrowser) throw new Error('This action is available after the page loads in your browser.')
}

// Firestore Security Rules must enforce access and prevent client role escalation.
export async function ensureUserProfile(user: AuthUser, name?: string): Promise<void> {
  requireBrowser()
  const ref = doc(db, 'users', user.uid)
  try {
    await runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref)
      if (!existing.exists())
        transaction.set(ref, {
          uid: user.uid,
          name: name?.trim() || user.displayName || user.email?.split('@')[0] || 'Store team',
          email: user.email || '',
          role: 'staff',
          createdAt: serverTimestamp(),
        })
    })
  } catch (error) {
    throw new Error(
      `Authentication succeeded, but profile setup failed. ${getErrorMessage(error, 'reading or creating your users profile')}`
    )
  }
}
export async function registerWithEmail(name: string, email: string, password: string) {
  requireBrowser()
  if (!name.trim()) throw new Error('Enter your name.')
  if (password.length < 8) throw new Error('Use at least 8 characters for your password.')
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password)
  await updateProfile(user, { displayName: name.trim() })
  // Login retries profile creation if a temporary Firestore failure occurs here.
  await ensureUserProfile(user, name)
  return user
}
export async function loginWithEmail(email: string, password: string) {
  requireBrowser()
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password)
  await ensureUserProfile(user)
  return user
}
export async function loginWithGoogle() {
  requireBrowser()
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  const { user } = await signInWithPopup(auth, provider)
  await ensureUserProfile(user)
  return user
}
export const logout = async () => {
  requireBrowser()
  await signOut(auth)
}
export const subscribeToAuth = (
  callback: (user: AuthUser | null) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  if (!isBrowser) return () => {}
  return onAuthStateChanged(auth, callback, onError)
}
export async function getUserProfile(uid: string): Promise<User | null> {
  requireBrowser()
  const snapshot = await getDoc(doc(db, 'users', uid))
  return snapshot.exists() ? ({ ...snapshot.data(), uid: snapshot.id } as User) : null
}
export function subscribeToProducts(
  onChange: (products: Product[]) => void,
  onError: (error: Error) => void,
  onSync?: (fromCache: boolean) => void
): Unsubscribe {
  if (!isBrowser) return () => {}
  return onSnapshot(
    collection(db, 'products'),
    { includeMetadataChanges: true },
    (snapshot) => {
      onSync?.(snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites)
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return
      try {
        onChange(
          snapshot.docs
            .map((item) => readProduct(item.id, item.data()))
            .filter((product) => !product.archived)
            .sort((a, b) => a.productId.localeCompare(b.productId, undefined, { numeric: true }))
        )
      } catch (error) {
        onError(error instanceof Error ? error : new Error('Invalid inventory data.'))
      }
    },
    (error) => onError(new Error(getErrorMessage(error, 'reading products')))
  )
}

export type ProductInput = Omit<
  Product,
  | 'id'
  | 'productId'
  | 'createdAt'
  | 'quantity'
  | 'promotionHistory'
  | 'batchManaged'
  | 'activeBatchIds'
  | 'stockVersion'
  | 'stockValueMinor'
  | 'sellableQuantity'
  | 'lastOperationId'
  | 'archived'
>
export const money = (amount: number) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(amount)
export const formatDate = (date: Timestamp | null) =>
  date ? date.toDate().toLocaleDateString('en-GB') : 'No expiry date'
export function dateInput(date: Timestamp | null) {
  if (!date) return ''
  const value = date.toDate()
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
export function expiryFromInput(value: string): Timestamp {
  const date = new Date(`${value}T00:00:00`)
  if (!value || !Number.isFinite(date.getTime())) throw new Error('Choose a valid expiry date.')
  return Timestamp.fromDate(date)
}
function validQuantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error('Quantity must be a non-negative whole number.')
}
function validMoney(value: number) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e10 ||
    Math.abs(value * 100 - Math.round(value * 100)) > 0.0001
  )
    throw new Error('Prices must be non-negative amounts with at most two decimal places.')
}
export function readProduct(id: string, data: Record<string, unknown>): Product {
  if (
    typeof data.productId !== 'string' ||
    typeof data.name !== 'string' ||
    typeof data.category !== 'string' ||
    (data.expiryDate != null && !(data.expiryDate instanceof Timestamp)) ||
    !(data.createdAt instanceof Timestamp) ||
    typeof data.onPromotion !== 'boolean'
  )
    throw new Error(
      `Product ${id} has invalid or missing fields. Correct this record in Firestore.`
    )
  validQuantity(data.stockQuantity as number)
  validQuantity(data.quantity as number)
  if (data.stockQuantity !== data.quantity)
    throw new Error(
      `Product ${data.productId} has conflicting quantity fields. Correct this record in Firestore.`
    )
  for (const key of ['purchasePrice', 'sellingPrice', 'promoPrice']) validMoney(data[key] as number)
  for (const key of ['promotionStartDate', 'promotionEndDate']) {
    if (data[key] != null && !(data[key] instanceof Timestamp))
      throw new Error(`Product ${id} has an invalid promotion date.`)
  }
  if (data.batchManaged) {
    if (
      !Array.isArray(data.activeBatchIds) ||
      data.activeBatchIds.length > 40 ||
      data.activeBatchIds.some((id) => typeof id !== 'string') ||
      new Set(data.activeBatchIds).size !== data.activeBatchIds.length ||
      !Number.isSafeInteger(data.stockValueMinor) ||
      Number(data.stockValueMinor) < 0 ||
      !Number.isInteger(data.stockVersion) ||
      Number(data.stockVersion) < 1
    )
      throw new Error(`Product ${id} has an invalid batch registry or stock value.`)
  }
  if (data.lowStockThreshold !== undefined) validQuantity(data.lowStockThreshold as number)
  if (data.barcode !== undefined && typeof data.barcode !== 'string')
    throw new Error(`Product ${id} has an invalid barcode.`)
  if (data.imageUrl !== undefined && typeof data.imageUrl !== 'string')
    throw new Error(`Product ${id} has an invalid image URL.`)
  if (
    data.promotionHistory !== undefined &&
    (!Array.isArray(data.promotionHistory) ||
      data.promotionHistory.some(
        (item) =>
          !item ||
          !(item.changedAt instanceof Timestamp) ||
          typeof item.enabled !== 'boolean' ||
          !Number.isFinite(item.price) ||
          !Number.isFinite(item.discountPercent)
      ))
  )
    throw new Error(`Product ${id} has an invalid promotion history.`)
  return { ...data, expiryDate: data.expiryDate ?? null, id } as Product
}
function validateProduct(input: ProductInput) {
  if (!input.name.trim() || !input.category.trim())
    throw new Error('Name and category are required.')
  validQuantity(input.stockQuantity)
  if (input.stockQuantity > 1000000)
    throw new Error('Stock quantity must not exceed 1,000,000 units.')
  ;[input.purchasePrice, input.sellingPrice, input.promoPrice].forEach(validMoney)
  if (input.onPromotion && input.promoPrice >= input.sellingPrice)
    throw new Error('Promotion price must be lower than selling price.')
  if (input.expiryDate !== null && !(input.expiryDate instanceof Timestamp))
    throw new Error('Choose an expiry date or select No expiry date.')
  validQuantity(input.lowStockThreshold ?? 5)
  if ((input.barcode?.length ?? 0) > 100)
    throw new Error('Barcode must be 100 characters or fewer.')
  if (input.imageUrl?.trim()) {
    try {
      if (new URL(input.imageUrl.trim()).protocol !== 'https:') throw new Error()
    } catch {
      throw new Error('Product images must use a valid HTTPS URL.')
    }
  }
  if (!!input.promotionStartDate !== !!input.promotionEndDate)
    throw new Error('Provide both promotion dates, or leave both blank.')
  if (
    input.promotionStartDate &&
    input.promotionEndDate &&
    input.promotionStartDate > input.promotionEndDate
  )
    throw new Error('Promotion end must be on or after its start.')
  if (input.onPromotion && input.promotionEndDate && daysUntilExpiry(input.promotionEndDate) < 0)
    throw new Error('Promotion end date must not be in the past.')
}
function requireUser() {
  requireBrowser()
  if (!auth.currentUser) throw new Error('Please sign in again.')
  return auth.currentUser
}
export async function saveProduct(input: ProductInput, original?: Product) {
  const user = requireUser()
  validateProduct(input)
  const clean = {
    ...input,
    name: input.name.trim(),
    category: input.category.trim(),
    promoPrice: input.onPromotion ? input.promoPrice : 0,
    barcode: input.barcode?.trim() || '',
    imageUrl: input.imageUrl?.trim() || '',
    lowStockThreshold: input.lowStockThreshold ?? 5,
    promotionStartDate: input.onPromotion ? (input.promotionStartDate ?? null) : null,
    promotionEndDate: input.onPromotion ? (input.promotionEndDate ?? null) : null,
  }
  const promotionEvent: PromotionEvent = {
    enabled: clean.onPromotion,
    price: clean.promoPrice,
    discountPercent:
      clean.sellingPrice > 0
        ? Math.round((1 - clean.promoPrice / clean.sellingPrice) * 10000) / 100
        : 0,
    startDate: clean.promotionStartDate,
    endDate: clean.promotionEndDate,
    changedAt: Timestamp.now(),
    userId: user.uid,
  }
  if (original) {
    const ref = doc(db, 'products', original.id)
    await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(ref)
      if (!snapshot.exists()) throw new Error('This product was deleted.')
      const current = readProduct(snapshot.id, snapshot.data())
      if (
        current.batchManaged &&
        ((input.expiryDate?.toMillis() ?? null) !== (current.expiryDate?.toMillis() ?? null) ||
          input.purchasePrice !== current.purchasePrice)
      )
        throw new Error('Batch expiry dates and purchase costs are managed on the Batches page.')
      if (
        !current.batchManaged &&
        input.onPromotion &&
        input.expiryDate &&
        input.promotionEndDate &&
        input.promotionEndDate > input.expiryDate
      )
        throw new Error('A promotion cannot end after product expiry.')
      for (const field of [
        'name',
        'category',
        'purchasePrice',
        'sellingPrice',
        'onPromotion',
        'promoPrice',
      ] as const) {
        if (current[field] !== original[field])
          throw new Error('This product changed. Close this form and reopen the latest record.')
      }
      if ((current.expiryDate?.toMillis() ?? null) !== (original.expiryDate?.toMillis() ?? null))
        throw new Error('The expiry date changed. Reopen the latest record.')
      for (const field of ['barcode', 'imageUrl', 'lowStockThreshold'] as const) {
        if (current[field] !== original[field])
          throw new Error('This product changed. Reopen the latest record.')
      }
      for (const field of ['promotionStartDate', 'promotionEndDate'] as const) {
        if ((current[field]?.toMillis() ?? null) !== (original[field]?.toMillis() ?? null))
          throw new Error('Promotion dates changed. Reopen the latest record.')
      }
      const promotionChanged =
        clean.onPromotion !== current.onPromotion ||
        clean.promoPrice !== current.promoPrice ||
        (clean.onPromotion && clean.sellingPrice !== current.sellingPrice) ||
        (clean.promotionStartDate?.toMillis() ?? null) !==
          (current.promotionStartDate?.toMillis() ?? null) ||
        (clean.promotionEndDate?.toMillis() ?? null) !==
          (current.promotionEndDate?.toMillis() ?? null)
      // Quantities are managed exclusively by the stock transaction after creation.
      if (promotionChanged) {
        const audit = doc(collection(db, 'StockHistory'))
        tx.set(audit, {
          id: audit.id,
          productId: current.productId,
          productName: clean.name,
          previousQuantity: current.stockQuantity,
          newQuantity: current.stockQuantity,
          changeType: 'Adjustment',
          reason: clean.onPromotion ? 'Promotion created or updated' : 'Promotion disabled',
          eventType: 'promotion',
          batchIds: current.activeBatchIds || [],
          promotionEvent,
          timestamp: serverTimestamp(),
        })
      }
      tx.update(ref, {
        ...clean,
        stockQuantity: current.stockQuantity,
        quantity: current.stockQuantity,
        promotionHistory: promotionChanged
          ? [...(current.promotionHistory ?? []), promotionEvent].slice(-200)
          : (current.promotionHistory ?? []),
      })
    })
    return
  }
  const existing = await getDocsFromServer(collection(db, 'products'))
  const highest = existing.docs.reduce((max, item) => {
    const match = /^P(\d+)$/.exec(String(item.data().productId))
    return Math.max(max, match ? Number(match[1]) : 0)
  }, 0)
  const counter = doc(db, 'counters', 'products')
  const history = doc(collection(db, 'StockHistory'))
  const openingOperation = doc(collection(db, 'stockOperations'))
  await runTransaction(db, async (tx) => {
    const sequence = await tx.get(counter)
    const last = sequence.exists() ? sequence.data().lastId : 0
    if (!Number.isSafeInteger(last) || last < 0)
      throw new Error('The product ID counter is invalid.')
    const next = Math.max(highest, last) + 1
    if (!Number.isSafeInteger(next)) throw new Error('Product ID exceeds the supported range.')
    const productId = `P${String(next).padStart(3, '0')}`
    const ref = doc(db, 'products', productId)
    if ((await tx.get(ref)).exists()) throw new Error('Product ID collision. Please retry.')
    const batchRef = doc(db, 'batches', `opening-${productId}`)
    if ((await tx.get(batchRef)).exists()) throw new Error('Opening batch ID collision.')
    const costMinor = minor(clean.purchasePrice),
      valueMinor = safeTotal(clean.stockQuantity * costMinor)
    tx.set(counter, { lastId: next })
    tx.set(ref, {
      ...clean,
      productId,
      quantity: clean.stockQuantity,
      createdAt: serverTimestamp(),
      promotionHistory: clean.onPromotion ? [promotionEvent] : [],
      batchManaged: true,
      activeBatchIds: clean.stockQuantity > 0 ? [batchRef.id] : [],
      stockVersion: 1,
      stockValueMinor: valueMinor,
      sellableQuantity: getExpiryStatus(clean.expiryDate) === 'expired' ? 0 : clean.stockQuantity,
      lastOperationId: openingOperation.id,
    })
    tx.set(batchRef, {
      id: batchRef.id,
      productId,
      productCode: productId,
      productName: clean.name,
      batchNumber: `OPEN-${productId}`,
      supplierId: null,
      supplierName: '',
      quantityReceived: clean.stockQuantity,
      quantity: clean.stockQuantity,
      unitCostMinor: costMinor,
      expiryDate: clean.expiryDate,
      receivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      purchaseOrderId: null,
      notes: 'Opening inventory entered with product creation.',
      legacy: false,
      version: 1,
      operationId: openingOperation.id,
    })
    tx.set(openingOperation, {
      id: openingOperation.id,
      productId,
      productCode: productId,
      kind: 'opening',
      previousQuantity: 0,
      newQuantity: clean.stockQuantity,
      previousValueMinor: 0,
      newValueMinor: valueMinor,
      previousVersion: 0,
      nextVersion: 1,
      batchIds: [batchRef.id],
      changes: [
        {
          id: batchRef.id,
          before: 0,
          after: clean.stockQuantity,
          beforeCostMinor: costMinor,
          afterCostMinor: costMinor,
        },
      ],
      referenceId: '',
      userId: user.uid,
      timestamp: serverTimestamp(),
    })
    tx.set(history, {
      id: history.id,
      productId,
      productName: clean.name,
      previousQuantity: 0,
      newQuantity: clean.stockQuantity,
      changeType: 'Restock',
      reason: 'Initial inventory',
      movementSource: 'opening',
      operationId: openingOperation.id,
      batchIds: [batchRef.id],
      ...(clean.onPromotion ? { eventType: 'promotion', promotionEvent } : {}),
      timestamp: serverTimestamp(),
      unitCost: clean.purchasePrice,
      totalCost: Math.round(clean.stockQuantity * Math.round(clean.purchasePrice * 100)) / 100,
    })
  })
}
export async function deleteProduct(product: Product) {
  requireUser()
  const ref = doc(db, 'products', product.id)
  const history = doc(collection(db, 'StockHistory'))
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists()) throw new Error('This product was already deleted.')
    const current = readProduct(snapshot.id, snapshot.data())
    if (current.stockQuantity !== product.stockQuantity)
      throw new Error('Stock changed. Review the latest quantity before deleting.')
    if (current.batchManaged && current.stockQuantity > 0)
      throw new Error('Dispose of or return remaining batches before archiving this product.')
    if (current.batchManaged) tx.update(ref, { archived: true })
    else tx.delete(ref)
    tx.set(history, {
      id: history.id,
      productId: current.productId,
      productName: current.name,
      previousQuantity: current.stockQuantity,
      newQuantity: 0,
      changeType: 'Adjustment',
      reason: 'Product deleted',
      timestamp: serverTimestamp(),
    })
  })
}
export async function updateStock(
  _product: Product,
  _newQuantity: number,
  _changeType: 'Restock' | 'Adjustment' | 'Damage' | 'Return',
  _reason: string,
  _unitCost?: number
) {
  requireUser()
  throw new Error(
    'Stock is managed per batch. Open Batches to receive, adjust or dispose of a specific batch.'
  )
}
export async function recordSale(
  product: Product,
  quantity: number,
  customerName: string,
  expectedUnitPrice?: number,
  saleId?: string
) {
  requireUser()
  const { sellFefo } = await import('./retail-store')
  return sellFefo(
    product,
    quantity,
    customerName,
    expectedUnitPrice ?? effectivePrice(product),
    saleId || doc(collection(db, 'sales')).id
  )
}
export function sellableStock(product: Product) {
  return product.batchManaged
    ? (product.sellableQuantity ?? 0)
    : getExpiryStatus(product.expiryDate) === 'expired'
      ? 0
      : product.stockQuantity
}
export function subscribeToHistory(
  onChange: (rows: StockHistory[], fromCache: boolean) => void,
  onError: (error: Error) => void
) {
  requireBrowser()
  return onSnapshot(
    query(collection(db, 'StockHistory'), orderBy('timestamp', 'desc'), limit(50)),
    { includeMetadataChanges: true },
    (snapshot) => {
      onChange(
        snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as StockHistory),
        snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites
      )
    },
    (error) => onError(new Error(getErrorMessage(error, 'reading StockHistory')))
  )
}
export function getExpiryStatus(
  date: Timestamp | null,
  now = new Date()
): 'expired' | 'near' | 'safe' | 'no-expiry' {
  if (!date) return 'no-expiry'
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const cutoff = new Date(today)
  cutoff.setDate(cutoff.getDate() + 14)
  cutoff.setHours(23, 59, 59, 999)
  if (date.toDate() < today) return 'expired'
  return date.toDate() <= cutoff ? 'near' : 'safe'
}
export function getErrorMessage(error: unknown, operation = 'this database request'): string {
  if (error instanceof FirebaseError) {
    if (error.code === 'permission-denied') {
      return `Firestore denied ${operation} in project ${config.projectId}. ${auth.currentUser ? 'You are signed in; the deployed Security Rules or App Check settings must allow this request.' : 'Please sign in before accessing store data.'}`
    }
    const messages: Record<string, string> = {
      'auth/invalid-credential': 'Email or password is incorrect.',
      'auth/user-not-found': 'Email or password is incorrect.',
      'auth/wrong-password': 'Email or password is incorrect.',
      'auth/email-already-in-use': 'This email is already registered. Please log in.',
      'auth/invalid-email': 'Enter a valid email address.',
      'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
      'auth/password-does-not-meet-requirements':
        'Your password does not meet the configured password requirements.',
      'auth/too-many-requests': 'Too many attempts. Please try again later.',
      'auth/network-request-failed': 'Check your internet connection and try again.',
      'auth/popup-closed-by-user': 'Google sign-in was closed. Please try again.',
      'auth/popup-blocked': 'Allow pop-ups to sign in with Google.',
      'auth/account-exists-with-different-credential':
        'Use the original sign-in method for this email.',
      'auth/operation-not-allowed':
        'This sign-in method is not enabled. Contact your administrator.',
      unavailable: 'The service is temporarily unavailable. Please try again.',
    }
    return messages[error.code] || 'The request could not be completed. Please try again.'
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export type ExpiryLevel =
  | 'safe'
  | 'approaching'
  | 'near'
  | 'warning'
  | 'critical'
  | 'expired'
  | 'no-expiry'
export const expiryLevels: {
  value: ExpiryLevel
  label: string
  range: string
  className: string
  action: string
}[] = [
  {
    value: 'safe',
    label: 'Safe',
    range: '31+ days',
    className: 'bg-emerald-50 text-emerald-700',
    action: 'Normal operations',
  },
  {
    value: 'approaching',
    label: 'Approaching',
    range: '15-30 days',
    className: 'bg-blue-50 text-blue-700',
    action: 'Monitor closely',
  },
  {
    value: 'near',
    label: 'Near expiry',
    range: '8-14 days',
    className: 'bg-yellow-50 text-yellow-800',
    action: 'Consider a promotion',
  },
  {
    value: 'warning',
    label: 'Warning',
    range: '4-7 days',
    className: 'bg-orange-50 text-orange-800',
    action: 'Take urgent action',
  },
  {
    value: 'critical',
    label: 'Critical',
    range: '0-3 days',
    className: 'bg-red-50 text-red-700',
    action: 'Act immediately',
  },
  {
    value: 'expired',
    label: 'Expired',
    range: 'Past expiry',
    className: 'bg-red-100 text-red-900',
    action: 'Remove from sale and review stock',
  },
  {
    value: 'no-expiry',
    label: 'No expiry date',
    range: 'Not tracked',
    className: 'bg-slate-100 text-slate-600',
    action: 'Expiry tracking is disabled',
  },
]
export function daysUntilExpiry(date: Timestamp | null, now = new Date()): number {
  if (!date) return Number.POSITIVE_INFINITY
  const target = date.toDate()
  return Math.round(
    (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate()) -
      Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000
  )
}
export function getExpiryLevel(date: Timestamp | null, now = new Date()): ExpiryLevel {
  if (!date) return 'no-expiry'
  const days = daysUntilExpiry(date, now)
  return days < 0
    ? 'expired'
    : days <= 3
      ? 'critical'
      : days <= 7
        ? 'warning'
        : days <= 14
          ? 'near'
          : days <= 30
            ? 'approaching'
            : 'safe'
}
export function isPromotionActive(product: Product, now = new Date()): boolean {
  return (
    product.onPromotion &&
    (product.batchManaged
      ? sellableStock(product) > 0
      : daysUntilExpiry(product.expiryDate, now) >= 0) &&
    (!product.promotionStartDate || daysUntilExpiry(product.promotionStartDate, now) <= 0) &&
    (!product.promotionEndDate || daysUntilExpiry(product.promotionEndDate, now) >= 0)
  )
}
export function effectivePrice(product: Product, now = new Date()): number {
  return isPromotionActive(product, now) ? product.promoPrice : product.sellingPrice
}
export function monthBounds(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Choose a valid month.')
  const [year, number] = month.split('-').map(Number)
  if (number < 1 || number > 12 || year < 2000 || year > 9999)
    throw new Error('Choose a valid month.')
  return {
    start: Timestamp.fromDate(new Date(year, number - 1, 1)),
    end: Timestamp.fromDate(new Date(year, number, 1)),
  }
}
export function currentMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}
export function subscribeToLedger<T extends Sale | StockHistory>(
  kind: 'sales' | 'StockHistory',
  month: string,
  onChange: (rows: T[], stale: boolean) => void,
  onError: (error: Error) => void
) {
  const { start, end } = monthBounds(month)
  return onSnapshot(
    query(
      collection(db, kind),
      where('timestamp', '>=', start),
      where('timestamp', '<', end),
      orderBy('timestamp', 'desc')
    ),
    { includeMetadataChanges: true },
    (snapshot) =>
      onChange(
        snapshot.docs.map(
          (item) =>
            ({ ...item.data(), ...(kind === 'sales' ? { saleId: item.id } : { id: item.id }) }) as T
        ),
        snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites
      ),
    onError
  )
}
export async function notificationRequest<T>(path: string, body?: unknown): Promise<T> {
  const user = requireUser()
  const response = await fetch(`/api/alerts${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const payload = await response
    .json()
    .catch(() => ({ error: 'Notification service returned an invalid response.' }))
  if (!response.ok) throw new Error(payload.error || 'Notification service is unavailable.')
  return payload as T
}
export function exportCsv(name: string, headers: string[], rows: (string | number)[][]) {
  const cell = (value: string | number) => {
    const text = String(value)
    // Prevent spreadsheet formula injection from product/customer names.
    return `"${(/^[=+@\-\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`
  }
  const content = '\uFEFF' + [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}.csv`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function printReport(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  description: string
) {
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('Allow pop-ups to print or save this report as PDF.')
  const escape = (value: string | number) =>
    String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
    )
  popup.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title><style>
@page { margin: 0; }
body { margin: 0; padding: 12mm; font-family: Arial, sans-serif; color: #0f172a; font-size: 10pt; }
h1 { margin: 0 0 8pt; font-size: 18pt; }
p { margin: 0 0 8pt; color: #475569; }
table { width: 100%; border-collapse: collapse; margin-top: 12pt; font-size: 9pt; }
th, td { border: 1px solid #cbd5e1; padding: 6pt; text-align: left; overflow-wrap: anywhere; }
th { background: #f1f5f9; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
</style></head><body><h1>${escape(title)}</h1><p>${escape(description)}</p><p>Generated: ${escape(new Date().toLocaleString('en-GB'))}</p><table border="1" cellpadding="8" cellspacing="0"><thead><tr>${headers.map((value) => `<th>${escape(value)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((value) => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`
  )
  popup.document.close()
  popup.focus()
  popup.print()
}
