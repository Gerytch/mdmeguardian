import { User } from '@/types'

export function saveTokens(accessToken: string, refreshToken: string, user: User) {
  localStorage.setItem('accessToken', accessToken)
  localStorage.setItem('refreshToken', refreshToken)
  localStorage.setItem('user', JSON.stringify(user))
  localStorage.setItem('tenantId', user.tenantId)
}

export function getUser(): User | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem('user')
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export function getTenantId(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem('tenantId') || ''
}

export function logout() {
  localStorage.clear()
  window.location.href = '/login'
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false
  return !!localStorage.getItem('accessToken')
}
