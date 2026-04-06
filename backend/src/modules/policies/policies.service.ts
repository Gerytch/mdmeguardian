import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { Policy, PolicyRules } from './entities/policy.entity';
import { Device } from '../devices/entities/device.entity';
import { Command, CommandStatus, CommandType } from '../commands/entities/command.entity';
import { App } from '../apps/entities/app.entity';

export interface CreatePolicyDto {
  name: string;
  description?: string;
  rules?: Partial<PolicyRules>;
  isDefault?: boolean;
  requiredAppIds?: string[];
}

export interface UpdatePolicyDto {
  name?: string;
  description?: string;
  rules?: Partial<PolicyRules>;
  isDefault?: boolean;
  requiredAppIds?: string[];
  /** packageNames of apps removed from requiredAppIds — used as fallback when catalog record is gone */
  removedPackageNames?: string[];
}

@Injectable()
export class PoliciesService {
  constructor(
    @InjectRepository(Policy)
    private readonly policyRepository: Repository<Policy>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectRepository(Command)
    private readonly commandRepository: Repository<Command>,
    @InjectRepository(App)
    private readonly appRepository: Repository<App>,
  ) {}

  async create(tenantId: string, dto: CreatePolicyDto): Promise<Policy> {
    if (dto.isDefault) {
      await this.policyRepository.update({ tenantId, isDefault: true }, { isDefault: false });
    }

    const policy = this.policyRepository.create({
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
      rules: {
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
        ...dto.rules,
      },
      requiredAppIds: dto.requiredAppIds ?? [],
      isDefault: dto.isDefault ?? false,
    });

    return this.policyRepository.save(policy);
  }

