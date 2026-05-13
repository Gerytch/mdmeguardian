import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Request,
} from '@nestjs/common';
import { RemoteSessionService } from './remote-session.service';
import { RemoteSessionGateway } from './remote-session.gateway';
import { RemoteSession } from './remote-session.entity';

@Controller()
export class RemoteSessionController {
  constructor(
    private readonly sessionService: RemoteSessionService,
    private readonly gateway: RemoteSessionGateway,
  ) {}

  @Post('tenants/:tenantId/remote-sessions')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: { deviceId: string },
    @Request() req: any,
  ): Promise<RemoteSession> {
    return this.sessionService.create(tenantId, body.deviceId, req.user?.id ?? req.user?.userId);
  }

  @Get('tenants/:tenantId/remote-sessions/:id')
  findOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RemoteSession> {
    return this.sessionService.findOne(tenantId, id);
  }

  @Delete('tenants/:tenantId/remote-sessions/:id')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RemoteSession> {
    const session = await this.sessionService.close(tenantId, id);
    // Also force-disconnect any WebSocket clients in this session room
    this.gateway.closeSession(id);
    return session;
  }
}
