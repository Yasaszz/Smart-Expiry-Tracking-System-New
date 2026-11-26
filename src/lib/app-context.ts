import type { User } from 'firebase/auth'
import { createContext, useContext } from 'react'

import type { Product } from './firebase'
import type { Batch } from './retail-domain'

interface AuthState {
  user: User | null
  loading: boolean
}
interface InventoryState {
  owner: string
  products: Product[]
  batches: Batch[]
  batchLoading: boolean
  batchError: string
  batchStale: boolean
  loading: boolean
  error: string
  stale: boolean
  retry: () => void
}

// Keep context identity stable across route-module hot reloads.
const contexts = import.meta.hot?.data.contexts ?? {
  auth: createContext<AuthState>({ user: null, loading: true }),
  inventory: createContext<InventoryState | null>(null),
}
if (import.meta.hot) import.meta.hot.data.contexts = contexts

export const AuthContext = contexts.auth as ReturnType<typeof createContext<AuthState>>
export const InventoryContext = contexts.inventory as ReturnType<
  typeof createContext<InventoryState | null>
>

export function useAuth() {
  return useContext(AuthContext)
}
export function useInventory() {
  const inventory = useContext(InventoryContext)
  if (!inventory) throw new Error('Inventory must be used inside the application layout.')
  return inventory
}
