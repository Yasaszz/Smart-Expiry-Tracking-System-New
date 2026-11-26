import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import { identity, ServiceError } from '../../lib/alerts-server'
import { answerStoreQuestion } from '../../lib/chat-server'
import { isAllowedRequestOrigin } from '../../lib/request-origin'

const app = new Hono()
const limits = new Map<string, { start: number; count: number; busy: boolean }>()
app.use(
  '*',
  bodyLimit({
    maxSize: 24000,
    onError: (c) => c.json({ error: 'The conversation is too large.' }, 413),
  })
)
app.onError((error, c) =>
  c.json(
    {
      error:
        error instanceof ServiceError
          ? error.message
          : 'The assistant could not complete this request.',
    },
    error instanceof ServiceError ? (error.status as 400) : 500
  )
)
app.post('/chat', async (c) => {
  c.header('Cache-Control', 'no-store')
  if (!isAllowedRequestOrigin(c.req.raw))
    return c.json({ error: 'Cross-origin requests are not allowed.' }, 403)
  const header = c.req.header('Authorization') || ''
  const user = await identity(header)
  const now = Date.now()
  for (const [key, value] of limits)
    if (!value.busy && now - value.start > 60000) limits.delete(key)
  const limit = limits.get(user.uid) || { start: now, count: 0, busy: false }
  if (limit.busy || limit.count >= 8) {
    c.header('Retry-After', '60')
    return c.json({ error: 'Please wait before sending another message.' }, 429)
  }
  limit.count++
  limit.busy = true
  limits.set(user.uid, limit)
  try {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      throw new ServiceError('Send a valid question.', 400)
    }
    return c.json(await answerStoreQuestion(header.replace(/^Bearer /, ''), body))
  } finally {
    limit.busy = false
  }
})
export default app
