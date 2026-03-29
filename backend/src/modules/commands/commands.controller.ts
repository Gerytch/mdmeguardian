import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Headers,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  UnauthorizedException,
  Request,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { CommandsService, AckCommandDto } from './commands.service';
import { Command, CommandType } from './entities/command.entity';
import { Public } from '../../common/decorators/public.decorator';
import { AppsService } from '../apps/apps.service';

class AppInfoDto {
  @IsString()
  packageName: string;

  @IsString()
  name: string;
}

class SyncAppsBodyDto {
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AppInfoDto)
  apps: AppInfoDto[];
}

interface CreateCommandBody {
  deviceId: string;
  type: CommandType;
  payload?: Record<string, any>;
}

@Controller()
export class CommandsController {
  constructor(
    private readonly commandsService: CommandsService,
    private readonly appsService: AppsService,
  ) {}

  // ─── Management API (tenant-scoped) ───────────────────────────

  @Post('tenants/:tenantId/commands')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateCommandBody,
    @Request() req: any,
  ): Promise<Command> {
    return this.commandsService.create(tenantId, {
      ...dto,
      createdBy: req.user?.id ?? 'system',
    });
  }

  @Get('tenants/:tenantId/commands')
  findAll(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('deviceId') deviceId?: string,
  ): Promise<Command[]> {
    return this.commandsService.findAll(tenantId, deviceId);
  }

  @Get('tenants/:tenantId/commands/:id')
  findOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Command> {
    return this.commandsService.findOne(tenantId, id);
  }

  @Patch('tenants/:tenantId/commands/:id/cancel')
  cancel(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Command> {
    return this.commandsService.cancel(tenantId, id);
  }

  @Post('tenants/:tenantId/commands/:id/retry')
  @HttpCode(HttpStatus.CREATED)
  retry(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Command> {
    return this.commandsService.retryFailed(tenantId, id);
  }

  // ─── Device Agent API (token-based) ──────────────────────────

  /** Android agent polls for pending commands. Header: X-Device-Token */
  @Public()
  @Get('device/commands/pending')
  getPending(@Headers('x-device-token') token: string): Promise<Command[]> {
    if (!token) throw new UnauthorizedException('X-Device-Token header is required');
    return this.commandsService.getPendingForDevice(token);
  }

  /** Android agent syncs installed app list on enrollment. Header: X-Device-Token */
  @Public()
  @Post('device/apps/sync')
  @HttpCode(HttpStatus.NO_CONTENT)
  async syncApps(
    @Headers('x-device-token') token: string,
    @Body() body: SyncAppsBodyDto,
  ): Promise<void> {
    if (!token) throw new UnauthorizedException('X-Device-Token header is required');
    const device = await this.commandsService.resolveDeviceByToken(token);
    await this.appsService.syncFromDevice(device.tenantId, body.apps ?? []);
  }

  /** Android agent reports in-progress status for long-running commands. Header: X-Device-Token */
  @Public()
  @Patch('device/commands/:id/progress')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reportProgress(
    @Headers('x-device-token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { progress: number; message: string; screenshotUrl?: string },
  ): Promise<void> {
    if (!token) throw new UnauthorizedException('X-Device-Token header is required');
    await this.commandsService.updateCommandProgress(token, id, body.progress, body.message, body.screenshotUrl);
  }

  /** Android agent uploads a screenshot for a command. Header: X-Device-Token */
  @Public()
  @Post('device/commands/:id/screenshot')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'screenshots');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          cb(null, `${randomUUID()}${extname(file.originalname) || '.png'}`);
        },
      }),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async uploadScreenshot(
    @Headers('x-device-token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ screenshotUrl: string }> {
    if (!token) throw new UnauthorizedException('X-Device-Token header is required');
    const screenshotUrl = `/uploads/screenshots/${file.filename}`;
    await this.commandsService.updateCommandProgress(token, id, 90, 'Screenshot capturado', screenshotUrl);
    return { screenshotUrl };
  }

  /** Android agent ACKs command. Header: X-Device-Token */
  @Public()
  @Patch('device/commands/:id/ack')
  ackCommand(
    @Headers('x-device-token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AckCommandDto,
  ): Promise<Command> {
    if (!token) throw new UnauthorizedException('X-Device-Token header is required');
    return this.commandsService.acknowledgeCommand(token, id, dto);
  }
}
