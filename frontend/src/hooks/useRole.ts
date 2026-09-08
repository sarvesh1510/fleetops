import { useAuthStore } from '../stores/authStore'
import type { UserRole } from '../types'

const ROLE_LEVELS: Record<UserRole, number> = {
  admin: 4,
  operations_manager: 3,
  dispatcher: 2,
  viewer: 1,
}

export function useRole() {
  const user = useAuthStore(s => s.user)
  const role = (user?.role ?? 'viewer') as UserRole
  const level = ROLE_LEVELS[role] ?? 1
  return {
    role, user, level,
    isAdmin:             level >= 4,
    isOpsOrAbove:        level >= 3,
    isDispatcherOrAbove: level >= 2,
    isViewer:            level === 1,
    canCreateOrders:     level >= 2,
    canResolveIncidents: level >= 2,
    canRunOptimization:  level >= 2,
    canControlSim:       level >= 3,
    canTriggerEvents:    level >= 2,
    roleLabel: role.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
  }
}
