import { Module } from '@nestjs/common'
import { DeviceUsersModule } from '../device-users/device-users.module'
import { DeviceSessionsModule } from '../device-sessions/device-sessions.module'
import { DevicesModule } from '../devices/devices.module'
import { DeviceUserAuthService } from './device-user-auth.service'
import { DeviceUserAuthController } from './device-user-auth.controller'

@Module({
  imports: [DeviceUsersModule, DeviceSessionsModule, DevicesModule],
  controllers: [DeviceUserAuthController],
  providers: [DeviceUserAuthService],
})
export class DeviceUserAuthModule {}
