// Server-only module: imported exclusively by src/app/api/alerts.ts.

import { createHash, createHmac, createSign, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { defaultAlertPreferences, type AlertPreferences } from './alerts'
import { renderExpiryEmail } from './expiry-email'

type Data = Record<string, unknown>

type RestValue = {
  stringValue?: string

  integerValue?: string

  doubleValue?: number

  booleanValue?: boolean

  timestampValue?: string

  nullValue?: null

  arrayValue?: { values?: RestValue[] }

  mapValue?: { fields?: Record<string, RestValue> }
}

export class ServiceError extends Error {
  constructor(
    message: string,

    public status = 400
  ) {
    super(message)
  }
}

export type Identity = { uid: string; email: string; emailVerified: boolean }

let cachedToken: { value: string; expires: number } | null = null

const env = (name: string) => process.env[name] || process.env[`BINI_${name}`] || ''

function needed(name: string) {
  const value = env(name)

  if (!value) throw new ServiceError(`Server setup is missing ${name}.`, 503)

  return value
}

function encode(value: unknown): RestValue {
  if (value === null || value === undefined) return { nullValue: null }

  if (typeof value === 'string') return { stringValue: value }

  if (typeof value === 'boolean') return { booleanValue: value }

  if (typeof value === 'number')
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }

  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }

  return { mapValue: { fields: fields(value as Data) } }
}

function fields(data: Data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encode(value)]))
}

function decode(value: RestValue): unknown {
  if ('stringValue' in value) return value.stringValue

  if ('timestampValue' in value) return value.timestampValue

  if ('integerValue' in value) return Number(value.integerValue)

  if ('doubleValue' in value) return value.doubleValue

  if ('booleanValue' in value) return value.booleanValue

  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decode)

  if ('mapValue' in value) return unpack(value.mapValue?.fields || {})

  return null
}

function unpack(value: Record<string, RestValue>): Data {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
}

async function credentials(): Promise<{
  project_id: string

  client_email: string

  private_key: string
}> {
  const raw =
    env('FIREBASE_SERVICE_ACCOUNT_JSON') ||
    (env('GOOGLE_APPLICATION_CREDENTIALS')
      ? await readFile(env('GOOGLE_APPLICATION_CREDENTIALS'), 'utf8')
      : '')

  if (!raw)
    throw new ServiceError(
      'Server setup is missing FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.',

      503
    )

  let data

  try {
    data = JSON.parse(raw)
  } catch {
    throw new ServiceError('Firebase service credentials are invalid.', 503)
  }

  if (!data.project_id || !data.client_email || !data.private_key)
    throw new ServiceError('Firebase service credentials are incomplete.', 503)

  const configured = env('FIREBASE_PROJECT_ID') || env('VITE_FIREBASE_PROJECT_ID')

  if (configured && data.project_id !== configured)
    throw new ServiceError('Server credentials and frontend Firebase project do not match.', 503)

  return data
}

async function accessToken() {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value

  const account = await credentials()

  const now = Math.floor(Date.now() / 1000)

  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`

  const signer = createSign('RSA-SHA256')

  signer.update(unsigned)

  signer.end()

  const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',

    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },

    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',

      assertion,
    }),

    signal: AbortSignal.timeout(15000),
  })

  const data = await response.json()

  if (!response.ok || !data.access_token)
    throw new ServiceError('Unable to authenticate the Firebase service account.', 503)

  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 }

  return cachedToken.value
}

async function base() {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent((await credentials()).project_id)}/databases/(default)/documents`
}

async function rest(path: string, options: RequestInit = {}) {
  return fetch(`${await base()}${path}`, {
    ...options,

    headers: {
      Authorization: `Bearer ${await accessToken()}`,

      'Content-Type': 'application/json',

      ...options.headers,
    },

    signal: AbortSignal.timeout(15000),
  })
}

export async function getDocument(
  path: string
): Promise<{ data: Data; updateTime: string } | null> {
  const response = await rest(`/${path}`)

  if (response.status === 404) return null

  if (!response.ok)
    throw new ServiceError('Unable to read notification records from Firestore.', 503)

  const body = await response.json()

  return { data: unpack(body.fields || {}), updateTime: body.updateTime }
}

