// APP_URL is the canonical email-link origin, not the only address the app can serve.
export function isAllowedRequestOrigin(request: Request): boolean {
  const value = request.headers.get('Origin')
  // Non-browser clients still need the endpoint's Firebase bearer token.
  if (value === null) return true
  try {
    const origin = new URL(value)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value) return false
    if (origin.origin === new URL(request.url).origin) return true
    const configured = process.env.APP_URL || process.env.BINI_APP_URL
    return !!configured && origin.origin === new URL(configured).origin
  } catch {
    return false
  }
}
