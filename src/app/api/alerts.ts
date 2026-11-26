import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import {
  ServiceError,
  checkAutomaticEmail,
  getInventorySnapshot,
  identity,
  startAlertScheduler,
  unsubscribe,
  type Identity,
} from '../../lib/alerts-server'
import { isAllowedRequestOrigin } from '../../lib/request-origin'

const app = new Hono<{ Variables: { identity: Identity; idToken: string } }>()
startAlertScheduler()
app.use(
  '*',
  bodyLimit({ maxSize: 32768, onError: (c) => c.json({ error: 'Request is too large.' }, 413) })
)
app.onError((error, c) =>
  c.json(
    {
      error:
        error instanceof ServiceError
          ? error.message
          : 'The email service could not complete this request.',
    },
    error instanceof ServiceError ? (error.status as 400) : 500
  )
)
app.get('/alerts/health', (c) => c.json({ status: 'ok' }))
app.get('/alerts/unsubscribe', (c) => {
  const token = c.req.query('token') || ''
  if (token.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token))
    return c.text('Invalid unsubscribe link.', 400)
  c.header('Cache-Control', 'no-store')
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; form-action 'self'; frame-ancestors 'none'"
  )
  return c.html(
    `<!doctype html><html><head><meta charset="utf-8"><title>Stop expiry emails</title></head><body><h1>Stop automatic expiry emails</h1><p>Your website account and notifications will remain available.</p><form method="post"><input type="hidden" name="token" value="${token}"><button type="submit">Stop expiry emails</button></form></body></html>`
  )
})
app.post('/alerts/unsubscribe', async (c) => {
  const body = await c.req.parseBody()
  await unsubscribe(String(body.token || ''))
  return c.html(
    '<!doctype html><html><head><title>Expiry emails stopped</title></head><body><h1>Expiry emails stopped</h1><p>Your website notifications remain available.</p></body></html>'
  )
})
app.use('/alerts/*', async (c, next) => {
  c.header('Cache-Control', 'no-store')
  if (!isAllowedRequestOrigin(c.req.raw))
    return c.json({ error: 'Cross-origin requests are not allowed.' }, 403)
  const header = c.req.header('Authorization') || ''
  c.set('identity', await identity(header))
  c.set('idToken', header.replace(/^Bearer /, ''))
  await next()
})
app.post('/alerts/check-email', async (c) =>
  c.json(await checkAutomaticEmail(c.get('identity'), c.get('idToken')))
)
app.get('/alerts/inventory-snapshot', async (c) =>
  c.json(await getInventorySnapshot(c.req.query('month') || ''))
)
export default app
