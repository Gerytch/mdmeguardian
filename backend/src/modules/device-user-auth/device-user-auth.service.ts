import { Injectable, UnauthorizedException, GoneException } from '@nestjs/common'
import { DeviceUsersService } from '../device-users/device-users.service'
import { DeviceSessionsService } from '../device-sessions/device-sessions.service'
import { DevicesService } from '../devices/devices.service'
import { DeviceSessionStatus } from '../device-sessions/entities/device-session.entity'

@Injectable()
export class DeviceUserAuthService {
  constructor(
    private readonly deviceUsersService: DeviceUsersService,
    private readonly deviceSessionsService: DeviceSessionsService,
    private readonly devicesService: DevicesService,
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
  }> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    const deviceUser = await this.deviceUsersService.validateCredentials(device.tenantId, username, pin)

    await this.deviceSessionsService.closeActiveForDevice(device.tenantId, device.id, 'SUPERSEDED')
    await this.deviceSessionsService.closeActiveForUser(device.tenantId, deviceUser.id, 'SUPERSEDED_OTHER_DEVICE')

    const session = await this.deviceSessionsService.create(device.tenantId, device.id, deviceUser.id)

    return {
      sessionId: session.id,
      deviceUserId: deviceUser.id,
      fullName: deviceUser.fullName,
      jobTitle: deviceUser.jobTitle,
      photoUrl: deviceUser.photoUrl,
    }
  }

  async logoutDeviceUser(deviceToken: string, sessionId: string, reason?: string): Promise<void> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

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

    await this.deviceSessionsService.endSession(
      device.id,
      sessionId,
      DeviceSessionStatus.TIMEOUT,
      'INACTIVITY_TIMEOUT',
    )
  }

  async validateSession(deviceToken: string, sessionId: string): Promise<{ valid: boolean }> {
    const device = await this.devicesService.findByToken(deviceToken)
    if (!device) throw new UnauthorizedException('Invalid device token')

    const session = await this.deviceSessionsService.findById(sessionId, device.id)
    if (!session || session.status !== DeviceSessionStatus.ACTIVE) {
      throw new GoneException('Session is no longer active')
    }
    return { valid: true }
  }
}
