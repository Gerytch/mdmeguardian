import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Tenant } from '../../tenants/entities/tenant.entity';
import { User } from '../../users/entities/user.entity';

export enum DeviceStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  LOST = 'LOST',
  WIPED = 'WIPED',
}

@Entity('devices')
@Index(['tenantId', 'serialNumber'], { unique: true })
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  tenantId: string;

  @ManyToOne(() => Tenant, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  serialNumber: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  imei: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  androidVersion: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  manufacturer: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  model: string | null;

  @Column({ type: 'enum', enum: DeviceStatus, default: DeviceStatus.PENDING })
  status: DeviceStatus;

  @Column({ type: 'timestamptz', nullable: true })
  enrollmentDate: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  currentUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'currentUserId' })
  currentUser: User | null;

  @Column({ type: 'uuid', nullable: true })
  policyId: string | null;

  @Column({ type: 'uuid', nullable: true })
  groupId: string | null;

  @Column({ type: 'boolean', default: false })
  isKioskMode: boolean;

  @Column({ type: 'jsonb', nullable: true, default: () => "'[]'::jsonb" })
  kioskApps: string[];

  @Column({ type: 'varchar', length: 20, nullable: true })
  osVersion: string | null;

  @Column({ type: 'smallint', nullable: true })
  batteryLevel: number | null;

  @Column({ type: 'boolean', default: false })
  isOnline: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true })
  agentVersion: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true, select: false })
  deviceToken: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
