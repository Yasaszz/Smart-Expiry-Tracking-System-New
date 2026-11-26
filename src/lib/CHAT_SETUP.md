# Store assistant

The floating Store assistant is available on every signed-in page. It calls the authenticated `POST /api/chat` endpoint.

## Server settings

Set `DEEPSEEK_API_KEY` in the ignored local `.env` or the server environment and restart the server. The default model is `deepseek-flash`. Override it with `DEEPSEEK_MODEL` if needed. The Node API sends chat requests to DeepSeek using native fetch. Keep the key in the server environment.

DeepSeek returns HTTP 402 when the account has insufficient balance. Greetings and simple local scope refusals work without a provider call.

## Data and scope

- Firebase verifies the request's sign-in token. Firestore reads use that same token and the configured project, preserving deployed Security Rules; a Firebase service account is unnecessary.
- Every accepted data question obtains a new inventory/transaction snapshot. Product totals use all returned inventory records. At most 200 relevant product records are included in the model context; coverage is explicit.
- Sales and stock history cover the selected month, bounded to the most recent 200 records each. Truncation is explicit and full sales totals are omitted when truncated or unavailable. Transaction access failures are represented as unavailable, not zero.
- Customer names, user identifiers, account emails, profile records, image URLs and API credentials are excluded from the model context. Product names and transaction reasons remain store data. Relevant question/history and store context are processed by the DeepSeek API.
- A conservative local scope check and separate model classification precede the data-answer step. The system instruction restricts answers to Smart Expiry and treats database text/history as untrusted data. Language-model scope compliance cannot be an absolute guarantee; users should verify consequential inventory facts in the normal pages.
- History cannot supply system-role messages. Answers render as plain text, never HTML. There are no model tools that execute mutations, shell commands or network actions.
- The endpoint requires sign-in, limits request size, checks origin and applies a per-user in-process limit of eight requests/minute with one active request per user. Multiple server instances would need a shared rate-limit store.
- Conversations remain available when navigating or closing the panel and clear on refresh or account change. Logs do not include prompt contents, credentials or model response bodies.

Products with expiryDate=null are represented as no-expiry with null remaining days. They remain in inventory totals and are excluded from expiry risk calculations.