export async function putDocument(
  path: string,

  data: Data,

  condition?: { exists?: boolean; updateTime?: string }
) {
  const params = new URLSearchParams()

  if (condition?.exists !== undefined)
    params.set('currentDocument.exists', String(condition.exists))

  if (condition?.updateTime) params.set('currentDocument.updateTime', condition.updateTime)

  const response = await rest(`/${path}?${params}`, {
    method: 'PATCH',

    body: JSON.stringify({ fields: fields(data) }),
  })

  if (response.status === 409 || response.status === 412 || (response.status === 400 && condition))
    throw new ServiceError(
      'This request was already handled or changed. Refresh and try again.',

      409
    )

  if (!response.ok) throw new ServiceError('Unable to save notification records to Firestore.', 503)
}

async function list(collectionId: string, filter?: { field: string; value: string }) {
  const response = await rest(':runQuery', {
    method: 'POST',

    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],

        ...(filter
          ? {
              where: {
                fieldFilter: {
                  field: { fieldPath: filter.field },

                  op: 'EQUAL',

                  value: { stringValue: filter.value },
                },
              },
            }
          : {}),
      },
    }),
  })

  if (!response.ok) throw new ServiceError('Unable to query notification data.', 503)

  const result = (await response.json()) as {
    document?: { name: string; fields: Record<string, RestValue> }
  }[]

  return result.flatMap((item) =>
    item.document
      ? [{ id: item.document.name.split('/').at(-1)!, ...unpack(item.document.fields || {}) }]
      : []
  ) as (Data & { id: string })[]
}

export async function identity(header: string): Promise<Identity> {
  const token = /^Bearer (.+)$/.exec(header)?.[1]

  if (!token || token.length > 10000) throw new ServiceError('Please sign in.', 401)

  const key = env('FIREBASE_WEB_API_KEY') || env('VITE_FIREBASE_API_KEY')

  if (!key) throw new ServiceError('Firebase Web API key is missing on the server.', 503)

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,

    {
      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ idToken: token }),

      signal: AbortSignal.timeout(10000),
    }
  )

  const data = await response.json()

  const user = data.users?.[0]

  if (!response.ok || !user || user.disabled)
    throw new ServiceError('Your session expired. Sign in again.', 401)

  return { uid: user.localId, email: user.email || '', emailVerified: !!user.emailVerified }
}

export async function preferences(uid: string): Promise<AlertPreferences> {
  const record = await getDocument(`notificationPreferences/${uid}`)

  return { ...defaultAlertPreferences, ...(record?.data.preferences as Partial<AlertPreferences>) }
}

function day(date: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,

    year: 'numeric',

    month: '2-digit',

    day: '2-digit',
  }).formatToParts(date)

  return ['year', 'month', 'day']

    .map((key) => values.find((value) => value.type === key)!.value)

    .join('-')
}

export function classifyExpiry(expiry: string, timeZone: string, now = new Date()) {
  const days = Math.round(
    (Date.parse(day(new Date(expiry), timeZone) + 'T00:00:00Z') -
      Date.parse(day(now, timeZone) + 'T00:00:00Z')) /
      86400000
  )

  return {
    days,

    level:
      days < 0
        ? 'expired'
        : days <= 3
          ? 'critical'
          : days <= 7
            ? 'warning'
            : days <= 14
              ? 'near'
              : days <= 30
                ? 'approaching'
                : 'safe',
  }
}

