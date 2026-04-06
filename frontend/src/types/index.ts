export interface User {
  id: string
  tenantId: string
  email: string
  firstName: string
  lastName: string
  role: 'TENANT_ADMIN' | 'MANAGER' | 'VIEWER'
  isActive: boolean
  lastLoginAt: string
  createdAt: string
}

export interface Tenant {
  id: string
  name: string
  slug: string
  plan: 'FREE' | 'PRO' | 'ENTERPRISE'
  isActive: boolean
  createdAt: string
}

export interface Device {
  id: string
  tenantId: string
  name: string
  serialNumber: string
  imei: string | null
  androidVersion: string | null
  manufacturer: string | null
  model: string | null
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'LOST' | 'WIPED'
  enrollmentDate: string | null
  lastSeenAt: string | null
  policyId: string | null
  isKioskMode: boolean
  kioskApps: string[] | null
  batteryLevel: number | null
  isOnline: boolean
  agentVersion: string | null
  createdAt: string
}

export interface Command {
  id: string
  tenantId: string
  deviceId: string
  type: 'LOCK' | 'UNLOCK' | 'WIPE' | 'REBOOT' | 'INSTALL_APP' | 'UNINSTALL_APP' | 'UPDATE_POLICY' | 'ENABLE_KIOSK' | 'DISABLE_KIOSK' | 'LOCATE'
  payload: Record<string, any>
  status: 'PENDING' | 'SENT' | 'EXECUTING' | 'EXECUTED' | 'FAILED'
  createdBy: string
  sentAt: string | null
  executedAt: string | null
  result: Record<string, any> | null
  createdAt: string
}

export interface PolicyRules {
  allowedApps: string[]
  blockedApps: string[]
  kioskMode: boolean
  kioskModeType?: 'whitelist' | 'blacklist'
  kioskApps: string[]
  screenTimeoutSeconds?: number
  locationTracking: boolean
  trackingIntervalMinutes: number
  wifiOnly: boolean
  screenshotBlocked: boolean
  cameraBlocked: boolean
  usbBlocked: boolean
  deviceUserAuthRequired?: boolean
  inactivityTimeoutMinutes?: number
}

export interface Policy {
  id: string
  tenantId: string
  name: string
  description: string | null
  rules: PolicyRules
  requiredAppIds: string[]
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface App {
  id: string
  tenantId: string
  name: string
  packageName: string
  version: string
  apkUrl: string | null
  description: string | null
  isSystem: boolean
  isRequired: boolean
  createdAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  tokenType: string
  user: User
}
