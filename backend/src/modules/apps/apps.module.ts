import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { App } from './entities/app.entity';
import { Device } from '../devices/entities/device.entity';
import { Command } from '../commands/entities/command.entity';
import { Policy } from '../policies/entities/policy.entity';
import { AppsService } from './apps.service';
import { AppsController } from './apps.controller';

@Module({
  imports: [TypeOrmModule.forFeature([App, Device, Command, Policy])],
  controllers: [AppsController],
  providers: [AppsService],
  exports: [AppsService],
})
export class AppsModule {}
