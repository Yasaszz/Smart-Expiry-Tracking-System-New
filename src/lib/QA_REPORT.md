# Browser and live-service test report

Date: 15 November 2026. Target: http://localhost:3000, Firebase project sesfp-a24a6.

Tests used an isolated headless Chrome session and clearly labeled temporary records in the live database. Existing application data was not changed. Browser screenshots and test scripts are in `C:\Users\Yasas\AppData\Local\Temp\smart-expiry-browser-tests`. No application source changes were needed during this test run.

## Passed

- Register page renders, including Continue with Google; mismatched passwords rejected.
- Real email/password registration creates Firebase Auth account and Firestore profile.
- Dashboard renders live database data; no inventory context runtime error.
- Product creation, editing, ID search, category suggestions, and deletion.
- Product modal excludes barcode and promotion controls.
- Active 10% promotion changes unit sale price from LKR150 to LKR135.
- Restock rejects a reduction; valid restocks update live inventory and audit history.
- Two-unit sale reduces stock and records LKR270 revenue with promotion flag.
- Stock adjustment to four units triggers low-stock state.
- Expired product has a disabled sale action.
- Website notifications reflect inventory; mark-all-read persists and updates notification bell.
- Inventory CSV contains live product data.
- Sales, purchases, promotion performance, and expiry reports render.
- Independent authenticated Firestore REST reads confirm stock=4, sold quantity=2, sale unit price=135, total=270, promotionApplied=true.
- Mobile navigation at 390px works without page-level horizontal overflow; product table scrolls within its container.
- Logout, protected-route redirection, wrong-password error, and successful password login.
- Unauthenticated email API returns 401; supplied recipient override does not change the account recipient.
- Actual automatic daily expiry email submitted through authenticated application flow; subsequent checks return already-sent.
- Brevo reports delivered for both explicit test email and automatic expiry digest. Delivered indicates provider delivery status, not proof of inbox placement or reading.
- No page runtime errors across completed browser journeys.
- TypeScript and repository lint checks pass.

## Remaining validation and setup

- Interactive Google OAuth was not completed: a real Google account interaction remains necessary. Button presence alone does not prove OAuth completion.
- Archived month-end inventory returns a missing Firebase server credential error.
- Delivery while the website is closed requires deployed scheduler and Firebase server credentials; this was not tested or configured.
- Real external-provider failure paths and browser-specific coverage were not exhaustively tested.

## Cleanup

Both QA products and the temporary Firebase Authentication account were removed successfully.

Deployed Security Rules reject deletion of these QA records:

- Profile: `users/GSPRkbKtU5QNxN4SObfHXxYyUQr1` (name `QA Test 1794737976294`).
- One document in `sales`, product ID `P001`, customer `QA Browser Customer`, total LKR270.
- Nine documents in `StockHistory`, product IDs `P001` and its following generated ID, with product names beginning `QA Browser Test 1794737976294`.

These entries remain visible in reports. A Firebase Console administrator can remove only these specifically labeled QA records. The product counter was retained to preserve unique numbering. Security Rules were not weakened. Temporary saved credentials and browser tokens were removed from the test folder after account deletion.
