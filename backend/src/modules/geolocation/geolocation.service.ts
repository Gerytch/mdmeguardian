import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Location } from './entities/location.entity';
import { Device } from '../devices/entities/device.entity';

export interface RecordLocationDto {
  deviceId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  speed?: number;
  timestamp?: string;
}

@Injectable()
export class GeolocationService {
  constructor(
    @InjectRepository(Location)
    private readonly locationRepository: Repository<Location>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
  ) {}

  /** Haversine distance in meters */
  private haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async recordLocation(tenantId: string, dto: RecordLocationDto): Promise<Location> {
    const device = await this.deviceRepository.findOne({ where: { id: dto.deviceId, tenantId } });
    if (!device) throw new NotFoundException(`Device "${dto.deviceId}" not found`);

    if (dto.latitude < -90 || dto.latitude > 90)
      throw new BadRequestException('latitude must be between -90 and 90');
    if (dto.longitude < -180 || dto.longitude > 180)
      throw new BadRequestException('longitude must be between -180 and 180');

    const location = this.locationRepository.create({
      tenantId,
      deviceId: dto.deviceId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracy ?? null,
      altitude: dto.altitude ?? null,
      speed: dto.speed ?? null,
      timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      isGeofenceAlert: false,
      geofenceZoneId: null,
    });

    device.lastSeenAt = new Date();
    await this.deviceRepository.save(device);

    return this.locationRepository.save(location);
  }

  async getDeviceHistory(
    tenantId: string,
    deviceId: string,
    fromDate?: Date,
    toDate?: Date,
    limit = 500,
  ): Promise<Location[]> {
    const device = await this.deviceRepository.findOne({ where: { id: deviceId, tenantId } });
    if (!device) throw new NotFoundException(`Device "${deviceId}" not found`);

    const qb = this.locationRepository
      .createQueryBuilder('loc')
      .where('loc.tenantId = :tenantId', { tenantId })
      .andWhere('loc.deviceId = :deviceId', { deviceId })
      .orderBy('loc.timestamp', 'DESC')
      .take(Math.min(limit, 5000));

    if (fromDate) qb.andWhere('loc.timestamp >= :fromDate', { fromDate });
    if (toDate) qb.andWhere('loc.timestamp <= :toDate', { toDate });

    return qb.getMany();
  }

  async getLatestLocation(tenantId: string, deviceId: string): Promise<Location | null> {
    const device = await this.deviceRepository.findOne({ where: { id: deviceId, tenantId } });
    if (!device) throw new NotFoundException(`Device "${deviceId}" not found`);
    return this.locationRepository.findOne({
      where: { tenantId, deviceId },
      order: { timestamp: 'DESC' },
    });
  }

  async getAllDevicesLatestLocations(tenantId: string): Promise<Location[]> {
    // DISTINCT ON guarantees exactly one row per device (the most recent by timestamp).
    // The previous MAX+JOIN approach returned duplicate rows when two records shared the same timestamp.
    return this.locationRepository
      .createQueryBuilder('loc')
      .distinctOn(['loc.deviceId'])
      .leftJoinAndSelect('loc.device', 'device')
      .where('loc.tenantId = :tenantId', { tenantId })
      .orderBy('loc.deviceId')
      .addOrderBy('loc.timestamp', 'DESC')
      .setParameter('tenantId', tenantId)
      .getMany();
  }

  async getGeofenceAlerts(tenantId: string, since?: Date): Promise<Location[]> {
    const where: any = { tenantId, isGeofenceAlert: true };
    if (since) where.timestamp = MoreThanOrEqual(since);
    return this.locationRepository.find({
      where,
      relations: ['device'],
      order: { timestamp: 'DESC' },
      take: 1000,
    });
  }
}
