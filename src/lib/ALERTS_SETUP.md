# Automatic emails and website notifications

## User-facing behavior

- Notifications is a live list of expiry and low-stock alerts from Firestore.
- The header bell shows unread alerts. Read/unread status is scoped to the signed-in account and stored in that browser.
- There are no SMS, phone verification, OS push, delivery-channel preferences, or permission prompts.
- Expiry emails go automatically to the signed-in user's account email. Users do not select a recipient or configure a channel.
- Emails include in-stock products that are expired or critical (due within 3 days). No email is sent when there are no matching products.
- A daily digest is checked after confirmed inventory loads or relevant expiry items change, on browser focus/reconnection, and every 5 minutes while the app is open, starting at 08:00 in the store's time zone. ALERT_EMAIL_HOUR can override the server default.
- Email checks use the existing Firebase ID token to read products under the deployed Security Rules. This mode does not require a Firebase service-account JSON file.
- The recipient is resolved by the server from Firebase Authentication; the browser cannot supply another recipient. Foreground email checks process only the signed-in account.
- Email verification is not required; registration does not send verification emails.

## Required email settings

Keep these private, unprefixed variables on the Node server:

| Variable           | Purpose                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| BREVO_API_KEY      | Brevo API key.                                                                                |
| BREVO_SENDER_EMAIL | Verified sender email.                                                                        |
| BREVO_SENDER_NAME  | Sender display name, currently Smart Expiry Tracking System.                                  |
| APP_URL            | App origin for product and notification links. Use the production HTTPS origin when deployed. |
| STORE_TIME_ZONE    | Optional; defaults to Asia/Colombo.                                                           |
| ALERT_EMAIL_HOUR   | Optional daily starting hour, 0-23; defaults to 8.                                            |

The existing Firebase Web API key and project ID must also be available server-side. Private secrets must never use a VITE_ prefix.

Brevo activity tags, an idempotency key, and an in-flight server lock prevent repeated daily messages. If Brevo activity cannot be checked, the server does not send blindly. An ambiguous provider timeout is held for the remainder of the day; review provider logs before retrying. Provider acceptance is not proof of delivery.

The email contains a signed Stop expiry emails link. A domain-separated signing key is derived from the private Brevo key; no separate cron secret is used. Links from emails sent before this signing change will need to be replaced with a link from a new email. It requires a confirmation POST. Opt-out blocks this configured sender for that recipient in Brevo and does not disable website notifications.

## Emails while the website is closed

An open browser cannot schedule work after it is closed. The external cron endpoint has been removed. For unattended delivery on a continuously running production Node server:

1. Configure FIREBASE_SERVICE_ACCOUNT_JSON, or GOOGLE_APPLICATION_CREDENTIALS with a server-local JSON path. The account must match the app's Firebase project and have Firestore read/write and Firebase Authentication read permission.
2. The optional scheduler reads user profiles and verifies current Firebase account status. It remains unconfigured; foreground delivery does not require it.

On that Node server, set ALERTS_RUN_SCHEDULER to true and warm up the lazy API module with GET /api/alerts/health after startup. Do not rely on an in-process timer on serverless hosting.

The server scheduler and exact month-end inventory archives still need Firebase server credentials. The website Notifications page does not call those administrative APIs and remains usable without them.

## Existing Firestore rules

Keep sign-in-only rules for products and the existing collections. No approval flag is needed. Private notificationPreferences records from the previous version remain server-only; an explicit previous email opt-out is respected by the unattended scheduler. There are no new browser collection permissions to grant.

## APIs

- POST /api/alerts/check-email: authenticated automatic email check using the request's Firebase ID token.
- GET /api/alerts/inventory-snapshot?month=YYYY-MM: authenticated archived report access.
- GET/POST /api/alerts/unsubscribe: signed confirmation flow.
- GET /api/alerts/health: health/warm-up endpoint.

SMS, phone verification, push registration, service-worker delivery, manual channel sends, preference forms, and delivery-tracking endpoints have been removed.

Account email verification messages and prompts are disabled. Signing in is sufficient for expiry email eligibility. Only expired and critical in-stock items are included; other expiry levels and low stock alone never trigger an email.
