import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Command } from './entities/command.entity';
import { Device } from '../devices/entities/device.entity';
import { Policy } from '../policies/entities/policy.entity';
import { App } from '../apps/entities/app.entity';
import { DeviceSession } from '../device-sessions/entities/device-session.entity';
import { CommandsService } from './commands.service';
import { CommandsController } from './commands.controller';
import { AppsModule } from '../apps/apps.module';

@Module({
  imports: [TypeOrmModule.forFeature([Command, Device, Policy, App, DeviceSession]), AppsModule],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
