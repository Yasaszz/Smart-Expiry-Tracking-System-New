export interface ExpiryEmailItem {
  productId: string
  name: string
  quantity: number
  expiry: string
  level: string
  action: string
}
const escape = (value: string | number) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  )

export function renderExpiryEmail(input: {
  name: string
  origin: string
  unsubscribeUrl: string
  items: ExpiryEmailItem[]
  generatedAt: string
}) {
  const { name, origin, unsubscribeUrl, items, generatedAt } = input
  const expired = items.filter((item) => item.level === 'expired').length
  const critical = items.length - expired
  const preheader = `${expired} expired and ${critical} critical stock batches need your attention.`
  const cards = items
    .map((item) => {
      const isExpired = item.level === 'expired'
      const colour = isExpired ? '#b91c1c' : '#b45309'
      const tint = isExpired ? '#fef2f2' : '#fffbeb'
      const label = isExpired ? 'Expired' : 'Critical'
      const date = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(item.expiry + 'T12:00:00Z'))
      return `<tr><td style="padding:0 28px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:12px;border-collapse:separate;background:#ffffff"><tr><td style="padding:18px 20px 12px"><span style="display:inline-block;padding:5px 10px;border-radius:6px;background:${tint};color:${colour};font-size:11px;font-weight:700;letter-spacing:.3px">${label.toUpperCase()}</span><h3 style="margin:12px 0 5px;font-size:17px;line-height:24px;color:#0f172a"><a href="${escape(origin)}/products?search=${encodeURIComponent(item.productId)}" style="color:#0f172a;text-decoration:none">${escape(item.name)}</a></h3><p style="margin:0;color:#64748b;font-size:12px">${escape(item.productId)}</p></td></tr><tr><td style="padding:0 20px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="45%" style="font-size:12px;color:#64748b;line-height:22px">Stock remaining<br><strong style="font-size:15px;color:#0f172a">${item.quantity} units</strong></td><td style="font-size:12px;color:#64748b;line-height:22px">Expiry date<br><strong style="font-size:15px;color:${colour}">${date}</strong></td></tr></table></td></tr><tr><td style="padding:12px 20px;background:${tint};border-radius:0 0 12px 12px;color:${colour};font-size:12px;line-height:19px">${escape(item.action)}</td></tr></table></td></tr>`
    })
    .join('')
  const htmlContent = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inventory expiry alerts</title></head><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a"><div style="display:none;font-size:1px;color:#f1f5f9;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${escape(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;border-collapse:separate"><tr><td style="padding:28px;background:#0f172a;border-radius:16px 16px 0 0;border-bottom:4px solid #6366f1"><p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:2px;color:#a5b4fc">INVENTORY ALERT</p><p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;line-height:28px">${escape(name)}</p></td></tr><tr><td style="padding:28px 28px 20px"><h1 style="margin:0 0 10px;font-size:25px;line-height:32px;color:#0f172a">Stock needs your attention</h1><p style="margin:0;font-size:14px;line-height:23px;color:#64748b">Review expired stock and batches due within the next three days.</p></td></tr><tr><td style="padding:0 28px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="48%" style="padding:16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px"><strong style="display:block;color:#b91c1c;font-size:27px;line-height:34px">${expired}</strong><span style="color:#991b1b;font-size:12px;font-weight:700">Expired stock batches</span></td><td width="4%"></td><td width="48%" style="padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px"><strong style="display:block;color:#b45309;font-size:27px;line-height:34px">${critical}</strong><span style="color:#92400e;font-size:12px;font-weight:700">Critical stock batches</span></td></tr></table></td></tr>${cards}<tr><td align="center" style="padding:8px 28px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:#4f46e5"><a href="${escape(origin)}/notifications" style="display:inline-block;padding:14px 26px;border:1px solid #4f46e5;border-radius:8px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700">Review inventory alerts</a></td></tr></table><p style="margin:16px 0 0;font-size:11px;line-height:18px;color:#94a3b8">Inventory checked ${escape(generatedAt)}</p></td></tr><tr><td align="center" style="padding:20px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;border-radius:0 0 16px 16px"><p style="margin:0 0 8px;font-size:11px;line-height:18px;color:#64748b">${escape(name)}<br>Automatic expiry summary for your registered account.</p><a href="${escape(unsubscribeUrl)}" style="color:#64748b;font-size:11px;text-decoration:underline">Stop expiry emails</a></td></tr></table></td></tr></table></body></html>`
  const textContent = [
    name,
    'Inventory expiry alerts',
    preheader,
    ...items.map(
      (item) =>
        `${item.name} (${item.productId}) — ${item.level === 'expired' ? 'Expired' : 'Critical'}\nStock: ${item.quantity} units | Expiry: ${item.expiry}\n${item.action}`
    ),
    `Review inventory: ${origin}/notifications`,
    `Inventory checked ${generatedAt}`,
    `Stop expiry emails: ${unsubscribeUrl}`,
  ].join('\n\n')
  return { htmlContent, textContent }
}
