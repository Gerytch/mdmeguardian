import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { Device } from '../../devices/entities/device.entity';

@Entity('locations')
@Index(['tenantId', 'deviceId', 'timestamp'])
export class Location {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @Index()
  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @Column({ type: 'double precision' })
  latitude: number;

  @Column({ type: 'double precision' })
  longitude: number;

  @Column({ type: 'float', nullable: true })
  accuracy: number | null;

  @Column({ type: 'float', nullable: true })
  altitude: number | null;

  @Column({ type: 'float', nullable: true })
  speed: number | null;

  @Column({ type: 'timestamptz' })
  timestamp: Date;

  @Column({ type: 'boolean', default: false })
  isGeofenceAlert: boolean;

  @Column({ type: 'uuid', nullable: true })
  geofenceZoneId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
