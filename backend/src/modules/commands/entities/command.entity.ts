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
import { Device } from '../../devices/entities/device.entity';

export enum CommandType {
  LOCK = 'LOCK',
  UNLOCK = 'UNLOCK',
  WIPE = 'WIPE',
  REBOOT = 'REBOOT',
  INSTALL_APP = 'INSTALL_APP',
  UNINSTALL_APP = 'UNINSTALL_APP',
  UPDATE_POLICY = 'UPDATE_POLICY',
  ENABLE_KIOSK = 'ENABLE_KIOSK',
  DISABLE_KIOSK = 'DISABLE_KIOSK',
  LOCATE = 'LOCATE',
  ADMIN_LOCK = 'ADMIN_LOCK',
  ADMIN_UNLOCK = 'ADMIN_UNLOCK',
  SEND_MESSAGE = 'SEND_MESSAGE',
  GET_APPS = 'GET_APPS',
  NETWORK_TEST = 'NETWORK_TEST',
  UPDATE_AGENT = 'UPDATE_AGENT',
  UNINSTALL_AGENT = 'UNINSTALL_AGENT',
  RENAME_DEVICE = 'RENAME_DEVICE',
  FACTORY_RESET = 'FACTORY_RESET',
}

export enum CommandStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  EXECUTING = 'EXECUTING',
  EXECUTED = 'EXECUTED',
  FAILED = 'FAILED',
}

@Entity('commands')
@Index(['tenantId', 'deviceId', 'status'])
export class Command {
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

  @Column({ type: 'enum', enum: CommandType })
  type: CommandType;

  @Column({ type: 'jsonb', nullable: true, default: () => "'{}'::jsonb" })
  payload: Record<string, any>;

  @Column({ type: 'enum', enum: CommandStatus, default: CommandStatus.PENDING })
  status: CommandStatus;

  /** User id (UUID) or 'system' for auto-generated commands */
  @Column({ type: 'varchar', length: 36 })
  createdBy: string;

  @Column({ type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  result: Record<string, any> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
