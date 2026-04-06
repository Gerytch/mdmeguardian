import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DeviceGroup } from './entities/device-group.entity';
import { Device } from '../devices/entities/device.entity';
import { Command, CommandStatus, CommandType } from '../commands/entities/command.entity';
import { Policy } from '../policies/entities/policy.entity';

export interface CreateDeviceGroupDto {
  name: string;
  description?: string;
}

export interface UpdateDeviceGroupDto {
  name?: string;
  description?: string;
}

@Injectable()
export class DeviceGroupsService {
  constructor(
    @InjectRepository(DeviceGroup)
    private readonly groupRepo: Repository<DeviceGroup>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Command)
    private readonly commandRepo: Repository<Command>,
    @InjectRepository(Policy)
    private readonly policyRepo: Repository<Policy>,
  ) {}

  async create(tenantId: string, dto: CreateDeviceGroupDto): Promise<DeviceGroup> {
    const group = this.groupRepo.create({
      tenantId,
      name: dto.name,
      description: dto.description ?? null,
      policyId: null,
    });
    return this.groupRepo.save(group);
  }

  async findAll(tenantId: string): Promise<(DeviceGroup & { deviceCount: number })[]> {
    const groups = await this.groupRepo.find({
      where: { tenantId },
      order: { name: 'ASC' },
    });

    const counts = await this.deviceRepo
      .createQueryBuilder('d')
      .select('d.groupId', 'groupId')
      .addSelect('COUNT(*)', 'count')
      .where('d.tenantId = :tenantId AND d.groupId IS NOT NULL', { tenantId })
      .groupBy('d.groupId')
      .getRawMany();

    const countMap = Object.fromEntries(
      counts.map((c) => [c.groupId, parseInt(c.count, 10)]),
    );

    return groups.map((g) => ({ ...g, deviceCount: countMap[g.id] ?? 0 }));
  }

  async findOne(
    tenantId: string,
    id: string,
  ): Promise<DeviceGroup & { devices: Partial<Device>[] }> {
    const group = await this.groupRepo.findOne({ where: { id, tenantId } });
    if (!group) throw new NotFoundException(`Device group "${id}" not found`);

    const devices = await this.deviceRepo.find({
      where: { tenantId, groupId: id },
      select: ['id', 'name', 'status', 'isOnline', 'manufacturer', 'model'],
    });

    return { ...group, devices };
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateDeviceGroupDto,
  ): Promise<DeviceGroup> {
    const group = await this.groupRepo.findOne({ where: { id, tenantId } });
    if (!group) throw new NotFoundException(`Device group "${id}" not found`);

    if (dto.name !== undefined) group.name = dto.name;
    if (dto.description !== undefined) group.description = dto.description;

    return this.groupRepo.save(group);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id, tenantId } });
    if (!group) throw new NotFoundException(`Device group "${id}" not found`);

    await this.deviceRepo.update({ tenantId, groupId: id }, { groupId: null });
    await this.groupRepo.remove(group);
  }

  async assignPolicy(
    tenantId: string,
    groupId: string,
    policyId: string,
  ): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId, tenantId } });
    if (!group) throw new NotFoundException(`Device group "${groupId}" not found`);

    const policy = await this.policyRepo.findOne({ where: { id: policyId, tenantId } });
    if (!policy) throw new NotFoundException(`Policy "${policyId}" not found`);

    group.policyId = policyId;
    await this.groupRepo.save(group);

    await this.deviceRepo.update({ tenantId, groupId }, { policyId });

    const devices = await this.deviceRepo.find({
      where: { tenantId, groupId },
      select: ['id'],
    });

    if (devices.length > 0) {
      const commands = devices.map((d) =>
        this.commandRepo.create({
          tenantId,
          deviceId: d.id,
          type: CommandType.UPDATE_POLICY,
          payload: { policyId: policy.id, rules: policy.rules },
          status: CommandStatus.PENDING,
          createdBy: 'system',
        }),
      );
      await this.commandRepo.save(commands);
    }
  }

  async removePolicy(tenantId: string, groupId: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId, tenantId } });
    if (!group) throw new NotFoundException(`Device group "${groupId}" not found`);

    group.policyId = null;
    await this.groupRepo.save(group);
  }

  async addDevice(
    tenantId: string,
    groupId: string,
    deviceId: string,
  ): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId, tenantId } });
    if (!group) throw new NotFoundException(`Device group "${groupId}" not found`);

    const device = await this.deviceRepo.findOne({ where: { id: deviceId, tenantId } });
    if (!device) throw new NotFoundException(`Device "${deviceId}" not found`);

    device.groupId = groupId;

    if (group.policyId) {
      const policy = await this.policyRepo.findOne({
        where: { id: group.policyId, tenantId },
      });

      if (policy) {
        device.policyId = policy.id;
        await this.deviceRepo.save(device);

        await this.commandRepo.save(
          this.commandRepo.create({
            tenantId,
            deviceId: device.id,
            type: CommandType.UPDATE_POLICY,
            payload: { policyId: policy.id, rules: policy.rules },
            status: CommandStatus.PENDING,
            createdBy: 'system',
          }),
        );

        // If the target policy is currently in admin lock, lock the newly added device too
        await this.syncAdminLockForNewDevice(tenantId, policy.id, device.id);
        return;
      }
    }

    await this.deviceRepo.save(device);
  }

  /** Sync admin lock state when a device is added to a group with a policy.
   *  - New policy locked → send ADMIN_LOCK with same payload
   *  - New policy unlocked but device is locked → send ADMIN_UNLOCK */
  private async syncAdminLockForNewDevice(
    tenantId: string,
    policyId: string,
    deviceId: string,
  ): Promise<void> {
    // Determine new policy lock state from peers
    const peers = await this.deviceRepo.find({
      where: { tenantId, policyId },
      select: ['id'],
    });
    const peerIds = peers.map((d) => d.id).filter((pid) => pid !== deviceId);

    let newPolicyIsLocked = false;
    let lockPayload: Record<string, any> = {};

    if (peerIds.length > 0) {
      const peerLastLock = await this.commandRepo.findOne({
        where: { deviceId: In(peerIds), type: CommandType.ADMIN_LOCK },
        order: { createdAt: 'DESC' },
      });
      if (peerLastLock) {
        const peerLastUnlock = await this.commandRepo.findOne({
          where: { deviceId: In(peerIds), type: CommandType.ADMIN_UNLOCK },
          order: { createdAt: 'DESC' },
        });
        newPolicyIsLocked = !peerLastUnlock || peerLastLock.createdAt > peerLastUnlock.createdAt;
        lockPayload = peerLastLock.payload;
      }
    }

    if (newPolicyIsLocked) {
      await this.commandRepo.save(
        this.commandRepo.create({
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
    const deviceLastLock = await this.commandRepo.findOne({
      where: { deviceId, type: CommandType.ADMIN_LOCK },
      order: { createdAt: 'DESC' },
    });
    if (!deviceLastLock) return;

    const deviceLastUnlock = await this.commandRepo.findOne({
      where: { deviceId, type: CommandType.ADMIN_UNLOCK },
      order: { createdAt: 'DESC' },
    });
    const deviceIsLocked = !deviceLastUnlock || deviceLastLock.createdAt > deviceLastUnlock.createdAt;
    if (!deviceIsLocked) return;

    await this.commandRepo.save(
      this.commandRepo.create({
        tenantId, deviceId,
        type: CommandType.ADMIN_UNLOCK,
        payload: {},
        status: CommandStatus.PENDING,
        createdBy: 'system',
      }),
    );
  }

  async removeDevice(
    tenantId: string,
    groupId: string,
    deviceId: string,
  ): Promise<void> {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, tenantId, groupId },
    });
    if (!device) throw new NotFoundException(`Device "${deviceId}" not found in group "${groupId}"`);

    const hadPolicy = !!device.policyId;
    device.groupId = null;
    device.policyId = null;
    await this.deviceRepo.save(device);

    // If the device had a policy, reset its rules and unlock if needed
    if (hadPolicy) {
      await this.clearPolicyForDevice(tenantId, deviceId);
    }
  }

  /** Send ADMIN_UNLOCK (if locked) + UPDATE_POLICY with empty rules when a device loses its policy. */
  private async clearPolicyForDevice(tenantId: string, deviceId: string): Promise<void> {
    const commands: any[] = [];

    const lastLock = await this.commandRepo.findOne({
      where: { deviceId, type: CommandType.ADMIN_LOCK },
      order: { createdAt: 'DESC' },
    });
    if (lastLock) {
      const lastUnlock = await this.commandRepo.findOne({
        where: { deviceId, type: CommandType.ADMIN_UNLOCK },
        order: { createdAt: 'DESC' },
      });
      if (!lastUnlock || lastLock.createdAt > lastUnlock.createdAt) {
        commands.push(this.commandRepo.create({
          tenantId, deviceId,
          type: CommandType.ADMIN_UNLOCK,
          payload: {},
          status: CommandStatus.PENDING,
          createdBy: 'system',
        }));
      }
    }

    commands.push(this.commandRepo.create({
      tenantId, deviceId,
      type: CommandType.UPDATE_POLICY,
      payload: { policyId: null, rules: {} },
      status: CommandStatus.PENDING,
      createdBy: 'system',
    }));

    await this.commandRepo.save(commands);
  }
}
