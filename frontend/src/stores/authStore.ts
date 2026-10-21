import { create } from 'zustand'
import type { AuthUser, AuthState } from '../types'
import { authApi } from '../services/api'
import { queryClient } from '../lib/queryClient'

interface AuthStore extends AuthState {
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

/** Read the persisted session synchronously so a page refresh never flashes the login screen. */
function readSession(): AuthState {
  const token = localStorage.getItem('fleetops_token')
  const raw = localStorage.getItem('fleetops_user')
  if (token && raw) {
    try {
      return { token, user: JSON.parse(raw) as AuthUser, isAuthenticated: true }
    } catch {
      localStorage.removeItem('fleetops_token')
      localStorage.removeItem('fleetops_user')
    }
  }
  return { token: null, user: null, isAuthenticated: false }
}

export const useAuthStore = create<AuthStore>((set) => ({
  ...readSession(),

  async login(username, password) {
    const res = await authApi.login(username, password)
    const user: AuthUser = {
      user_id: res.user_id,
      username: res.username,
      email: '',
      full_name: res.full_name,
      role: res.role as AuthUser['role'],
    }
    localStorage.setItem('fleetops_token', res.access_token)
    localStorage.setItem('fleetops_user', JSON.stringify(user))
    set({ token: res.access_token, user, isAuthenticated: true })
  },

  logout() {
    localStorage.removeItem('fleetops_token')
    localStorage.removeItem('fleetops_user')
    queryClient.clear()
    set({ token: null, user: null, isAuthenticated: false })
  },
}))
