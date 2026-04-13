import { Injectable, UnauthorizedException, GoneException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DeviceUsersService } from '../device-users/device-users.service'
import { DeviceSessionsService } from '../device-sessions/device-sessions.service'
import { DevicesService } from '../devices/devices.service'
import { UsersService } from '../users/users.service'
import { DeviceSessionStatus } from '../device-sessions/entities/device-session.entity'
import { DeviceUserStatus } from '../device-users/entities/device-user.entity'

const ADMIN_SESSION_PREFIX = 'adm_'

@Injectable()
export class DeviceUserAuthService {
  constructor(
    private readonly deviceUsersService: DeviceUsersService,
    private readonly deviceSessionsService: DeviceSessionsService,
    private readonly devicesService: DevicesService,
    private readonly usersService: UsersService,
  ) {}

  async loginDeviceUser(
    deviceToken: string,
    username: string,
    pin: string,
  ): Promise<{
    sessionId: string
    deviceUserId: string
    fullName: string
    jobTitle: string | null
    photoUrl: string | null
    sessionType: 'operational' | 'admin'
  }> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    // 1. Try operational user (device_users table)
    let operationalUser: Awaited<ReturnType<DeviceUsersService['validateCredentials']>> | null = null
    try {
      operationalUser = await this.deviceUsersService.validateCredentials(device.tenantId, username, pin)
    } catch (_) {
      // not found or invalid credentials — will try IT admin below
    }

    if (operationalUser) {
      await this.deviceSessionsService.closeActiveForDevice(device.tenantId, device.id, 'SUPERSEDED')
      await this.deviceSessionsService.closeActiveForUser(device.tenantId, operationalUser.id, 'SUPERSEDED_OTHER_DEVICE')
      const session = await this.deviceSessionsService.create(device.tenantId, device.id, operationalUser.id)
      return {
        sessionId: session.id,
        deviceUserId: operationalUser.id,
        fullName: operationalUser.fullName,
        jobTitle: operationalUser.jobTitle,
        photoUrl: operationalUser.photoUrl,
        sessionType: 'operational',
      }
    }

    // 2. Try IT admin user (users table with canAccessDevices=true)
    const itUser = await this.usersService.findByDeviceCredentials(device.tenantId, username, pin)
    if (!itUser) throw new UnauthorizedException('Invalid credentials')

    // Admin sessions: close any active operational session but don't create a device_session record
    await this.deviceSessionsService.closeActiveForDevice(device.tenantId, device.id, 'SUPERSEDED')

    return {
      sessionId: ADMIN_SESSION_PREFIX + randomUUID(),
      deviceUserId: itUser.id,
      fullName: `${itUser.firstName} ${itUser.lastName}`,
      jobTitle: null,
      photoUrl: null,
      sessionType: 'admin',
    }
  }

  async logoutDeviceUser(deviceToken: string, sessionId: string, reason?: string): Promise<void> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    if (sessionId.startsWith(ADMIN_SESSION_PREFIX)) return // admin sessions not tracked in DB

    await this.deviceSessionsService.endSession(
      device.id,
      sessionId,
      DeviceSessionStatus.CLOSED,
      reason ?? 'MANUAL_LOGOUT',
    )
  }

  async timeoutSession(deviceToken: string, sessionId: string): Promise<void> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    if (sessionId.startsWith(ADMIN_SESSION_PREFIX)) return // admin sessions not tracked in DB

    await this.deviceSessionsService.endSession(
      device.id,
      sessionId,
      DeviceSessionStatus.TIMEOUT,
      'INACTIVITY_TIMEOUT',
    )
  }

  async getDeviceUsers(deviceToken: string): Promise<
    Array<{
      id: string
      username: string
      fullName: string
      pinHash: string
      jobTitle: string | null
      photoUrl: string | null
      status: string
      isDeviceAdmin: boolean
    }>
  > {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    const operationalUsers = await this.deviceUsersService.findAllWithPinHash(device.tenantId)
    const result = operationalUsers.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      pinHash: (u as any).pinHash,
      jobTitle: u.jobTitle,
      photoUrl: u.photoUrl,
      status: u.status,
      isDeviceAdmin: u.isDeviceAdmin,
    }))

    // Include IT admin users from users table
    const itUsers = await this.usersService.findAllWithDevicePinHash(device.tenantId)
    for (const u of itUsers) {
      result.push({
        id: u.id,
        username: u.deviceUsername!,
        fullName: `${u.firstName} ${u.lastName}`,
        pinHash: (u as any).devicePinHash,
        jobTitle: null,
        photoUrl: null,
        status: DeviceUserStatus.ACTIVE,
        isDeviceAdmin: true,
      })
    }

    return result
  }

  async syncOfflineSessions(
    deviceToken: string,
    sessions: Array<{
      offlineSessionId: string
      deviceUserId: string
      startedAt: string
      endedAt?: string | null
      endedReason?: string | null
      status?: string
    }>,
  ): Promise<{ synced: number }> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    return this.deviceSessionsService.syncOffline(device.tenantId, device.id, sessions)
  }

  async validateSession(deviceToken: string, sessionId: string): Promise<{ valid: boolean }> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    if (sessionId.startsWith(ADMIN_SESSION_PREFIX)) return { valid: true } // admin sessions always valid

    const session = await this.deviceSessionsService.findById(sessionId, device.id)
    if (!session || session.status !== DeviceSessionStatus.ACTIVE) {
      throw new GoneException('Session is no longer active')
    }
    return { valid: true }
  }
}
