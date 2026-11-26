// Automatic email defaults are server-controlled; users do not configure delivery channels.
export interface AlertPreferences {
  emailEnabled: boolean
  lowStockEnabled: boolean
  levels: string[]
  hour: number
  timeZone: string
}
export const defaultAlertPreferences: AlertPreferences = {
  emailEnabled: true,
  lowStockEnabled: false,
  levels: ['critical', 'expired'],
  hour: 8,
  timeZone: 'Asia/Colombo',
}
