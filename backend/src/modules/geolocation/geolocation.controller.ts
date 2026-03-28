import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { GeolocationService, RecordLocationDto } from './geolocation.service';
import { Location } from './entities/location.entity';
import { Public } from '../../common/decorators/public.decorator';

@Controller('tenants/:tenantId/geolocation')
export class GeolocationController {
  constructor(private readonly geolocationService: GeolocationService) {}

  /** Device posts its location */
  @Public()
  @Post()
  @HttpCode(HttpStatus.CREATED)
  recordLocation(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: RecordLocationDto,
  ): Promise<Location> {
    return this.geolocationService.recordLocation(tenantId, dto);
  }

  /** Latest location for every device (map overview) */
  @Get('latest')
  getAllLatest(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<Location[]> {
    return this.geolocationService.getAllDevicesLatestLocations(tenantId);
  }

  /** Geofence violation alerts */
  @Get('alerts')
  getAlerts(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query('since') since?: string,
  ): Promise<Location[]> {
    return this.geolocationService.getGeofenceAlerts(tenantId, since ? new Date(since) : undefined);
  }

  /** Latest location for a specific device */
  @Get('devices/:deviceId/latest')
  getLatest(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ): Promise<Location | null> {
    return this.geolocationService.getLatestLocation(tenantId, deviceId);
  }

  /** Location history for a device */
  @Get('devices/:deviceId/history')
  getHistory(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit?: number,
  ): Promise<Location[]> {
    return this.geolocationService.getDeviceHistory(
      tenantId,
      deviceId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      limit,
    );
  }
}
