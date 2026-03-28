import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { DeviceUsersService } from './device-users.service'
import { CreateDeviceUserDto, UpdateDeviceUserDto, UpdatePinDto, UpdateDeviceUserStatusDto } from './dto/device-user.dto'
import { DeviceUserStatus } from './entities/device-user.entity'

@Controller('tenants/:tenantId/device-users')
export class DeviceUsersController {
  constructor(private readonly deviceUsersService: DeviceUsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: CreateDeviceUserDto,
  ) {
    return this.deviceUsersService.create(tenantId, dto)
  }

  @Get()
  findAll(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('department') department?: string,
    @Query('status') status?: DeviceUserStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.deviceUsersService.findAll(tenantId, { department, status, page, limit })
  }

  @Get(':id')
  findOne(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.deviceUsersService.findOne(tenantId, id)
  }

  @Patch(':id')
  update(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceUserDto,
  ) {
    return this.deviceUsersService.update(tenantId, id, dto)
  }

  @Patch(':id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  updatePin(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePinDto,
  ): Promise<void> {
    return this.deviceUsersService.updatePin(tenantId, id, dto.pin)
  }

  @Patch(':id/status')
  updateStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDeviceUserStatusDto,
  ) {
    return this.deviceUsersService.updateStatus(tenantId, id, dto.status)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.deviceUsersService.remove(tenantId, id)
  }
}
