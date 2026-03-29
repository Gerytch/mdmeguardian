import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Policy } from './entities/policy.entity';
import { Device } from '../devices/entities/device.entity';
import { Command } from '../commands/entities/command.entity';
import { App } from '../apps/entities/app.entity';
import { PoliciesService } from './policies.service';
import { PoliciesController } from './policies.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Policy, Device, Command, App])],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [PoliciesService],
})
export class PoliciesModule {}
