import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from './entities/device.entity';
import { EnrollmentToken } from './entities/enrollment-token.entity';
import { Command } from '../commands/entities/command.entity';
import { DevicesService } from './devices.service';
import { DevicesController } from './devices.controller';
import { DevicesScheduler } from './devices.scheduler';

@Module({
  imports: [TypeOrmModule.forFeature([Device, EnrollmentToken, Command])],
  controllers: [DevicesController],
  providers: [DevicesService, DevicesScheduler],
  exports: [DevicesService],
})
export class DevicesModule {}
