import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Transaction,
} from 'firebase/firestore'

import { auth, db, readProduct, effectivePrice, isPromotionActive, type Product } from './firebase'
import {
  allocateFefo,
  batchTotals,
  whole,
  minor,
  safeTotal,
  alertIdentity,
  alertCondition,
  type Batch,
  type Supplier,
  type PurchaseOrder,
  type OrderLine,
  type SupplierReturn,
  type AlertResolution,
} from './retail-domain'

export const COLLECTIONS = [
  'batches',
  'suppliers',
  'purchaseOrders',
  'supplierReturns',
  'alertResolutions',
  'stockOperations',
] as const
function actor() {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in.')
  return user
}
function required(value: string, label: string, max = 200) {
  const text = value.trim()
  if (!text || text.length > max)
    throw new Error(`${label} is required (maximum ${max} characters).`)
  return text
}
const fresh = (name: string) => doc(collection(db, name))
const stamp = () => serverTimestamp()
function version(current: { version?: number }, expected?: number) {
  if (expected !== undefined && (current.version || 0) !== expected)
    throw new Error('This record changed. Close the form and reopen the latest record.')
}
function checkDate(value: Timestamp | null) {
  if (value !== null && !(value instanceof Timestamp))
    throw new Error('Select a valid date or choose No expiry date.')
}
export function readBatch(id: string, data: Record<string, unknown>): Batch {
  if (
    typeof data.productId !== 'string' ||
    typeof data.batchNumber !== 'string' ||
    !(data.receivedAt instanceof Timestamp) ||
    (data.expiryDate !== null && !(data.expiryDate instanceof Timestamp))
  )
    throw new Error(`Batch ${id} contains invalid data.`)
  whole(data.quantity as number)
  whole(data.quantityReceived as number)
  if (!Number.isSafeInteger(data.unitCostMinor) || Number(data.unitCostMinor) < 0)
    throw new Error(`Batch ${id} has an invalid purchase cost.`)
  return { ...data, id } as unknown as Batch
}
export function openingBatch(product: Product): Batch {
  return {
    id: `legacy-${product.id}`,
    productId: product.id,
    productCode: product.productId,
    productName: product.name,
    batchNumber: `LEGACY-${product.productId}`,
    supplierId: null,
    supplierName: '',
    quantityReceived: product.stockQuantity,
    quantity: product.stockQuantity,
    unitCostMinor: minor(product.purchasePrice),
    expiryDate: product.expiryDate,
    receivedAt: product.createdAt,
    updatedAt: product.createdAt,
    purchaseOrderId: null,
    notes: 'Legacy balance; original supplier and receipt details are unavailable.',
    legacy: true,
    version: 0,
    operationId: '',
  }
}
export async function ensureProductBatches(productId: string) {
  const user = actor(),
    op = fresh('stockOperations'),
    audit = fresh('StockHistory'),
    ref = doc(db, 'products', productId),
    batchRef = doc(db, 'batches', `legacy-${productId}`)
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref)
    if (!snapshot.exists()) throw new Error('This product no longer exists.')
    const product = readProduct(snapshot.id, snapshot.data())
    if (product.batchManaged) return
    if ((await tx.get(batchRef)).exists())
      throw new Error(
        'An opening batch already exists without its product migration marker. Reconcile this record before continuing.'
      )
    const batch = openingBatch(product),
      value = safeTotal(batch.quantity * batch.unitCostMinor)
    // Conversion records an opening balance, not a new receipt or purchase.
    tx.set(batchRef, {
      ...batch,
      receivedAt: stamp(),
      updatedAt: stamp(),
      operationId: op.id,
      version: 1,
      migrationOriginalCreatedAt: product.createdAt,
    })
    tx.update(ref, {
      batchManaged: true,
      ...batchTotals([batch]),
      stockVersion: 1,
      lastOperationId: op.id,
    })
    tx.set(op, {
      id: op.id,
      productId,
      productCode: product.productId,
      kind: 'migration',
      previousQuantity: product.stockQuantity,
      newQuantity: product.stockQuantity,
      previousValueMinor: value,
      newValueMinor: value,
      previousVersion: 0,
      nextVersion: 1,
      batchIds: [batch.id],
      changes: [
        {
          id: batch.id,
          before: 0,
          after: batch.quantity,
          beforeCostMinor: batch.unitCostMinor,
          afterCostMinor: batch.unitCostMinor,
        },
      ],
      referenceId: '',
      userId: user.uid,
      timestamp: stamp(),
    })
    tx.set(audit, {
      id: audit.id,
      productId: product.productId,
      productName: product.name,
      previousQuantity: product.stockQuantity,
      newQuantity: product.stockQuantity,
      changeType: 'Adjustment',
      reason:
        'Legacy stock converted to an opening batch; quantity unchanged. Original receipt details unavailable.',
      movementSource: 'migration',
      operationId: op.id,
      batchIds: [batch.id],
      timestamp: stamp(),
    })
  })
}
interface StockState {
  product: Product
  batches: Batch[]
}
async function readStock(tx: Transaction, productId: string): Promise<StockState> {
  const snapshot = await tx.get(doc(db, 'products', productId))
  if (!snapshot.exists()) throw new Error('This product no longer exists.')
  const product = readProduct(snapshot.id, snapshot.data())
  if (product.archived)
    throw new Error('This product is archived. Inventory movements are unavailable.')
  if (!product.batchManaged)
    throw new Error('Convert the existing stock into an opening batch first.')
  const ids = product.activeBatchIds || []
  if (ids.length > 40 || new Set(ids).size !== ids.length)
    throw new Error('The active batch registry needs reconciliation.')
  const snapshots = await Promise.all(ids.map((id) => tx.get(doc(db, 'batches', id))))
  const batches = snapshots.map((item) => {
    if (!item.exists())
      throw new Error('An active batch is missing. Reconcile inventory before continuing.')
    return readBatch(item.id, item.data())
  })
  if (batches.some((batch) => batch.productId !== productId || batch.quantity <= 0))
    throw new Error('The active batch registry is inconsistent.')
  const totals = batchTotals(batches)
  if (
    totals.quantity !== product.stockQuantity ||
    totals.stockValueMinor !== product.stockValueMinor
  )
    throw new Error('Product and batch totals disagree. Reconcile inventory before continuing.')
  return { product, batches }
}
function movement(
  tx: Transaction,
  state: StockState,
  after: Batch[],
  changed: { before: Batch | null; after: Batch }[],
  kind: string,
  operationId: string,
  referenceId: string,
  reason: string,
  extra: Record<string, unknown> = {}
) {
  const user = actor(),
    product = state.product
  if (!changed.length || changed.length > 4)
    throw new Error('A movement must affect between one and four batches.')
  const totals = batchTotals(after),
    nextVersion = (product.stockVersion || 0) + 1
  for (const change of changed)
    tx.set(doc(db, 'batches', change.after.id), {
      ...change.after,
      version: (change.before?.version || 0) + 1,
      operationId,
      updatedAt: stamp(),
      ...(!change.before ? { receivedAt: stamp() } : {}),
    })
  tx.update(doc(db, 'products', product.id), {
    ...totals,
    stockVersion: nextVersion,
    lastOperationId: operationId,
    purchasePrice: totals.quantity
      ? Math.round(totals.stockValueMinor / totals.quantity) / 100
      : product.purchasePrice,
  })
  tx.set(doc(db, 'stockOperations', operationId), {
    id: operationId,
    productId: product.id,
    productCode: product.productId,
    kind,
    previousQuantity: product.stockQuantity,
    newQuantity: totals.quantity,
    previousValueMinor: product.stockValueMinor || 0,
    newValueMinor: totals.stockValueMinor,
    previousVersion: product.stockVersion || 0,
    nextVersion,
    batchIds: changed.map((change) => change.after.id),
    changes: changed.map((change) => ({
      id: change.after.id,
      before: change.before?.quantity || 0,
      after: change.after.quantity,
      beforeCostMinor: change.before?.unitCostMinor ?? change.after.unitCostMinor,
      afterCostMinor: change.after.unitCostMinor,
    })),
    referenceId,
    userId: user.uid,
    timestamp: stamp(),
  })
  const audit = fresh('StockHistory'),
    deltaValue = totals.stockValueMinor - (product.stockValueMinor || 0)
  tx.set(audit, {
    id: audit.id,
    productId: product.productId,
    productName: product.name,
    previousQuantity: product.stockQuantity,
    newQuantity: totals.quantity,
    changeType:
      kind === 'sale'
        ? 'Sale'
        : ['receipt', 'purchase-order', 'customer-return'].includes(kind)
          ? 'Restock'
          : kind === 'disposal'
            ? 'Damage'
            : 'Adjustment',
    reason,
    operationId,
    batchIds: changed.map((change) => change.after.id),
    movementSource: kind,
    timestamp: stamp(),
    ...(['receipt', 'purchase-order', 'customer-return'].includes(kind)
      ? { totalCost: Math.max(0, deltaValue) / 100, unitCost: changed[0].after.unitCostMinor / 100 }
      : {}),
    ...(kind === 'disposal' ? { writeOffMinor: Math.max(0, -deltaValue) } : {}),
    ...extra,
  })
  return totals
}
export interface ReceiptInput {
  batchNumber: string
  quantity: number
  unitCost: number
  expiryDate: Timestamp | null
  supplierId: string | null
  notes: string
  source?: 'receipt' | 'customer-return'
}
function makeBatch(
  id: string,
  product: Product,
  input: ReceiptInput,
  supplier: Supplier | null,
  orderId: string | null = null
): Batch {
  whole(input.quantity, true)
  checkDate(input.expiryDate)
  return {
    id,
    productId: product.id,
    productCode: product.productId,
    productName: product.name,
    batchNumber: required(input.batchNumber, 'Batch reference', 80),
    quantityReceived: input.quantity,
    quantity: input.quantity,
    unitCostMinor: minor(input.unitCost),
    expiryDate: input.expiryDate,
    supplierId: supplier?.id || null,
    supplierName: supplier?.name || '',
    receivedAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    purchaseOrderId: orderId,
    notes: input.notes.trim().slice(0, 1000),
    legacy: false,
    version: 0,
    operationId: '',
  }
}
async function readSupplier(tx: Transaction, id: string | null, active = true) {
  if (!id) return null
  const snapshot = await tx.get(doc(db, 'suppliers', id))
  if (!snapshot.exists() || (active && !snapshot.data().active))
    throw new Error('Choose an active supplier.')
  return { ...snapshot.data(), id: snapshot.id } as Supplier
}
export async function receiveBatch(product: Product, input: ReceiptInput, requestId: string) {
  actor()
  await ensureProductBatches(product.id)
  const batchRef = doc(db, 'batches', requestId),
    operationId = `receipt-${requestId}`
  await runTransaction(db, async (tx) => {
    if ((await tx.get(batchRef)).exists()) return // stable request ID makes retries idempotent
    const state = await readStock(tx, product.id),
      supplier = await readSupplier(tx, input.supplierId)
    if (state.product.archived)
      throw new Error('This product is archived. Restore it before receiving stock.')
    const batch = makeBatch(batchRef.id, state.product, input, supplier)
    movement(
      tx,
      state,
      [...state.batches, batch],
      [{ before: null, after: batch }],
      input.source || 'receipt',
      operationId,
      '',
      input.source === 'customer-return'
        ? 'Customer-returned stock received as a separate batch; no refund recorded.'
        : 'Stock received as a new batch.'
    )
  })
}
export async function changeBatch(
  batch: Batch,
  input: {
    quantity: number
    expiryDate: Timestamp | null
    batchNumber: string
    notes: string
    reason: string
    disposal: boolean
    supplierId?: string | null
  },
  requestId: string
) {
  actor()
  whole(input.quantity)
  checkDate(input.expiryDate)
  required(input.reason, 'Reason', 500)
  await runTransaction(db, async (tx) => {
    const op = await tx.get(doc(db, 'stockOperations', requestId))
    if (op.exists()) return
    const state = await readStock(tx, batch.productId)
    const current = state.batches.find((item) => item.id === batch.id)
    if (!current) throw new Error('This batch is depleted. Receive stock in a new batch.')
    version(current, batch.version)
    if (input.disposal && input.quantity >= current.quantity)
      throw new Error('Disposal must reduce the batch quantity.')
    const supplier =
      input.supplierId !== undefined
        ? await readSupplier(tx, input.supplierId, input.supplierId !== current.supplierId)
        : null
    const changed = {
      ...current,
      quantity: input.quantity,
      expiryDate: input.expiryDate,
      batchNumber: required(input.batchNumber, 'Batch reference', 80),
      notes: input.notes.trim().slice(0, 1000),
      ...(input.supplierId !== undefined
        ? { supplierId: supplier?.id || null, supplierName: supplier?.name || '' }
        : {}),
    }
    movement(
      tx,
      state,
      state.batches.map((item) => (item.id === current.id ? changed : item)),
      [{ before: current, after: changed }],
      input.disposal ? 'disposal' : 'adjustment',
      requestId,
      '',
      input.reason.trim()
    )
  })
}
export async function sellFefo(
  product: Product,
  quantity: number,
  customerName: string,
  expectedPrice: number,
  saleId: string
) {
  const user = actor()
  whole(quantity, true)
  await ensureProductBatches(product.id)
  await runTransaction(db, async (tx) => {
    const saleRef = doc(db, 'sales', saleId)
    if ((await tx.get(saleRef)).exists()) return
    const state = await readStock(tx, product.id),
      totals = batchTotals(state.batches)
    const current = { ...state.product, sellableQuantity: totals.sellableQuantity }
    const unitPrice = effectivePrice(current)
    if (minor(unitPrice) !== minor(expectedPrice))
      throw new Error('The selling price changed. Reopen the sale form.')
    const allocations = allocateFefo(state.batches, quantity)
    const changed = allocations.map((allocation) => {
      const before = state.batches.find((item) => item.id === allocation.batchId)!
      return { before, after: { ...before, quantity: before.quantity - allocation.quantity } }
    })
    const after = state.batches.map(
      (batch) => changed.find((change) => change.after.id === batch.id)?.after || batch
    )
    const costMinor = safeTotal(
      allocations.reduce((sum, item) => sum + item.quantity * item.unitCostMinor, 0)
    )
    movement(tx, state, after, changed, 'sale', `sale-${saleId}`, saleId, `FEFO sale ${saleId}`)
    tx.set(saleRef, {
      saleId,
      productId: current.productId,
      productDocId: current.id,
      productName: current.name,
      quantity,
      unitPrice,
      totalAmount: safeTotal(minor(unitPrice) * quantity) / 100,
      customerName: customerName.trim().slice(0, 150) || 'Walk-in customer',
      timestamp: stamp(),
      userId: user.uid,
      purchaseUnitPrice: costMinor / quantity / 100,
      costMinor,
      promotionApplied: isPromotionActive(current),
      regularUnitPrice: current.sellingPrice,
      batchAllocations: allocations,
      batchIds: allocations.map((item) => item.batchId),
      operationId: `sale-${saleId}`,
    })
  })
}
export type SupplierInput = Pick<
  Supplier,
  'name' | 'contact' | 'email' | 'phone' | 'address' | 'paymentTerms' | 'notes' | 'active'