async function brevo(path: string, payload: unknown) {
  const response = await fetch(`https://api.brevo.com/v3/${path}`, {
    method: 'POST',

    headers: {
      'api-key': needed('BREVO_API_KEY'),

      'Content-Type': 'application/json',

      accept: 'application/json',
    },

    body: JSON.stringify(payload),

    signal: AbortSignal.timeout(15000),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok)
    throw new ServiceError(
      `Brevo rejected the request (${response.status}). Check sender verification, credits, and provider logs.`,

      502
    )

  return String(data.messageId || data.reference || data.id || '')
}

function unsubscribeSigningKey() {
  return createHmac('sha256', needed('BREVO_API_KEY')).update('SmartExpiry:unsubscribe:v2').digest()
}

function unsubscribeToken(user: Identity) {
  const payload = JSON.stringify({ uid: user.uid, email: user.email })

  return `${Buffer.from(payload).toString('base64url')}.${createHmac('sha256', unsubscribeSigningKey()).update(payload).digest('base64url')}`
}

export async function unsubscribe(token: string) {
  if (token.length > 2000) throw new ServiceError('Invalid unsubscribe link.')

  const [encoded, signature] = token.split('.')

  const payload = Buffer.from(encoded || '', 'base64url').toString()

  const expected = createHmac('sha256', unsubscribeSigningKey()).update(payload).digest()

  const actual = Buffer.from(signature || '', 'base64url')

  if (!payload || expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new ServiceError('Invalid unsubscribe link.')

  let recipient: { uid: string; email: string } | null = null

  try {
    const data = JSON.parse(payload)

    if (typeof data.uid === 'string' && typeof data.email === 'string' && data.email.includes('@'))
      recipient = data
  } catch {
    /* legacy links contain only a UID */
  }

  if (recipient) {
    const sender = needed('BREVO_SENDER_EMAIL')

    const existing = await brevoGet(`contacts/${encodeURIComponent(recipient.email)}`, true)

    const previous = Array.isArray(existing?.smtpBlacklistSender)
      ? existing.smtpBlacklistSender
      : []

    await brevo('contacts', {
      email: recipient.email,

      updateEnabled: true,

      smtpBlacklistSender: [...new Set([...previous, sender])],
    })

    emailCache.clear()

    return
  }

  const record = await getDocument(`notificationPreferences/${payload}`)

  if (record)
    await putDocument(
      `notificationPreferences/${payload}`,

      {
        ...record.data,

        preferences: {
          ...defaultAlertPreferences,

          ...(record.data.preferences as Data),

          emailEnabled: false,
        },
      },

      { updateTime: record.updateTime }
    )
}

export async function sendDigest(user: Identity) {
  if (!user.email) return { status: 'missing-email', count: 0 }

  const settings = await preferences(user.uid)

  if (!settings.emailEnabled) return { status: 'unsubscribed', count: 0 }

  const products = await list('products')

  const batches = products.some((product) => product.batchManaged) ? await list('batches') : []

  return sendAutomaticEmail(user, emailStockRows(products, batches))
}

export async function runScheduled() {
  let inventoryArchive: Data

  try {
    inventoryArchive = await captureClosedMonthSnapshot()
  } catch (error) {
    inventoryArchive = {
      status: 'failed',

      error: error instanceof ServiceError ? error.message : 'Month-end archiving failed.',
    }
  }

  const users = await list('users')

  const results: Data[] = []

  for (const record of users) {
    let user: Identity | null = null

    try {
      const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', {
        method: 'POST',

        headers: {
          Authorization: `Bearer ${await accessToken()}`,

          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          targetProjectId: (await credentials()).project_id,

          localId: [record.id],
        }),

        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok)
        throw new ServiceError(
          'Unable to verify a scheduled recipient. Check Firebase Authentication read permission.',

          503
        )

      const account = (await response.json()).users?.[0]

      if (account && !account.disabled)
        user = {
          uid: account.localId,

          email: account.email || '',

          emailVerified: !!account.emailVerified,
        }
    } catch (error) {
      results.push({
        uid: record.id,

        status: 'failed',

        error: error instanceof ServiceError ? error.message : 'Recipient verification failed.',
      })

      continue
    }

    if (!user) {
      results.push({ uid: record.id, status: 'skipped-deleted-or-disabled' })

      continue
    }

    try {
      results.push({ uid: user.uid, channel: 'email', ...(await sendDigest(user)) })
    } catch (error) {
      results.push({
        uid: user.uid,

        channel: 'email',

        status: 'failed',

        error: error instanceof ServiceError ? error.message : 'Email processing failed.',
      })
    }
  }

  return { results, inventoryArchive }
}

