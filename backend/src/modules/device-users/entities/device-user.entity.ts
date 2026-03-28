import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, Unique } from 'typeorm'
import { Tenant } from '../../tenants/entities/tenant.entity'

export enum DeviceUserStatus { ACTIVE = 'ACTIVE', INACTIVE = 'INACTIVE' }

@Entity('device_users')
@Unique(['tenantId', 'username'])
export class DeviceUser {
  @PrimaryGeneratedColumn('uuid') id: string
  @Index() @Column({ type: 'uuid' }) tenantId: string
  @ManyToOne(() => Tenant, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'tenantId' }) tenant: Tenant
  @Column({ type: 'varchar', length: 100 }) username: string
  @Column({ type: 'varchar', length: 255 }) fullName: string
  @Column({ type: 'varchar', length: 255, select: false }) pinHash: string
  @Column({ type: 'varchar', length: 100, nullable: true }) department: string | null
  @Column({ type: 'varchar', length: 100, nullable: true }) jobTitle: string | null
  @Column({ type: 'varchar', length: 512, nullable: true }) photoUrl: string | null
  @Column({ type: 'enum', enum: DeviceUserStatus, default: DeviceUserStatus.ACTIVE }) status: DeviceUserStatus
  @Column({ type: 'timestamptz', nullable: true }) lastLoginAt: Date | null
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date
  @UpdateDateColumn({ type: 'timestamptz' }) updatedAt: Date
}
