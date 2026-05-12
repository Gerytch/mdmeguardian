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

export interface PolicyRules {
  kioskMode: boolean;
  kioskModeType: 'whitelist' | 'blacklist';
  kioskApps: string[];
  passwordRequired: boolean;
  minPasswordLength?: number;
  maxFailedAttempts?: number;
  locationTracking: boolean;
  trackingIntervalMinutes: number;
  wifiOnly: boolean;
  screenshotBlocked: boolean;
  cameraBlocked: boolean;
  usbBlocked: boolean;
  factoryResetBlocked: boolean;
  screenTimeoutSeconds?: number;
  deviceUserAuthRequired?: boolean;
  inactivityTimeoutMinutes?: number;
}

const DEFAULT_RULES: PolicyRules = {
  kioskMode: false,
  kioskModeType: 'whitelist',
  kioskApps: [],
  passwordRequired: false,
  locationTracking: false,
  trackingIntervalMinutes: 5,
  wifiOnly: false,
  screenshotBlocked: false,
  cameraBlocked: false,
  usbBlocked: false,
  factoryResetBlocked: true,
  screenTimeoutSeconds: 60,
  deviceUserAuthRequired: false,
  inactivityTimeoutMinutes: 5,
};

@Entity('policies')
export class Policy {
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

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'jsonb', default: () => `'${JSON.stringify(DEFAULT_RULES)}'::jsonb` })
  rules: PolicyRules;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  requiredAppIds: string[];

  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
