# Retail inventory upgrade

## Activate the database rules

The application uses the Firebase Web SDK and signed-in staff access. No account approval is required.

1. Open Firebase Console and select **sesfp-a24a6**.
2. Open **Firestore Database > Rules** for the **(default)** database.
3. Replace the entire editor with **src/lib/firestore.rules** and click **Publish**.
4. Reload the app, or press **Reconnect** on the affected page.

The rules file has been compiled and exercised in the local Firestore emulator. It has **not been deployed to the live project**. The existing deployed rules deny the new collections. Until publication, batch conversion, batch receipts and sales, suppliers, purchase orders, supplier returns, alert review records and their outcome summaries remain blocked. The app distinguishes denied access from an empty collection and does not grant public access as a workaround.

## Features and routes

- `/batches`: receipts, separate lot costs and optional expiry, supplier references, quantity/date corrections, disposal and legacy conversion.
- `/stock`: live FEFO allocation preview and atomic sales; expired units are excluded even when valid stock exists for the same product.
- `/suppliers`: contacts, search, editing and archive status. No automatic supplier communication.
- `/purchase-orders`: draft and ordered states, partial deliveries, completion and cancellation of the remaining order. Ordering never increases stock.
- `/supplier-returns`: batch-specific physical stock returns, expected credit, pending/credited/rejected decisions and actual credit references. Settlement never changes stock again.
- `/insights`: 7/14/30-day sales baselines, explainable unsold-stock estimates, pure discount scenarios, alert reviews/history, linked outcomes and CSV exports.
- Dashboard, inventory/expiry CSV and print reports, notifications, promotion eligibility, expiry emails and read-only chatbot context now understand batches. Product stock values use exact batch costs; the catalogue purchase price is a rounded weighted average.

## Schema

All document references use product document IDs. `productCode` retains the human-readable P001-style ID.

| Collection         | Purpose                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `products`         | Catalogue plus `batchManaged`, `activeBatchIds`, `stockVersion`, `stockValueMinor`, `sellableQuantity`, `lastOperationId` and archive status                     |
| `batches`          | Product/supplier snapshots, remaining/received quantities, integer `unitCostMinor`, optional expiry, receipt and order references, revision and audit timestamps |
| `suppliers`        | Contact details, payment terms, notes, active/archive status and revision                                                                                        |
| `purchaseOrders`   | Agreed costs and quantities, received quantities, status, total/received minor amounts, revision and last receipt reference                                      |
| `purchaseReceipts` | Immutable delivery ID, order, batch IDs, received value, staff and timestamp                                                                                     |
| `supplierReturns`  | Immutable stock-return details plus a single credit decision and actual credit                                                                                   |
| `stockOperations`  | Immutable per-product quantity/value balance and batch before/after changes                                                                                      |
| `sales`            | Existing fields plus batch allocations, actual `costMinor`, product document and operation references                                                            |
| `StockHistory`     | Existing audit records plus batch/operation references, movement source, receipt costs and disposal write-off minor amounts                                      |
| `alertResolutions` | Stable batch/date/condition identity, responsible user, append-only action history, linked transactions and resolution timestamps                                |

Shared interfaces and deterministic date, FEFO, money, forecast and simulation functions are in `retail-domain.ts`. Transaction workflows are in `retail-store.ts`. Rules validate authenticated access, revisions, immutable ledgers, balanced product/batch changes, order receipts and expired-sale exclusion.

## Existing stock

Existing records are not replaced or automatically reset. Unconverted balances appear as labelled virtual legacy batches. Use **Convert existing balances** on Batches, or let the first stock operation convert that product. The conversion creates `legacy-{productDocumentId}` and a neutral migration audit entry in one transaction. Repeating it leaves stock unchanged. Original supplier/delivery details remain explicitly unknown. Migration and opening inventory are excluded from purchase totals.

Once converted, quantity, cost and expiry are controlled through Batches; the catalogue editor cannot overwrite them. Existing sales and history remain untouched. Legacy sales without batch references are included in product demand rates but are not fabricated into batch-specific outcomes.

## Operational limits and accounting

