import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceGroup } from './entities/device-group.entity';
import { Device } from '../devices/entities/device.entity';
import { Command } from '../commands/entities/command.entity';
import { Policy } from '../policies/entities/policy.entity';
import { DeviceGroupsController } from './device-groups.controller';
import { DeviceGroupsService } from './device-groups.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceGroup, Device, Command, Policy])],
  controllers: [DeviceGroupsController],
  providers: [DeviceGroupsService],
  exports: [DeviceGroupsService],
})
export class DeviceGroupsModule {}
