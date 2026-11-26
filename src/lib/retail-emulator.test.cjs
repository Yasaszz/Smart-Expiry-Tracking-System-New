const fs = require('fs')
const path = require('path')
const { stripTypeScriptTypes } = require('node:module')
const { pathToFileURL } = require('url')
const dir =
  process.env.SMART_EXPIRY_TEST_TOOLS ||
  path.join(process.env.TEMP || '/tmp', 'smart-expiry-retail-tests')
const req = require('node:module').createRequire(path.join(dir, 'package.json'))
const { initializeTestEnvironment, assertFails } = req('@firebase/rules-unit-testing')
// All database operations target the local emulator and demo-smart-expiry, never the live project.

;(async () => {
  const sdk = await import(pathToFileURL(req.resolve('firebase/firestore')).href)
  sdk.setLogLevel('silent')
  const env = await initializeTestEnvironment({
    projectId: 'demo-smart-expiry',
    firestore: {
      host: '127.0.0.1',
      port: 8085,
      rules: fs.readFileSync('src/lib/firestore.rules', 'utf8'),
    },
  })
  console.log('RULES COMPILED')
  await env.clearFirestore()
  const db = env.authenticatedContext('staff', { email: 'staff@example.com' }).firestore()
  function moduleURL(name, replacements = {}) {
    let s = stripTypeScriptTypes(fs.readFileSync('src/lib/' + name + '.ts', 'utf8'), {
      mode: 'transform',
    })
    for (const [a, b] of Object.entries(replacements)) s = s.split(a).join(b)
    s = s.replace(
      /from ['"](firebase\/[^'"]+)['"]/g,
      (_, n) => 'from ' + JSON.stringify(pathToFileURL(req.resolve(n)).href)
    )
    return 'data:text/javascript;base64,' + Buffer.from(s).toString('base64')
  }
  const domainURL = moduleURL('retail-domain')
  const D = await import(domainURL)
  let f = fs
    .readFileSync('src/lib/firebase.ts', 'utf8')
    .replace(/import\.meta\.env\.VITE_FIREBASE_\w+/g, "'demo-smart-expiry'")
    .replace(
      "export const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'",
      'export const isBrowser = true'
    )
    .replace('export const auth = getAuth(app)', 'export const auth = globalThis.__testAuth')
    .replace('export const db = getFirestore(app)', 'export const db = globalThis.__testDb')
  f = stripTypeScriptTypes(f, { mode: 'transform' })
    .replace("'./retail-domain'", JSON.stringify(domainURL))
    .replace(
      /from ['"](firebase\/[^'"]+)['"]/g,
      (_, n) => 'from ' + JSON.stringify(pathToFileURL(req.resolve(n)).href)
    )
  globalThis.__testAuth = { currentUser: { uid: 'staff', displayName: 'Store user' } }
  globalThis.__testDb = db
  globalThis.__firebase = await import(
    'data:text/javascript;base64,' + Buffer.from(f).toString('base64')
  )
  const storeURL = moduleURL('retail-store', {
    "import { auth, db, readProduct, effectivePrice, isPromotionActive } from './firebase';":
      'const {auth,db,readProduct,effectivePrice,isPromotionActive}=globalThis.__firebase;',
    "'./retail-domain'": JSON.stringify(domainURL),
  })
  const S = await import(storeURL)
  const { doc, setDoc, getDoc, getDocs, collection, Timestamp } = sdk
  const testDate = (offset) =>
    Timestamp.fromDate(new Date(Date.parse(D.storeDate()) + offset * 86400000 - 330 * 60000))
  const legacy = {
    productId: 'P001',
    name: 'Biscuits',
    category: 'Food',
    quantity: 5,
    stockQuantity: 5,
    purchasePrice: 1.25,
    sellingPrice: 2,
    expiryDate: testDate(35),
    onPromotion: false,
    promoPrice: 0,
    createdAt: Timestamp.now(),
  }
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'products', 'P001'), legacy))
  const p = () =>
    getDoc(doc(db, 'products', 'P001')).then((d) =>
      globalThis.__firebase.readProduct(d.id, d.data())
    )
  const b = (id) => getDoc(doc(db, 'batches', id)).then((d) => S.readBatch(d.id, d.data()))
  let tests = 0
  async function test(n, fn) {
    try {
      await fn()
      console.log('PASS', n)
      tests++
    } catch (e) {
      console.log('FAIL', n, e.code || '', String(e.message).slice(0, 1800))
      throw e
    }
  }
  const assert = require('node:assert/strict')
  try {
    await test('migration preserves balance and is repeat-safe', async () => {
      await S.ensureProductBatches('P001')
      await S.ensureProductBatches('P001')
      assert.equal((await p()).stockQuantity, 5)
      assert.equal((await getDocs(collection(db, 'batches'))).size, 1)
    })
    await test('supplier create', async () => {
      await S.saveSupplier({
        name: 'Supplier',
        contact: '',
        email: '',
        phone: '',
        address: '',
        paymentTerms: '30 days',
        notes: '',
        active: true,
      })
    })
    const sup = (await getDocs(collection(db, 'suppliers'))).docs[0].id
    await test('receipt and duplicate request', async () => {
      let input = {
        batchNumber: 'NEW',
        quantity: 4,
        unitCost: 1.5,
        expiryDate: testDate(2),
        supplierId: sup,
        notes: '',
      }
      await S.receiveBatch(await p(), input, 'receipt-one')
      await S.receiveBatch(await p(), input, 'receipt-one')
      assert.equal((await p()).stockQuantity, 9)
    })
    await test('FEFO sale across two batches and repeat-safe', async () => {
      await S.sellFefo(await p(), 6, '', 2, 'sale-one')
      await S.sellFefo(await p(), 6, '', 2, 'sale-one')
      assert.equal((await p()).stockQuantity, 3)
      const sale = (await getDoc(doc(db, 'sales', 'sale-one'))).data()
      assert.deepEqual(
        sale.batchAllocations.map((a) => a.quantity),
        [4, 2]
      )
      assert.equal(sale.costMinor, 850)
    })
    await test('concurrent sales cannot oversell', async () => {
      let result = await Promise.allSettled([
        S.sellFefo(await p(), 2, '', 2, 'race-a'),
        S.sellFefo(await p(), 2, '', 2, 'race-b'),
      ])
      assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1)
      assert.equal((await p()).stockQuantity, 1)
    })
    await test('negative quantity and forged summary rejected', async () => {
      await assertFails(sdk.updateDoc(doc(db, 'batches', 'legacy-P001'), { quantity: -1 }))
      await assertFails(
        sdk.updateDoc(doc(db, 'products', 'P001'), { quantity: 100, stockQuantity: 100 })
      )
    })

    const order = async () => {
      const rows = await getDocs(collection(db, 'purchaseOrders'))
      const d = rows.docs[0]
      return { ...d.data(), id: d.id }
    }
    await test('purchase order draft and ordering', async () => {
      await S.saveOrder({
        supplierId: sup,
        lines: [{ productId: 'P001', quantity: 10, unitCost: 1.75 }],
        expectedDate: null,
        notes: '',
      })
      await S.orderStatus(await order(), 'ordered')
    })
    await test('partial order receipt repeat-safe', async () => {
      const o = await order()
      const input = [{ productId: 'P001', quantity: 4, batchNumber: 'PO-FIRST', expiryDate: null }]
      await S.receiveOrder(o, input, 'po-first')
      await S.receiveOrder(o, input, 'po-first')
      assert.equal((await order()).status, 'partial')
      assert.equal((await order()).lines[0].received, 4)
    })
    await test('reject overreceipt and cancel remainder', async () => {
      await assert.rejects(
        S.receiveOrder(
          await order(),
          [{ productId: 'P001', quantity: 7, batchNumber: 'EXCESS', expiryDate: null }],
          'po-excess'
        )
      )
      await S.orderStatus(await order(), 'cancelled')
      assert.equal((await order()).lines[0].received, 4)
    })
    await test('supplier return deducts once, credit settlement never deducts', async () => {
      const before = (await p()).stockQuantity
      const batch = await b('po-first-0')
      await S.returnToSupplier(batch, 2, 'Damaged package', 'return-one')
      await S.returnToSupplier(batch, 2, 'Damaged package', 'return-one')
      assert.equal((await p()).stockQuantity, before - 2)
      const d = await getDoc(doc(db, 'supplierReturns', 'return-one'))
      await S.settleReturn({ ...d.data(), id: d.id }, 'credited', 3, 'CN-001', 'Agreed credit')
      assert.equal((await p()).stockQuantity, before - 2)
      assert.equal((await getDoc(d.ref)).data().creditMinor, 300)
    })
    await test('expired receipt excluded from FEFO sale', async () => {
      await S.receiveBatch(
        await p(),
        {
          batchNumber: 'EXPIRED',
          quantity: 3,
          unitCost: 0.29,
          expiryDate: testDate(-2),
          supplierId: sup,
          notes: '',
        },
        'expired-batch'
      )
      const before = (await b('expired-batch')).quantity
      await S.sellFefo(await p(), 1, '', 2, 'sale-after-expired')
      assert.equal((await b('expired-batch')).quantity, before)
    })
    await test('alert review append and resolution retain physical risk', async () => {
      const batch = await b('expired-batch')
      await S.recordAlertAction(batch, 'reviewing', 'review', 'Check supplier agreement', [])
      const id = D.alertIdentity(batch),
        d = await getDoc(doc(db, 'alertResolutions', id))
      await S.recordAlertAction(
        batch,
        'resolved',
        'explanation',
        'Review complete; stock remains isolated',
        [],
        { ...d.data(), id }
      )
      assert.equal((await getDoc(d.ref)).data().history.length, 2)
      assert.equal(D.alertCondition(await b('expired-batch')), 'expired')
    })
    await test('expired stock can be returned to its recorded supplier', async () => {
      const batch = await b('expired-batch'),
        before = (await p()).stockQuantity
      await S.returnToSupplier(batch, 1, 'Expired supplier return', 'expired-return')
      assert.equal((await p()).stockQuantity, before - 1)
      assert.equal(
        (await getDoc(doc(db, 'supplierReturns', 'expired-return'))).data().expectedCreditMinor,
        29
      )
    })
    await test('disposal records actual cost and zero quantity', async () => {
      const batch = await b('expired-batch')
      await S.changeBatch(
        batch,
        {
          quantity: 0,
          expiryDate: batch.expiryDate,
          batchNumber: batch.batchNumber,
          notes: '',
          reason: 'Expired stock disposal',
          disposal: true,
        },
        'dispose-one'
      )
      assert.equal((await b('expired-batch')).quantity, 0)
      const rows = (await getDocs(collection(db, 'StockHistory'))).docs.map((d) => d.data())
      assert.equal(rows.find((r) => r.operationId === 'dispose-one').writeOffMinor, 58)
    })

    await test('four batch FEFO boundary', async () => {
      for (let i = 0; i < 8; i++)
        await S.receiveBatch(
          await p(),
          {
            batchNumber: 'MANY-' + i,
            quantity: 1,
            unitCost: 1,
            expiryDate: testDate(3),
            supplierId: null,
            notes: '',
          },
          'many-' + i
        )
      await S.sellFefo(await p(), 4, '', 2, 'eight-batch-sale')
    })
    await test('four-line purchase order boundary', async () => {
      const ids = []
      await env.withSecurityRulesDisabled(async (c) => {
        for (let i = 0; i < 4; i++) {
          const id = 'LINE-' + i
          ids.push(id)
          await setDoc(doc(c.firestore(), 'products', id), {
            ...legacy,
            productId: id,
            stockQuantity: 0,
            quantity: 0,
            expiryDate: null,
          })
        }
      })
      await S.saveOrder({
        supplierId: sup,
        lines: ids.map((productId) => ({ productId, quantity: 2, unitCost: 1 })),
        expectedDate: null,
        notes: 'Boundary test',
      })
    })

    await test('four-line order receiving boundary', async () => {
      const list = (await getDocs(collection(db, 'purchaseOrders'))).docs
      let o = list.map((d) => ({ ...d.data(), id: d.id })).find((o) => o.status === 'draft')
      await S.orderStatus(o, 'ordered')
      const snap = await getDoc(doc(db, 'purchaseOrders', o.id))
      o = { ...snap.data(), id: snap.id }
      await S.receiveOrder(
        o,
        o.lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          batchNumber: l.productCode + '-RECEIPT',
          expiryDate: null,
        })),
        'multi-receipt'
      )
      assert.equal((await getDoc(snap.ref)).data().status, 'received')
    })

    await test('anonymous reads and ledger mutations denied', async () => {
      await assertFails(getDocs(collection(env.unauthenticatedContext().firestore(), 'products')))
      await assertFails(sdk.updateDoc(doc(db, 'sales', 'sale-one'), { quantity: 1 }))
      await assertFails(
        setDoc(doc(db, 'users', 'staff'), {
          uid: 'staff',
          name: 'Staff',
          email: 'staff@example.com',
          role: 'admin',
          createdAt: sdk.serverTimestamp(),
        })
      )
    })
    await test('new product creates opening batch atomically', async () => {
      await globalThis.__firebase.saveProduct({
        name: 'Soap',
        category: 'Household',
        stockQuantity: 3,
        purchasePrice: 0.29,
        sellingPrice: 0.99,
        expiryDate: null,
        onPromotion: false,
        promoPrice: 0,
      })
      const rows = (await getDocs(collection(db, 'products'))).docs
      const row = rows.find((d) => d.data().name === 'Soap')
      assert(row)
      assert.equal(row.data().stockValueMinor, 87)
      assert.equal((await getDoc(doc(db, 'batches', 'opening-' + row.id))).data().quantity, 3)
    })
    await test('forecast distinguishes zero demand from unavailable and consumes earlier stock', () => {
      const now = new Date('2026-11-15T12:00:00+05:30')
      const base = {
        id: 'a',
        quantity: 10,
        expiryDate: Timestamp.fromDate(new Date('2026-11-16T00:00:00+05:30')),
        unitCostMinor: 100,
        receivedAt: Timestamp.fromMillis(1),
      }
      const later = {
        ...base,
        id: 'b',
        expiryDate: Timestamp.fromDate(new Date('2026-11-17T00:00:00+05:30')),
      }
      const demand = { rate: 5, units: 70, days: 14, observations: 6, warning: 'Baseline' }
      assert.equal(D.predictUnsold([base, later], demand, now)[1].predictedUnsold, 5)
      assert.equal(D.predictUnsold([base], null, now)[0].predictedUnsold, null)
      assert.equal(D.demandRate([], 14, true, now).rate, 0)
      assert.equal(D.demandRate([], 14, false, now), null)
      assert.equal(D.predictUnsold([{ ...base, expiryDate: null }], demand, now).length, 0)
    })
    await test('discount simulator is pure, respects FEFO and actual batch costs', () => {
      const now = new Date('2026-11-15T12:00:00+05:30')
      const batches = [
        {
          id: 'dated',
          quantity: 4,
          expiryDate: Timestamp.fromDate(new Date('2026-11-16T00:00:00+05:30')),
          unitCostMinor: 150,
          receivedAt: Timestamp.fromMillis(1),
        },
        {
          id: 'undated',
          quantity: 10,
          expiryDate: null,
          unitCostMinor: 100,
          receivedAt: Timestamp.fromMillis(1),
        },
      ]
      const before = JSON.stringify(batches)
      const result = D.simulateDiscount(batches, 200, 3, 10, 0, 3, now)
      assert.equal(result.sold, 9)
      assert.equal(result.cost, 1100)
      assert.equal(result.revenue, 1620)
      assert.equal(result.profit, 520)
      assert.equal(JSON.stringify(batches), before)
      const selected = D.simulateDiscount(batches, 200, 3, 10, 0, 3, now, 'undated')
      assert.equal(selected.sold, 5)
      assert.equal(selected.cost, 500)
      assert.throws(() => D.simulateDiscount(batches, 200, 3, 10, 0, 0, now))
      assert.equal(D.simulateDiscount(batches, 200, 3, 60, 0, 3, now).belowCost, true)
    })
    await test('FEFO ties, expired exclusion and undated ordering', () => {
      const now = new Date('2026-11-15T12:00:00+05:30')
      const b = {
        id: 'b',
        batchNumber: 'B',
        quantity: 2,
        unitCostMinor: 100,
        expiryDate: Timestamp.fromDate(new Date('2026-11-15T00:00:00+05:30')),
        receivedAt: Timestamp.fromMillis(1),
      }
      const a = { ...b, id: 'a', batchNumber: 'A' }
      const expired = {
        ...b,
        id: 'expired',
        expiryDate: Timestamp.fromDate(new Date('2026-11-14T00:00:00+05:30')),
      }
      const undated = { ...b, id: 'undated', expiryDate: null }
      assert.deepEqual(
        D.allocateFefo([undated, b, expired, a], 5, now).map((r) => r.batchId),
        ['a', 'b', 'undated']
      )
      assert.throws(() => D.allocateFefo([expired], 1, now))
    })
    await test('zero-stock dated migration preserves original batch expiry', async () => {
      await env.withSecurityRulesDisabled((c) =>
        setDoc(doc(c.firestore(), 'products', 'ZERO-DATED'), {
          ...legacy,
          productId: 'ZERO-DATED',
          quantity: 0,
          stockQuantity: 0,
        })
      )
      await S.ensureProductBatches('ZERO-DATED')
      assert.equal((await getDoc(doc(db, 'products', 'ZERO-DATED'))).data().expiryDate, null)
      assert.equal(
        (await b('legacy-ZERO-DATED')).expiryDate.toMillis(),
        legacy.expiryDate.toMillis()
      )
    })
    await test('expiry emails use batch quantities and exclude safe, undated and depleted stock', async () => {
      const E = await import(
        moduleURL('alerts-server', {
          "'./alerts'": JSON.stringify(moduleURL('alerts')),
          "'./expiry-email'": JSON.stringify(moduleURL('expiry-email')),
          'function expiryEmailRows(': 'export function expiryEmailRows(',
        })
      )
      const product = {
        id: 'email-product',
        productId: 'P999',
        name: '<Soap & biscuits>',
        stockQuantity: 99,
        batchManaged: true,
      }
      const batch = (id, quantity, days) => ({
        id,
        productId: product.id,
        batchNumber: id,
        quantity,
        expiryDate: days === null ? null : testDate(days).toDate().toISOString(),
      })
      const alerts = E.expiryEmailRows(
        E.emailStockRows(
          [product],
          [
            batch('expired', 2, -1),
            batch('critical', 3, 2),
            batch('safe', 8, 40),
            batch('undated', 7, null),
            batch('depleted', 0, -2),
          ]
        )
      )
      assert.equal(alerts.length, 2)
      assert.deepEqual(
        alerts.map((row) => row.quantity),
        [2, 3]
      )
      assert.deepEqual(
        alerts.map((row) => row.level),
        ['expired', 'critical']
      )
      assert.equal(
        E.emailStockRows([{ ...product, archived: true }], [batch('hidden', 2, -1)]).length,
        0
      )
      const email = await import(moduleURL('expiry-email'))
      const content = email.renderExpiryEmail({
        name: 'Smart Expiry Tracking System',
        origin: 'https://example.test',
        unsubscribeUrl: 'https://example.test/unsubscribe',
        generatedAt: 'Local test',
        items: alerts,
      })
      assert(content.htmlContent.includes('&lt;Soap &amp; biscuits&gt;'))
      assert(!content.htmlContent.includes('<Soap'))
      assert(content.htmlContent.includes('Expired stock batches'))
    })
    console.log('TOTAL', tests)
  } finally {
    await env.cleanup()
  }
})().catch((e) => {
  console.error(e.code || '', String(e.message).slice(0, 2200))
  process.exitCode = 1
})
