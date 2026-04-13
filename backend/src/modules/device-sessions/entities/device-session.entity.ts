import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm'
import { Tenant } from '../../tenants/entities/tenant.entity'
import { Device } from '../../devices/entities/device.entity'
import { DeviceUser } from '../../device-users/entities/device-user.entity'

export enum DeviceSessionStatus { ACTIVE = 'ACTIVE', CLOSED = 'CLOSED', TIMEOUT = 'TIMEOUT', INTERRUPTED = 'INTERRUPTED' }

@Entity('device_sessions')
export class DeviceSession {
  @PrimaryGeneratedColumn('uuid') id: string
  @Index() @Column({ type: 'uuid' }) tenantId: string
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'tenantId' }) tenant: Tenant
  @Index() @Column({ type: 'uuid' }) deviceId: string
  @ManyToOne(() => Device, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'deviceId' }) device: Device
  @Index() @Column({ type: 'uuid' }) deviceUserId: string
  @ManyToOne(() => DeviceUser, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'deviceUserId' }) deviceUser: DeviceUser
  @Column({ type: 'timestamptz', default: () => 'NOW()' }) startedAt: Date
  @Column({ type: 'timestamptz', nullable: true }) endedAt: Date | null
  @Column({ type: 'enum', enum: DeviceSessionStatus, default: DeviceSessionStatus.ACTIVE }) status: DeviceSessionStatus
  @Column({ type: 'varchar', length: 50, nullable: true }) endedReason: string | null
  @Column({ type: 'boolean', default: false }) isOffline: boolean
  @Column({ type: 'varchar', length: 36, nullable: true, unique: true }) offlineSessionId: string | null
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date
}
