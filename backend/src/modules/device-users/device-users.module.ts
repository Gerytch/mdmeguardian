import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { DeviceUser } from './entities/device-user.entity'
import { DeviceUsersService } from './device-users.service'
import { DeviceUsersController } from './device-users.controller'

@Module({
  imports: [TypeOrmModule.forFeature([DeviceUser])],
  controllers: [DeviceUsersController],
  providers: [DeviceUsersService],
  exports: [DeviceUsersService],
})
export class DeviceUsersModule {}
