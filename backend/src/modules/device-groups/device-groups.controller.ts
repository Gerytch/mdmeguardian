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
} from '@nestjs/common';
import {
  DeviceGroupsService,
  CreateDeviceGroupDto,
  UpdateDeviceGroupDto,
} from './device-groups.service';

@Controller('tenants/:tenantId/device-groups')
export class DeviceGroupsController {
  constructor(private readonly deviceGroupsService: DeviceGroupsService) {}

  @Get()
  findAll(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.deviceGroupsService.findAll(tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateDeviceGroupDto,
  ) {
    return this.deviceGroupsService.create(tenantId, dto);
  }

  @Get(':id')
  findOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deviceGroupsService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceGroupDto,
  ) {
    return this.deviceGroupsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deviceGroupsService.remove(tenantId, id);
  }

  @Patch(':id/assign-policy/:policyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  assignPolicy(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('policyId', ParseUUIDPipe) policyId: string,
  ): Promise<void> {
    return this.deviceGroupsService.assignPolicy(tenantId, id, policyId);
  }

  @Delete(':id/policy')
  @HttpCode(HttpStatus.NO_CONTENT)
  removePolicy(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deviceGroupsService.removePolicy(tenantId, id);
  }

  @Patch(':id/devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  addDevice(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    return this.deviceGroupsService.addDevice(tenantId, id, deviceId);
  }

  @Delete(':id/devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDevice(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    return this.deviceGroupsService.removeDevice(tenantId, id, deviceId);
  }
}