// Optional scheduler for a continuously running Node server. Serverless deployments

// need a separately authenticated scheduler integration. No public cron endpoint is exposed.

export function startAlertScheduler() {
  if (process.env.ALERTS_RUN_SCHEDULER !== 'true' || process.env.NODE_ENV !== 'production') return

  const runtime = globalThis as typeof globalThis & {
    __smartExpiryScheduler?: ReturnType<typeof setInterval>
  }

  if (runtime.__smartExpiryScheduler) return

  let running = false

  const tick = async () => {
    if (running) return

    running = true

    try {
      await runScheduled()
    } catch {
      console.error(
        'Smart Expiry scheduler failed. Check notification server configuration and connectivity.'
      )
    } finally {
      running = false
    }
  }

  runtime.__smartExpiryScheduler = setInterval(() => void tick(), 60000)

  runtime.__smartExpiryScheduler.unref()
}

// Firestore supports point-in-time reads within the preceding hour without PITR.

// Run this near local midnight on the first day to archive the exact closed month.

export async function captureClosedMonthSnapshot(now = new Date()) {
  const timeZone = env('STORE_TIME_ZONE') || 'Asia/Colombo'

  const today = day(now, timeZone)

  if (!today.endsWith('-01')) return { status: 'not-due' }

  const target = Date.parse(today + 'T00:00:00Z')

  let midnight = target

  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,

      year: 'numeric',

      month: '2-digit',

      day: '2-digit',

      hour: '2-digit',

      minute: '2-digit',

      second: '2-digit',

      hourCycle: 'h23',
    }).formatToParts(new Date(midnight))

    const number = (type: string) => Number(parts.find((part) => part.type === type)!.value)

    midnight +=
      target -
      Date.UTC(
        number('year'),

        number('month') - 1,

        number('day'),

        number('hour'),

        number('minute'),

        number('second')
      )
  }

  const asOf = new Date(midnight - 1)

  const month = day(asOf, timeZone).slice(0, 7)

  const path = `inventorySnapshots/${month}`

  if (await getDocument(path)) return { status: 'already-archived', month }

  if (now.getTime() - asOf.getTime() > 55 * 60000) return { status: 'archive-window-missed', month }

  const response = await rest(':runQuery', {
    method: 'POST',

    body: JSON.stringify({
      structuredQuery: { from: [{ collectionId: 'products' }] },

      readTime: asOf.toISOString(),
    }),
  })

  if (!response.ok)
    throw new ServiceError('Unable to read month-end inventory at its closing timestamp.', 503)

  const payload = (await response.json()) as { document?: { fields: Record<string, RestValue> } }[]

  const rows = payload.flatMap((item) => {
    if (!item.document) return []

    const product = unpack(item.document.fields)

    if (
      typeof product.productId !== 'string' ||
      typeof product.name !== 'string' ||
      typeof product.category !== 'string' ||
      !Number.isSafeInteger(product.stockQuantity) ||
      Number(product.stockQuantity) < 0 ||
      product.quantity !== product.stockQuantity ||
      typeof product.purchasePrice !== 'number' ||
      !Number.isFinite(product.purchasePrice) ||
      product.purchasePrice < 0 ||
      (product.expiryDate != null &&
        (typeof product.expiryDate !== 'string' ||
          !Number.isFinite(Date.parse(product.expiryDate))))
    )
      throw new ServiceError(
        'Inventory contains invalid records; a partial month-end archive was not saved.',

        503
      )

    return [
      {
        productId: product.productId,

        name: product.name,

        category: product.category,

        quantity: product.stockQuantity,

        purchasePrice: product.purchasePrice,

        ...(typeof product.stockValueMinor === 'number'
          ? { stockValueMinor: product.stockValueMinor }
          : {}),

        expiryDate: product.expiryDate ?? null,
      },
    ]
  })

  await putDocument(
    path,

    { month, timeZone, asOf: asOf.toISOString(), capturedAt: now.toISOString(), rows },

    { exists: false }
  )

  return { status: 'archived', month, count: rows.length }
}

