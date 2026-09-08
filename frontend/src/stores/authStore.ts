import { create } from 'zustand'
import type { AuthUser, AuthState } from '../types'
import { authApi } from '../services/api'

interface AuthStore extends AuthState {
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  loadFromStorage: () => void
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: null,
  user: null,
  isAuthenticated: false,

  loadFromStorage() {
    const token = localStorage.getItem('fleetops_token')
    const userStr = localStorage.getItem('fleetops_user')
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as AuthUser
        set({ token, user, isAuthenticated: true })
      } catch {
        localStorage.removeItem('fleetops_token')
        localStorage.removeItem('fleetops_user')
      }
    }
  },

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
    set({ token: null, user: null, isAuthenticated: false })
    window.location.href = '/login'
  },
}))
