import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DevicesService } from './devices.service';

@Injectable()
export class DevicesScheduler {
  private readonly logger = new Logger(DevicesScheduler.name);

  constructor(private readonly devicesService: DevicesService) {}

  /** Mark devices offline if they haven't sent a heartbeat in the last 3 minutes */
  @Cron(CronExpression.EVERY_MINUTE)
  async markStaleDevicesOffline() {
    await this.devicesService.markOfflineStaleDevices(3);
  }
}