export async function getInventorySnapshot(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ServiceError('Choose a valid month.')

  return { snapshot: (await getDocument(`inventorySnapshots/${month}`))?.data || null }
}

type EmailResult = {
  status:
    | 'accepted'
    | 'already-sent'
    | 'empty'
    | 'not-due'
    | 'not-configured'
    | 'missing-email'
    | 'unsubscribed'
    | 'unknown'

  count: number
}

const emailCache = new Map<string, { until: number; result: EmailResult }>()

const emailChecks = new Map<string, Promise<EmailResult>>()

async function brevoGet(path: string, allowMissing = false): Promise<Data | null> {
  const response = await fetch(`https://api.brevo.com/v3/${path}`, {
    headers: { 'api-key': needed('BREVO_API_KEY'), accept: 'application/json' },

    signal: AbortSignal.timeout(15000),
  })

  if (allowMissing && response.status === 404) return null

  if (!response.ok)
    throw new ServiceError(`Unable to check Brevo email records (${response.status}).`, 502)

  return response.json()
}

export function emailStockRows(
  products: (Data & { id: string })[],

  batches: (Data & { id: string })[]
) {
  return products

    .filter((product) => !product.archived)

    .flatMap((product) =>
      product.batchManaged
        ? batches

            .filter((batch) => batch.productId === product.id && Number(batch.quantity) > 0)

            .map((batch) => ({
              ...product,

              id: batch.id,

              name: `${String(product.name)} · Batch ${String(batch.batchNumber)}`,

              stockQuantity: batch.quantity,

              expiryDate: batch.expiryDate,
            }))
        : [product]
    )
}

function expiryEmailRows(products: (Data & { id: string })[]) {
  const timeZone = env('STORE_TIME_ZONE') || 'Asia/Colombo'

  return products

    .flatMap((product) => {
      if (
        typeof product.expiryDate !== 'string' ||
        !Number.isFinite(Date.parse(product.expiryDate)) ||
        !Number.isSafeInteger(product.stockQuantity) ||
        Number(product.stockQuantity) <= 0
      )
        return []

      const status = classifyExpiry(product.expiryDate, timeZone)

      if (status.days > 3) return []

      return [
        {
          productId: String(product.productId),

          name: String(product.name),

          quantity: Number(product.stockQuantity),

          expiry: day(new Date(product.expiryDate), timeZone),

          level: status.level,

          days: status.days,

          action:
            status.days < 0
              ? 'Remove from sale and review stock.'
              : status.days <= 3
                ? 'Review immediately. Consider a promotion.'
                : 'Review stock and promotion options.',
        },
      ]
    })

    .sort((a, b) => a.days - b.days)
}