- Up to **40 active batches per product**. Depleted batches remain as historical records.
- Up to **4 batches per atomic sale**. Larger allocations fail with an explicit instruction to record a smaller sale, rather than silently dropping stock.
- Up to **4 distinct product lines per purchase order**, and 4 per delivery confirmation. Further deliveries can complete a partial order. These bounded writes were tested against Firestore rule access/expression budgets.
- Quantities are non-negative integers, at most 1,000,000 per product; monetary calculations use safe integer minor units.
- Stock mutations read the current active-batch registry inside a transaction. Concurrent receipt/sale changes retry, and stale edit forms reject conflicts. Stable request IDs prevent retry duplication.
- Supplier returns remove physical stock immediately. Pending credits are estimates; only credited records count as actual credit. Rejection does not restore stock.
- Alert acknowledgement in the browser does not resolve a review. A resolved review does not remove stock risk. A changed expiry date/condition has a distinct alert identity. Review time starts at the first recorded review, not an invented earlier detection time. Each alert retains up to 100 append-only review events.
- A completed promotion/return/disposal action requires a corresponding linked record. Notes alone can record a review or resolution explanation.
- Forecasts use recorded sales over store-local calendar days including today, limited by the product creation date. Zero observed sales differs from unavailable data. Stockouts and sparse history can bias the baseline.
- Discount uplift is explicitly assumed, never claimed to be learned. Simulations do not write to Firestore. Promotions still require review and explicit save; a batch selection does not make the resulting product-wide promotion batch-specific.
- Snapshot listeners paginate visible tables but currently read complete operational collections so totals are not calculated from silently truncated pages. Large stores should add an indexed aggregation/backend design before exceeding this scale.

## Delivery and assistant

Emails contain only stocked expired and critical (0?3 days) batch rows. Undated batches, safe stock, warning/near/approaching and low-stock-only alerts do not trigger an expiry email. Existing daily deduplication and unsubscribe handling remain. No verification email, SMS, OS push or approvals were added. Existing email checks while the app is open remain; closed-app scheduled delivery still requires configured server credentials/scheduler.

The chatbot receives a bounded read-only batch context with explicit availability/truncation flags, and current feature instructions. Supplier contact details are not sent to the model. DeepSeek generates assistant replies.

## Validation

`npm run type-check`, `npx oxlint src/app src/lib`, and `npm run build` cover type safety, lint and Bini client/API/prerender output.

`src/lib/retail-emulator.test.cjs` tests the actual transaction helpers and deployable rules using a local **demo-smart-expiry** Firestore emulator on **127.0.0.1:8085**. It never points to the live project. Test dependencies can be installed outside the repository to preserve project configuration:

```powershell
$testTools = Join-Path $env:TEMP 'smart-expiry-retail-tests'
npm install --prefix $testTools @firebase/rules-unit-testing firebase
$env:SMART_EXPIRY_TEST_TOOLS = $testTools
node src/lib/retail-emulator.test.cjs
```

Start a Firestore emulator for demo-smart-expiry at port 8085 before running the test. The test loads the rules itself and clears only that demo emulator namespace. Use Node 22.18+ and the Java version required by your Firebase CLI. No project configuration files need editing.

The suite verifies migration preservation/idempotency, supplier creation, receipt retries, multi-batch FEFO, concurrent oversell prevention, forged/negative writes, PO states and partial receipts, overreceipt rejection/cancellation, supplier returns and settlement, expired exclusion, append-only reviews, disposal cost, four-batch/four-line boundaries, anonymous/ledger denial, new opening stock, forecast edge cases and pure simulation arithmetic.

Browser checks use an isolated headless Chrome session with local emulator data and intercepted authentication/delivery endpoints. No real supplier contacts, test accounts, business sales or test emails are created in the live project.

Validation completed in this workspace: 24 emulator/rules/domain/email checks passed; five new routes were checked at desktop and 390px mobile widths with no runtime errors or horizontal overflow. Supplier creation, opening inventory without expiry, a dated receipt, FEFO preview and sale, simulation and denied-access behavior were exercised through Chrome against local emulator data. Five route headings and navigation were confirmed with JavaScript disabled in the production build. No real email was sent.
