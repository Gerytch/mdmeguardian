import {
  Controller,
  Get,
  Delete,
  Param,
  Query,
  ParseUUIDPipe,
  Header,
  Res,
  HttpCode,
} from '@nestjs/common'
import { Response } from 'express'
import { DeviceSessionsService } from './device-sessions.service'
import { DeviceSession, DeviceSessionStatus } from './entities/device-session.entity'

@Controller('tenants/:tenantId/device-sessions')
export class DeviceSessionsController {
  constructor(private readonly deviceSessionsService: DeviceSessionsService) {}

  @Get()
  findAll(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('deviceId') deviceId?: string,
    @Query('deviceUserId') deviceUserId?: string,
    @Query('status') status?: DeviceSessionStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.deviceSessionsService.findAll(tenantId, { deviceId, deviceUserId, status, from, to, page, limit })
  }

  @Delete(':sessionId')
  @HttpCode(204)
  async closeSession(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    await this.deviceSessionsService.closeById(tenantId, sessionId)
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename=sessions.csv')
  async exportCsv(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Res() res: Response,
    @Query('deviceId') deviceId?: string,
    @Query('deviceUserId') deviceUserId?: string,
    @Query('status') status?: DeviceSessionStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const sessions = await this.deviceSessionsService.exportCsv(tenantId, { deviceId, deviceUserId, status, from, to })
    const csvString = this.toCsv(sessions)
    res.send(csvString)
  }

  private toCsv(sessions: DeviceSession[]): string {
    const header = 'id,tenantId,deviceId,deviceName,deviceUserId,username,fullName,startedAt,endedAt,status,endedReason,createdAt'
    const rows = sessions.map(s =>
      [
        s.id,
        s.tenantId,
        s.deviceId,
        s.device?.name ?? '',
        s.deviceUserId,
        s.deviceUser?.username ?? '',
        s.deviceUser?.fullName ?? '',
        s.startedAt?.toISOString() ?? '',
        s.endedAt?.toISOString() ?? '',
        s.status,
        s.endedReason ?? '',
        s.createdAt?.toISOString() ?? '',
      ].join(','),
    )
    return [header, ...rows].join('\n')
  }
}
