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
import { PoliciesService, CreatePolicyDto, UpdatePolicyDto } from './policies.service';
import { Policy } from './entities/policy.entity';

@Controller('tenants/:tenantId/policies')
export class PoliciesController {
  constructor(private readonly policiesService: PoliciesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreatePolicyDto,
  ): Promise<Policy> {
    return this.policiesService.create(tenantId, dto);
  }

  @Get()
  findAll(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<Policy[]> {
    return this.policiesService.findAll(tenantId);
  }

  @Get('default')
  findDefault(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<Policy | null> {
    return this.policiesService.findDefault(tenantId);
  }

  @Get(':id')
  findOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Policy> {
    return this.policiesService.findOne(tenantId, id);
  }

  @Patch(':id')
  update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePolicyDto,
  ): Promise<Policy> {
    return this.policiesService.update(tenantId, id, dto);
  }

  @Patch(':id/assign/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  assignToDevice(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ): Promise<void> {
    return this.policiesService.assignToDevice(tenantId, id, deviceId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.policiesService.remove(tenantId, id);
  }
}
