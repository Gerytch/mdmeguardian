import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DeviceSession } from './entities/device-session.entity'
import { DeviceUser } from '../device-users/entities/device-user.entity'
import { DeviceSessionsService } from './device-sessions.service'
import { DeviceSessionsController } from './device-sessions.controller'

@Module({
  imports: [TypeOrmModule.forFeature([DeviceSession, DeviceUser])],
  controllers: [DeviceSessionsController],
  providers: [DeviceSessionsService],
  exports: [DeviceSessionsService],
})
export class DeviceSessionsModule {}