>
export async function saveSupplier(input: SupplierInput, original?: Supplier) {
  actor()
  const name = required(input.name, 'Company name', 150)
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))
    throw new Error('Enter a valid supplier email.')
  const ref = original ? doc(db, 'suppliers', original.id) : fresh('suppliers')
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref)
    if (original && !snapshot.exists()) throw new Error('Supplier no longer exists.')
    if (snapshot.exists()) version(snapshot.data(), original?.version)
    tx.set(ref, {
      name,
      contact: input.contact.trim().slice(0, 150),
      email: input.email.trim().slice(0, 200),
      phone: input.phone.trim().slice(0, 50),
      address: input.address.trim().slice(0, 500),
      paymentTerms: input.paymentTerms.trim().slice(0, 200),
      notes: input.notes.trim().slice(0, 1000),
      active: input.active,
      version: (snapshot.data()?.version || 0) + 1,
      createdAt: snapshot.data()?.createdAt || stamp(),
      updatedAt: stamp(),
    })
  })
}
export async function saveOrder(
  input: {
    supplierId: string
    lines: { productId: string; quantity: number; unitCost: number }[]
    expectedDate: Timestamp | null
    notes: string
  },
  original?: PurchaseOrder
) {
  const user = actor()
  checkDate(input.expectedDate)
  if (
    !input.lines.length ||
    input.lines.length > 4 ||
    new Set(input.lines.map((x) => x.productId)).size !== input.lines.length
  )
    throw new Error('Choose 1-4 distinct product lines.')
  const ref = original ? doc(db, 'purchaseOrders', original.id) : fresh('purchaseOrders')
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref),
      supplier = await readSupplier(tx, input.supplierId)
    if (!supplier) throw new Error('Select a supplier.')
    if (original) {
      if (!existing.exists()) throw new Error('Order no longer exists.')
      version(existing.data(), original.version)
      if (existing.data().status !== 'draft') throw new Error('Only draft orders can be edited.')
    }
    const products = await Promise.all(
      input.lines.map((line) => tx.get(doc(db, 'products', line.productId)))
    )
    const lines: OrderLine[] = input.lines.map((line, index) => {
      whole(line.quantity, true)
      const product = products[index]
      if (!product.exists()) throw new Error('An ordered product was deleted.')
      return {
        productId: product.id,
        productCode: product.data().productId,
        productName: product.data().name,
        quantity: line.quantity,
        received: 0,
        unitCostMinor: minor(line.unitCost),
      }
    })
    tx.set(ref, {
      number: existing.data()?.number || `PO-${ref.id.slice(0, 8).toUpperCase()}`,
      supplierId: supplier.id,
      supplierName: supplier.name,
      status: 'draft',
      lines,
      expectedDate: input.expectedDate,
      notes: input.notes.trim().slice(0, 1000),
      totalMinor: safeTotal(
        lines.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0)
      ),
      receivedMinor: 0,
      version: (existing.data()?.version || 0) + 1,
      createdAt: existing.data()?.createdAt || stamp(),
      updatedAt: stamp(),
      createdBy: existing.data()?.createdBy || user.uid,
    })
  })
}
export async function orderStatus(order: PurchaseOrder, status: 'ordered' | 'cancelled') {
  actor()
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'purchaseOrders', order.id),
      snapshot = await tx.get(ref)
    if (!snapshot.exists()) throw new Error('Order no longer exists.')
    const current = snapshot.data() as PurchaseOrder
    version(current, order.version)
    if (status === 'ordered' && current.status !== 'draft')
      throw new Error('Only drafts can be ordered.')
    if (status === 'cancelled' && !['draft', 'ordered', 'partial'].includes(current.status))
      throw new Error('This order cannot be cancelled.')
    tx.update(ref, { status, version: current.version + 1, updatedAt: stamp() })
  })
}
export async function receiveOrder(
  order: PurchaseOrder,
  inputs: {
    productId: string
    quantity: number
    batchNumber: string
    expiryDate: Timestamp | null
  }[],
  requestId: string
) {
  actor()
  if (
    !inputs.length ||
    inputs.length > 4 ||
    new Set(inputs.map((x) => x.productId)).size !== inputs.length
  )
    throw new Error(
      'Receive up to four distinct product lines per confirmation. Additional lines can be received separately.'
    )
  for (const line of inputs) {
    whole(line.quantity, true)
    checkDate(line.expiryDate)
    await ensureProductBatches(line.productId)
  }
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'purchaseOrders', order.id),
      receiptRef = doc(db, 'purchaseReceipts', requestId)
    if ((await tx.get(receiptRef)).exists()) return
    const snapshot = await tx.get(ref)
    if (!snapshot.exists()) throw new Error('Order no longer exists.')
    const current = snapshot.data() as PurchaseOrder
    version(current, order.version)
    if (!['ordered', 'partial'].includes(current.status))
      throw new Error('Only ordered or partially received orders can receive stock.')
    const supplier = await readSupplier(tx, current.supplierId, false)
    if (!supplier) throw new Error('Order supplier is unavailable.')
    const states: StockState[] = []
    for (const input of inputs) states.push(await readStock(tx, input.productId))
    const lines = current.lines.map((line) => ({ ...line })),
      batchIds: string[] = []
    inputs.forEach((input, index) => {
      const line = lines.find((x) => x.productId === input.productId)
      if (!line || input.quantity > line.quantity - line.received)
        throw new Error('A received quantity exceeds the outstanding order quantity.')
      const batchId = `${requestId}-${index}`,
        batch = makeBatch(
          batchId,
          states[index].product,
          {
            ...input,
            unitCost: line.unitCostMinor / 100,
            supplierId: supplier.id,
            notes: `Received against ${current.number}`,
          },
          supplier,
          order.id
        )
      batchIds.push(batchId)
      line.received += input.quantity
      movement(
        tx,
        states[index],
        [...states[index].batches, batch],
        [{ before: null, after: batch }],
        'purchase-order',
        `po-${batchId}`,
        order.id,
        `Delivery received against ${current.number}`,
        { purchaseOrderId: order.id, receiptId: requestId }
      )
    })
    const receivedMinor = safeTotal(
      lines.reduce((sum, line) => sum + line.received * line.unitCostMinor, 0)
    )
    tx.update(ref, {
      lines,
      receivedMinor,
      lastReceiptId: requestId,
      status: lines.every((line) => line.received === line.quantity) ? 'received' : 'partial',
      version: current.version + 1,
      updatedAt: stamp(),
    })
    tx.set(receiptRef, {
      id: requestId,
      purchaseOrderId: order.id,
      batchIds,
      supplierId: supplier.id,
      receivedMinor: receivedMinor - current.receivedMinor,
      createdAt: stamp(),
      userId: actor().uid,
    })
  })
}
export async function returnToSupplier(
  batch: Batch,
  quantity: number,
  reason: string,
  requestId: string
) {
  actor()
  whole(quantity, true)
  required(reason, 'Return reason', 500)
  if (!batch.supplierId)
    throw new Error(
      'This batch has no supplier. Correct its supplier information before creating a supplier return.'
    )
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'supplierReturns', requestId)
    if ((await tx.get(ref)).exists()) return
    const state = await readStock(tx, batch.productId),
      current = state.batches.find((x) => x.id === batch.id)
    if (!current) throw new Error('Batch is depleted.')
    version(current, batch.version)
    if (quantity > current.quantity) throw new Error('Return quantity exceeds the batch stock.')
    const changed = { ...current, quantity: current.quantity - quantity },
      operationId = `return-${requestId}`
    movement(
      tx,
      state,
      state.batches.map((x) => (x.id === batch.id ? changed : x)),
      [{ before: current, after: changed }],
      'supplier-return',
      operationId,
      requestId,
      reason,
      { supplierReturnId: requestId }
    )
    tx.set(ref, {
      id: requestId,
      productId: batch.productId,
      productCode: batch.productCode,
      productName: state.product.name,
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      supplierId: batch.supplierId,
      supplierName: batch.supplierName,
      quantity,
      reason: reason.trim(),
      expectedCreditMinor: safeTotal(quantity * batch.unitCostMinor),
      creditMinor: 0,
      status: 'pending',
      reference: '',
      decisionNotes: '',
      version: 1,
      createdAt: stamp(),
      settledAt: null,
      operationId,
    })
  })
}
export async function settleReturn(
  item: SupplierReturn,
  status: 'credited' | 'rejected',
  amount: number,
  reference: string,
  notes: string
) {
  actor()
  const credit = minor(amount)
  required(reference, status === 'credited' ? 'Credit-note reference' : 'Decision reference', 200)
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'supplierReturns', item.id),
      snapshot = await tx.get(ref)
    if (!snapshot.exists()) throw new Error('Return no longer exists.')
    const current = snapshot.data() as SupplierReturn
    version(current, item.version)
    if (current.status !== 'pending') throw new Error('This credit decision was already recorded.')
    tx.update(ref, {
      status,
      creditMinor: status === 'credited' ? credit : 0,
      reference: reference.trim(),
      decisionNotes: notes.trim().slice(0, 1000),
      version: current.version + 1,
      settledAt: stamp(),
      settledBy: actor().uid,
    })
  })
}
export async function recordAlertAction(
  batch: Batch,
  status: 'reviewing' | 'resolved',
  action: string,
  notes: string,
  links: { collection: string; id: string }[],
  original?: AlertResolution
) {
  const user = actor()
  required(notes, 'Review notes', 1000)
  if (!['review', 'promotion', 'supplier-return', 'disposal', 'explanation'].includes(action))
    throw new Error('Choose a valid action.')
  if (
    links.length > 4 ||
    links.some((link) => !['sales', 'StockHistory', 'supplierReturns'].includes(link.collection))
  )
    throw new Error('Choose valid linked outcome records.')
  const id = alertIdentity(batch),
    ref = doc(db, 'alertResolutions', id)
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref),
      batchSnapshot = await tx.get(doc(db, 'batches', batch.id))
    if (!batchSnapshot.exists()) throw new Error('Batch no longer exists.')
    const currentBatch = readBatch(batchSnapshot.id, batchSnapshot.data())
    if (alertIdentity(currentBatch) !== id)
      throw new Error('The expiry condition changed. Reopen the current alert.')
    if (snapshot.exists()) version(snapshot.data(), original?.version ?? 0)
    const records = await Promise.all(
      links.map((link) => tx.get(doc(db, link.collection, link.id)))
    )
    records.forEach((record) => {
      if (!record.exists()) throw new Error('A linked outcome record is missing.')
      const data = record.data()
      if (
        data.batchId !== batch.id &&
        !data.batchIds?.includes(batch.id) &&
        !data.batchAllocations?.some(
          (allocation: { batchId: string }) => allocation.batchId === batch.id
        )
      )
        throw new Error('Outcome record does not belong to this batch.')
    })
    if (['promotion', 'supplier-return', 'disposal'].includes(action)) {
      const matched = records.some((record, index) => {
        const data = record.data()!
        return action === 'promotion'
          ? links[index].collection === 'StockHistory' &&
              data.eventType === 'promotion' &&
              data.promotionEvent?.enabled === true
          : action === 'supplier-return'
            ? links[index].collection === 'supplierReturns'
            : links[index].collection === 'StockHistory' && data.movementSource === 'disposal'
      })
      if (!matched)
        throw new Error(
          'Link the recorded ' +
            action +
            ' transaction, or choose review/explanation until that action is completed.'
        )
    }
    const history = snapshot.data()?.history || []
    if (history.length >= 100)
      throw new Error(
        'This alert has reached the 100-event review limit. Existing history is preserved.'
      )
    tx.set(ref, {
      batchId: batch.id,
      productId: batch.productId,
      condition: alertCondition(batch),
      status,
      responsibleId: user.uid,
      responsibleName: user.displayName || 'Store user',
      history: [
        ...history,
        {
          id: `${id}_${(snapshot.data()?.version || 0) + 1}`,
          status,
          action,
          notes: notes.trim(),
          userId: user.uid,
          userName: user.displayName || 'Store user',
          at: Timestamp.now(),
          links,
        },
      ],
      version: (snapshot.data()?.version || 0) + 1,
      createdAt: snapshot.data()?.createdAt || stamp(),
      updatedAt: stamp(),
      resolvedAt: status === 'resolved' ? stamp() : null,
    })
  })
}
export async function getBatchesForProduct(productId: string) {
  const snapshot = await getDoc(doc(db, 'products', productId))
  if (!snapshot.exists()) return []
  const product = readProduct(snapshot.id, snapshot.data())
  if (product.archived)
    throw new Error('This product is archived. Inventory movements are unavailable.')
  if (!product.batchManaged) return [openingBatch(product)]
  const rows = await Promise.all(
    (product.activeBatchIds || []).map((id) => getDoc(doc(db, 'batches', id)))
  )
  return rows.filter((row) => row.exists()).map((row) => readBatch(row.id, row.data()))
}