  async findAll(tenantId: string): Promise<Policy[]> {
    return this.policyRepository.find({
      where: { tenantId },
      order: { isDefault: 'DESC', name: 'ASC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Policy> {
    const policy = await this.policyRepository.findOne({ where: { id, tenantId } });
    if (!policy) throw new NotFoundException(`Policy "${id}" not found`);
    return policy;
  }

  async findDefault(tenantId: string): Promise<Policy | null> {
    return this.policyRepository.findOne({ where: { tenantId, isDefault: true } });
  }

  async update(tenantId: string, id: string, dto: UpdatePolicyDto): Promise<Policy> {
    const policy = await this.findOne(tenantId, id);

    if (dto.isDefault && !policy.isDefault) {
      await this.policyRepository.update({ tenantId, isDefault: true, id: Not(id) }, { isDefault: false });
    }

    // Detect removed required apps before updating
    const removedAppIds = dto.requiredAppIds !== undefined
      ? (policy.requiredAppIds ?? []).filter(appId => !dto.requiredAppIds!.includes(appId))
      : [];

    if (dto.name !== undefined) policy.name = dto.name;
    if (dto.description !== undefined) policy.description = dto.description;
    if (dto.isDefault !== undefined) policy.isDefault = dto.isDefault;
    if (dto.rules !== undefined) policy.rules = { ...policy.rules, ...dto.rules };
    if (dto.requiredAppIds !== undefined) policy.requiredAppIds = dto.requiredAppIds;

    const saved = await this.policyRepository.save(policy);

    // Propagate UPDATE_POLICY to all assigned devices
    await this.propagatePolicyUpdate(tenantId, id, saved);

    // Queue UNINSTALL_APP for each removed required app on all assigned devices
    if (removedAppIds.length > 0) {
      await this.propagateUninstall(tenantId, id, removedAppIds);
    }

    return saved;
  }

  private async propagateUninstall(tenantId: string, policyId: string, removedAppIds: string[]): Promise<void> {
    const [devices, apps] = await Promise.all([
      this.deviceRepository.find({ where: { tenantId, policyId }, select: ['id'] }),
      this.appRepository.findBy({ id: In(removedAppIds) }),
    ]);
    if (devices.length === 0 || apps.length === 0) return;

    const commands: Command[] = [];
    for (const device of devices) {
      for (const app of apps) {
        commands.push(
          this.commandRepository.create({
            tenantId,
            deviceId: device.id,
            type: CommandType.UNINSTALL_APP,
            payload: { packageName: app.packageName, appName: app.name },
            status: CommandStatus.PENDING,
            createdBy: 'system',
          }),
        );
      }
    }
    await this.commandRepository.save(commands);
  }

  private async buildPolicyPayload(policy: Policy): Promise<Record<string, any>> {
    let requiredApps: any[] = [];
    if (policy.requiredAppIds?.length) {
      const apps = await this.appRepository.findBy({ id: In(policy.requiredAppIds) });
      requiredApps = apps.map(a => ({
        id: a.id,
        name: a.name,
        packageName: a.packageName,
        version: a.version,
        apkUrl: a.apkUrl,
      }));
    }
    return { policyId: policy.id, rules: policy.rules, requiredApps };
  }

  private async propagatePolicyUpdate(tenantId: string, policyId: string, policy: Policy): Promise<void> {
    const devices = await this.deviceRepository.find({
      where: { tenantId, policyId },
      select: ['id'],
    });
    if (devices.length === 0) return;

    const payload = await this.buildPolicyPayload(policy);

    const commands = devices.map((device) =>
      this.commandRepository.create({
        tenantId,
        deviceId: device.id,
        type: CommandType.UPDATE_POLICY,
        payload,
        status: CommandStatus.PENDING,
        createdBy: 'system',
      }),
    );

    await this.commandRepository.save(commands);
  }

  async assignToDevice(tenantId: string, policyId: string, deviceId: string): Promise<void> {
    await this.findOne(tenantId, policyId);
    const device = await this.deviceRepository.findOne({ where: { id: deviceId, tenantId } });
    if (!device) throw new NotFoundException(`Device "${deviceId}" not found`);

    device.policyId = policyId;
    await this.deviceRepository.save(device);

    const policy = await this.findOne(tenantId, policyId);
    const payload = await this.buildPolicyPayload(policy);
    await this.commandRepository.save(
      this.commandRepository.create({
        tenantId,
        deviceId,
        type: CommandType.UPDATE_POLICY,
        payload,
        status: CommandStatus.PENDING,
        createdBy: 'system',
      }),
    );

    // If the target policy is currently in admin lock, lock the newly assigned device too
    await this.syncAdminLockForNewDevice(tenantId, policyId, deviceId);
  }

  /** Sync admin lock state when a device is assigned to a new policy.
   *  - New policy locked → send ADMIN_LOCK with same payload
   *  - New policy unlocked but device is locked → send ADMIN_UNLOCK */
  private async syncAdminLockForNewDevice(
    tenantId: string,
    policyId: string,
    deviceId: string,
  ): Promise<void> {
    // Determine new policy lock state from peers
    const peers = await this.deviceRepository.find({
      where: { tenantId, policyId },
      select: ['id'],
    });
    const peerIds = peers.map((d) => d.id).filter((pid) => pid !== deviceId);

    let newPolicyIsLocked = false;
    let lockPayload: Record<string, any> = {};

    if (peerIds.length > 0) {
      const peerLastLock = await this.commandRepository.findOne({
        where: { deviceId: In(peerIds), type: CommandType.ADMIN_LOCK },
        order: { createdAt: 'DESC' },
      });
      if (peerLastLock) {
        const peerLastUnlock = await this.commandRepository.findOne({
          where: { deviceId: In(peerIds), type: CommandType.ADMIN_UNLOCK },
          order: { createdAt: 'DESC' },
        });
        newPolicyIsLocked = !peerLastUnlock || peerLastLock.createdAt > peerLastUnlock.createdAt;
        lockPayload = peerLastLock.payload;
      }
    }

    if (newPolicyIsLocked) {
      await this.commandRepository.save(
        this.commandRepository.create({
          tenantId, deviceId,
          type: CommandType.ADMIN_LOCK,
          payload: lockPayload,
          status: CommandStatus.PENDING,
          createdBy: 'system',
        }),
      );
      return;
    }

    // New policy is not locked — unlock the device if it's currently locked
    const deviceLastLock = await this.commandRepository.findOne({
      where: { deviceId, type: CommandType.ADMIN_LOCK },
      order: { createdAt: 'DESC' },
    });
    if (!deviceLastLock) return;

    const deviceLastUnlock = await this.commandRepository.findOne({
      where: { deviceId, type: CommandType.ADMIN_UNLOCK },
      order: { createdAt: 'DESC' },
    });
    const deviceIsLocked = !deviceLastUnlock || deviceLastLock.createdAt > deviceLastUnlock.createdAt;
    if (!deviceIsLocked) return;

    await this.commandRepository.save(
      this.commandRepository.create({
        tenantId, deviceId,
        type: CommandType.ADMIN_UNLOCK,
        payload: {},
        status: CommandStatus.PENDING,
        createdBy: 'system',
      }),
    );
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const policy = await this.findOne(tenantId, id);

    // Reset all devices that were assigned to this policy before deleting it
    const affectedDevices = await this.deviceRepository.find({
      where: { tenantId, policyId: id },
      select: ['id'],
    });
    for (const device of affectedDevices) {
      await this.clearPolicyForDevice(tenantId, device.id);
    }

    await this.deviceRepository.update({ tenantId, policyId: id }, { policyId: null });
    await this.policyRepository.remove(policy);
  }

  /** Send ADMIN_UNLOCK (if locked) + UPDATE_POLICY with empty rules when a device loses its policy. */
  private async clearPolicyForDevice(tenantId: string, deviceId: string): Promise<void> {
    const commands: any[] = [];

    const lastLock = await this.commandRepository.findOne({
      where: { deviceId, type: CommandType.ADMIN_LOCK },
      order: { createdAt: 'DESC' },
    });
    if (lastLock) {
      const lastUnlock = await this.commandRepository.findOne({
        where: { deviceId, type: CommandType.ADMIN_UNLOCK },
        order: { createdAt: 'DESC' },
      });
      if (!lastUnlock || lastLock.createdAt > lastUnlock.createdAt) {
        commands.push(this.commandRepository.create({
          tenantId, deviceId,
          type: CommandType.ADMIN_UNLOCK,
          payload: {},
          status: CommandStatus.PENDING,
          createdBy: 'system',
        }));
      }
    }

    commands.push(this.commandRepository.create({
      tenantId, deviceId,
      type: CommandType.UPDATE_POLICY,
      payload: { policyId: null, rules: {} },
      status: CommandStatus.PENDING,
      createdBy: 'system',
    }));

    await this.commandRepository.save(commands);
  }
}
