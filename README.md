# Smart Expiry Tracking System

[![Bini.js](https://img.shields.io/badge/Bini.js-Web-00A8CC?style=flat-square)](#build-and-run)
[![Node.js 22.12+](https://img.shields.io/badge/Node.js-22.12%2B-339933?style=flat-square&logo=node.js&logoColor=white)](#local-setup)
[![React 19](https://img.shields.io/badge/React-19-087EA4?style=flat-square&logo=react&logoColor=white)](#project-structure)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](#project-structure)
[![Firebase](https://img.shields.io/badge/Firebase-Auth%20%26%20Firestore-DD2C00?style=flat-square&logo=firebase&logoColor=white)](#local-setup)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-Store%20assistant-4D6BFE?style=flat-square)](#optional-integrations)

Smart Expiry is a web application for pharmacy and retail staff to manage inventory, batch expiry, sales, and supplier activity. The app uses Bini.js, React, TypeScript, Vite, Tailwind CSS, and Hono, with Firebase Authentication and Cloud Firestore.

## Features

| Area | What staff can do |
| --- | --- |
| Overview and Products | Track stock levels, stock value, and expiry risks. Search the product catalogue and set low-stock thresholds. |
| Batches and Stock & sales | Record receipts, adjustments, disposals, customer returns, and sales. Sales use first-expiry, first-out (FEFO) allocation and exclude expired stock. |
| Suppliers and purchasing | Manage suppliers, receive purchase orders in partial deliveries, and track stock returns and supplier credits. |
| Inventory insights | Review expiry alerts, estimate unsold stock from recorded sales, and simulate discounts. |
| Promotions and Reports | Schedule discounts, review inventory and monthly transactions, and export reports to CSV or print to PDF. |
| Notifications | Review expiry and low-stock alerts. Optional daily emails cover in-stock items that are expired or due within three days. |
| Store assistant | Ask inventory and app questions from a floating, read-only chat on every signed-in page. Conversations persist across navigation, and transaction questions use the current month in Asia/Colombo. |

Batches can have an optional expiry date. Undated stock counts toward inventory and is excluded from expiry alerts. Existing balances can be converted on the Batches page. See the [retail workflows and data model](src/lib/RETAIL_UPGRADE.md).

## Local setup

Use Node.js 22.12 or newer and npm.

1. Register a Web app in Firebase. Enable Cloud Firestore and the Email/Password and Google sign-in providers in Firebase Authentication. Add your app host to Firebase's authorized domains for Google sign-in if needed.
2. Apply the [Firestore rules](src/lib/firestore.rules) to the target database. These rules give signed-in users access to shared store records and enforce transaction constraints. Review them before publishing to an existing project.
3. Create a local `.env` file with the Firebase Web app settings.

   ```dotenv
   VITE_FIREBASE_API_KEY=
   VITE_FIREBASE_AUTH_DOMAIN=
   VITE_FIREBASE_PROJECT_ID=
   VITE_FIREBASE_STORAGE_BUCKET=
   VITE_FIREBASE_APP_ID=
   ```

4. Install dependencies and start the development server.

   ```bash
   npm ci
   npm run dev
   ```

5. Open [localhost:3000](http://localhost:3000) and sign in.

## Optional integrations

Keep server credentials in the ignored local `.env` file or the production server environment. Variables with the `VITE_` prefix are exposed to the browser.

| Integration | Server configuration |
| --- | --- |
| DeepSeek assistant | Set `DEEPSEEK_API_KEY`. The default model is `deepseek-flash`. Override it with `DEEPSEEK_MODEL` if needed. HTTP 402 indicates insufficient balance for live replies. |
| Brevo expiry email | Set `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` for a verified sender, and `APP_URL` for email links. `BREVO_SENDER_NAME` is optional. Daily checks start at 08:00 Asia/Colombo by default while the app is open. |
| Unattended email and archived reports | Configure Firebase server credentials for the same project. Unattended delivery also requires the scheduler on a continuously running production Node server. |

The assistant authenticates requests with Firebase and reads Firestore under the signed-in user's Security Rules. Relevant questions and a limited set of store records are sent to DeepSeek. See the [assistant setup](src/lib/CHAT_SETUP.md) and [email and scheduler setup](src/lib/ALERTS_SETUP.md).

## Build and run

```bash
npm run build
npm run start
```

Provide Firebase Web configuration at build time and server credentials at runtime. The Bini Node server serves the production build and the APIs that power chat and email.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the development server with hot reload. |
| `npm run build` | Type-check and build the client, server API, and prerendered pages. |
| `npm run start` | Serve the production build with Bini Server. |
| `npm run type-check` | Run TypeScript checks. |
| `npm run lint` | Run Oxlint. |
| `npm run format` | Format source files with Oxfmt. |

## Project structure

| Path | Contents |
| --- | --- |
| `src/app/` | Pages, shared layout, and Hono API routes. |
| `src/lib/` | Firebase integration, inventory transactions, assistant and alert logic, and shared UI. |
| `src/lib/firestore.rules` | Firestore access rules and transaction constraints. |

The [retail upgrade guide](src/lib/RETAIL_UPGRADE.md#validation) includes instructions for running the local Firestore emulator tests.
