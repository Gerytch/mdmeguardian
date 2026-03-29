import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
  Request,
} from '@nestjs/common';
import { IsEnum, IsObject, IsOptional } from 'class-validator';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto, EnrollDeviceDto } from './dto/register-device.dto';
import { UpdateDeviceDto, DeviceHeartbeatDto } from './dto/update-device.dto';
import { CommandType } from '../commands/entities/command.entity';
import { DeviceStatus } from './entities/device.entity';
import { Public } from '../../common/decorators/public.decorator';

class SendCommandDto {
  @IsEnum(CommandType)
  type: CommandType;

  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

@Controller('tenants/:tenantId/devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  register(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.devicesService.register(tenantId, dto);
  }

  @Get()
  findAll(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.devicesService.findAll(tenantId);
  }

  @Get('online')
  getOnline(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.devicesService.getOnlineDevices(tenantId);
  }

  @Get(':id')
  findOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.devicesService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceDto,
  ) {
    return this.devicesService.update(tenantId, id, dto);
  }

  @Patch(':id/heartbeat')
  heartbeat(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeviceHeartbeatDto,
  ) {
    return this.devicesService.heartbeat(tenantId, id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body('status') status: DeviceStatus,
  ) {
    return this.devicesService.updateDeviceStatus(tenantId, id, status);
  }

  @Post(':id/commands')
  @HttpCode(HttpStatus.CREATED)
  sendCommand(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendCommandDto,
    @Request() req: any,
  ) {
    return this.devicesService.sendCommand(tenantId, id, dto.type, dto.payload ?? {}, req.user?.id ?? 'system');
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.devicesService.remove(tenantId, id);
  }

  // ─── QR Enrollment ─────────────────────────────────────────────────────────

  /** Admin generates a QR enrollment token (1h, single-use) */
  @Post('enrollment-token')
  @HttpCode(HttpStatus.CREATED)
  generateEnrollmentToken(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('policyId') policyId?: string,
  ) {
    return this.devicesService.generateEnrollmentToken(tenantId, policyId);
  }

  /** Android agent calls this after scanning the QR — no JWT required */
  @Public()
  @Post('enroll')
  @HttpCode(HttpStatus.CREATED)
  enrollWithToken(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: EnrollDeviceDto,
  ) {
    const { enrollmentToken, ...deviceDto } = dto;
    return this.devicesService.enrollWithToken(tenantId, enrollmentToken, deviceDto);
  }
}