async function sendAutomaticEmail(
  user: Identity,

  source: (Data & { id: string })[] | (() => Promise<(Data & { id: string })[]>)
): Promise<EmailResult> {
  if (!user.email) return { status: 'missing-email', count: 0 }

  if (!env('BREVO_API_KEY') || !env('BREVO_SENDER_EMAIL') || !env('APP_URL'))
    return { status: 'not-configured', count: 0 }

  const timeZone = env('STORE_TIME_ZONE') || 'Asia/Colombo'

  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date()
    )
  )

  const configuredHour = Number(env('ALERT_EMAIL_HOUR') || 8)

  if (!Number.isInteger(configuredHour) || configuredHour < 0 || configuredHour > 23)
    throw new ServiceError('The automatic email hour is invalid.', 503)

  if (hour < configuredHour) return { status: 'not-due', count: 0 }

  const tag = `se2-${createHash('sha256')
    .update(user.uid + ':' + user.email)

    .digest('hex')

    .slice(0, 20)}-${day(new Date(), timeZone).replaceAll('-', '')}`

  const cached = emailCache.get(tag)

  if (cached && cached.until > Date.now())
    return cached.result.status === 'accepted'
      ? { ...cached.result, status: 'already-sent' }
      : cached.result

  const inflight = emailChecks.get(tag)

  if (inflight) return inflight

  const task = (async (): Promise<EmailResult> => {
    const products = typeof source === 'function' ? await source() : source

    const alerts = expiryEmailRows(products)

    if (!alerts.length) return { status: 'empty', count: 0 }

    const contact = await brevoGet(`contacts/${encodeURIComponent(user.email)}`, true)

    if (
      Array.isArray(contact?.smtpBlacklistSender) &&
      contact.smtpBlacklistSender.includes(needed('BREVO_SENDER_EMAIL'))
    )
      return { status: 'unsubscribed', count: 0 }

    const query = new URLSearchParams({
      email: user.email,

      tags: tag,

      days: '2',

      limit: '1',

      sort: 'desc',
    })

    const activity = await brevoGet(`smtp/statistics/events?${query}`)

    if (Array.isArray(activity?.events) && activity.events.length)
      return { status: 'already-sent', count: alerts.length }

    const origin = new URL(needed('APP_URL')).origin

    const title = env('BREVO_SENDER_NAME') || 'Smart Expiry Tracking System'

    const unsubscribeUrl = `${origin}/api/alerts/unsubscribe?token=${encodeURIComponent(unsubscribeToken(user))}`

    const content = renderExpiryEmail({
      name: title,

      origin,

      unsubscribeUrl,

      items: alerts,

      generatedAt:
        new Intl.DateTimeFormat('en-GB', {
          dateStyle: 'medium',

          timeStyle: 'short',

          timeZone,
        }).format(new Date()) + ` (${timeZone})`,
    })

    try {
      await brevo('smtp/email', {
        sender: { email: needed('BREVO_SENDER_EMAIL'), name: title },

        to: [{ email: user.email }],

        subject: `${title}: ${alerts.length} expiry alerts`,

        ...content,

        tags: ['smart-expiry-auto', tag],

        headers: { IdempotencyKey: tag },
      })
    } catch (error) {
      // A timeout may follow provider acceptance; do not retry the same day's digest blindly.

      if (!(error instanceof ServiceError))
        emailCache.set(tag, {
          until: Date.now() + 86400000,

          result: { status: 'unknown', count: alerts.length },
        })

      throw error
    }

    return { status: 'accepted', count: alerts.length }
  })()

  emailChecks.set(tag, task)

  try {
    const result = await task

    const terminal = ['accepted', 'already-sent', 'unsubscribed'].includes(result.status)

    if (result.status !== 'empty')
      emailCache.set(tag, { until: Date.now() + (terminal ? 86400000 : 60000), result })

    for (const [key, entry] of emailCache) if (entry.until < Date.now()) emailCache.delete(key)

    return result
  } finally {
    emailChecks.delete(tag)
  }
}

// Uses the signed-in user's ID token and the deployed Firestore Security Rules.

// It does not require a Firebase service-account key.

export async function checkAutomaticEmail(user: Identity, token: string) {
  return sendAutomaticEmail(user, async () => {
    const project = env('FIREBASE_PROJECT_ID') || needed('VITE_FIREBASE_PROJECT_ID')

    const read = async (collectionId: string): Promise<(Data & { id: string })[]> => {
      const response = await fetch(
        `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents:runQuery`,

        {
          method: 'POST',

          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },

          body: JSON.stringify({ structuredQuery: { from: [{ collectionId }] } }),

          signal: AbortSignal.timeout(15000),
        }
      )

      if (!response.ok)
        throw new ServiceError(
          'Unable to read inventory for automatic expiry emails.',

          response.status === 403 ? 403 : 503
        )

      const payload = (await response.json()) as {
        document?: { name: string; fields: Record<string, RestValue> }
      }[]

      return payload.flatMap((row) =>
        row.document
          ? [{ ...unpack(row.document.fields || {}), id: row.document.name.split('/').at(-1)! }]
          : []
      )
    }

    const products = await read('products')

    const batches = products.some((product) => product.batchManaged) ? await read('batches') : []

    return emailStockRows(products, batches)
  })
}
