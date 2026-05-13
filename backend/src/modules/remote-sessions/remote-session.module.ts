import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RemoteSession } from './remote-session.entity';
import { Device } from '../devices/entities/device.entity';
import { Command } from '../commands/entities/command.entity';
import { RemoteSessionService } from './remote-session.service';
import { RemoteSessionController } from './remote-session.controller';
import { RemoteSessionGateway } from './remote-session.gateway';

@Module({
  imports: [TypeOrmModule.forFeature([RemoteSession, Device, Command])],
  controllers: [RemoteSessionController],
  providers: [RemoteSessionService, RemoteSessionGateway],
  exports: [RemoteSessionService, RemoteSessionGateway],
})
export class RemoteSessionModule {}
