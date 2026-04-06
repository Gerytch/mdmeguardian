import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  GoneException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import * as crypto from 'crypto';
import { Device, DeviceStatus } from './entities/device.entity';
import { EnrollmentToken } from './entities/enrollment-token.entity';
import { RegisterDeviceDto } from './dto/register-device.dto';
import { UpdateDeviceDto, DeviceHeartbeatDto } from './dto/update-device.dto';
import { Command, CommandStatus, CommandType } from '../commands/entities/command.entity';

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectRepository(Command)
    private readonly commandRepository: Repository<Command>,
    @InjectRepository(EnrollmentToken)
    private readonly enrollmentTokenRepository: Repository<EnrollmentToken>,
  ) {}

  private generateDeviceToken(): string {
    return crypto.randomBytes(48).toString('hex');
  }

  async register(tenantId: string, dto: RegisterDeviceDto): Promise<Device & { deviceToken: string }> {
    const existing = await this.deviceRepository.findOne({
      where: { tenantId, serialNumber: dto.serialNumber },
    });
    if (existing) {
      throw new ConflictException(`Device serial "${dto.serialNumber}" already registered`);
    }

    const deviceToken = this.generateDeviceToken();

    const device = this.deviceRepository.create({
      tenantId,
      name: dto.name,
      serialNumber: dto.serialNumber,
      imei: dto.imei ?? null,
      androidVersion: dto.androidVersion ?? null,
      manufacturer: dto.manufacturer ?? null,
      model: dto.model ?? null,
      policyId: dto.policyId ?? null,
      deviceToken,
      enrollmentDate: new Date(),
      status: DeviceStatus.ACTIVE,
      isOnline: true,
      lastSeenAt: new Date(),
    });

    const saved = await this.deviceRepository.save(device);
    return { ...saved, deviceToken } as Device & { deviceToken: string };
  }

  async findAll(tenantId: string): Promise<Device[]> {
    return this.deviceRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(tenantId: string, id: string): Promise<Device> {
    const device = await this.deviceRepository.findOne({ where: { id, tenantId } });
    if (!device) throw new NotFoundException(`Device "${id}" not found`);
    return device;
  }

  async findByToken(deviceToken: string): Promise<Device | null> {
    return this.deviceRepository
      .createQueryBuilder('device')
      .addSelect('device.deviceToken')
      .where('device.deviceToken = :deviceToken', { deviceToken })
      .getOne();
  }

  async update(tenantId: string, id: string, dto: UpdateDeviceDto): Promise<Device> {
    const device = await this.findOne(tenantId, id);
    const oldPolicyId = device.policyId;

    if (dto.name !== undefined) device.name = dto.name;
    if (dto.status !== undefined) device.status = dto.status;
    if (dto.policyId !== undefined) device.policyId = dto.policyId;
    if (dto.currentUserId !== undefined) device.currentUserId = dto.currentUserId;
    if (dto.isKioskMode !== undefined) device.isKioskMode = dto.isKioskMode;
    if (dto.kioskApps !== undefined) device.kioskApps = dto.kioskApps;
    if (dto.osVersion !== undefined) device.osVersion = dto.osVersion;
    const saved = await this.deviceRepository.save(device);

    // Sync admin lock state when device is moved to a different policy
    if (dto.policyId !== undefined && dto.policyId !== oldPolicyId) {
      await this.syncAdminLockOnPolicyChange(tenantId, id, dto.policyId ?? null);
    }

    return saved;
  }

  /** When a device is reassigned to another policy, auto-lock or auto-unlock it
   *  to match the current lock state of its new peers. */
  private async syncAdminLockOnPolicyChange(
    tenantId: string,
    deviceId: string,
    newPolicyId: string | null,
  ): Promise<void> {
    if (!newPolicyId) {
      // Device removed from policy — reset all rules and unlock if needed
      await this.clearPolicyForDevice(tenantId, deviceId);
      return;
    }

    // Find peers already in the target policy (excluding this device)
    const peers = await this.deviceRepository.find({
      where: { tenantId, policyId: newPolicyId },
      select: ['id'],
    });
    const peerIds = peers.map((d) => d.id).filter((pid) => pid !== deviceId);
    if (peerIds.length === 0) return;

    // Most recent ADMIN_LOCK among peers
    const lastLock = await this.commandRepository.findOne({
      where: { deviceId: In(peerIds), type: CommandType.ADMIN_LOCK },
      order: { createdAt: 'DESC' },
    });
    if (!lastLock) return; // policy was never locked

    // Most recent ADMIN_UNLOCK among peers
    const lastUnlock = await this.commandRepository.findOne({
      where: { deviceId: In(peerIds), type: CommandType.ADMIN_UNLOCK },
      order: { createdAt: 'DESC' },
    });

    const policyIsLocked = !lastUnlock || lastLock.createdAt > lastUnlock.createdAt;
    if (!policyIsLocked) return;

    // Send ADMIN_LOCK to the newly moved device using the same payload
    await this.commandRepository.save(
      this.commandRepository.create({
        tenantId,
        deviceId,
        type: CommandType.ADMIN_LOCK,
        payload: lastLock.payload,
        status: CommandStatus.PENDING,
        createdBy: 'system',
      }),
    );
  }

  async heartbeat(tenantId: string, id: string, dto: DeviceHeartbeatDto): Promise<Device> {
    const device = await this.findOne(tenantId, id);
    device.lastSeenAt = new Date();
    device.isOnline = dto.isOnline ?? true;
    if (dto.batteryLevel !== undefined) device.batteryLevel = dto.batteryLevel;
    if (dto.osVersion !== undefined) device.osVersion = dto.osVersion;
    return this.deviceRepository.save(device);
  }

  async updateDeviceStatus(tenantId: string, id: string, status: DeviceStatus): Promise<Device> {
    const device = await this.findOne(tenantId, id);
    device.status = status;
    if (status === DeviceStatus.WIPED) {
      device.isKioskMode = false;
      device.kioskApps = [];
      device.policyId = null;
    }
    return this.deviceRepository.save(device);
  }

  async sendCommand(
    tenantId: string,
    deviceId: string,
    type: CommandType,
    payload: Record<string, any>,
    createdBy: string,
  ): Promise<Command> {
    await this.findOne(tenantId, deviceId);
    const command = this.commandRepository.create({
      tenantId,
      deviceId,
      type,
      payload,
      status: CommandStatus.PENDING,
      createdBy,
    });
    return this.commandRepository.save(command);
  }

  async getOnlineDevices(tenantId: string): Promise<Device[]> {
    return this.deviceRepository.find({
      where: { tenantId, isOnline: true, status: DeviceStatus.ACTIVE },
    });
  }

  async markOfflineStaleDevices(thresholdMinutes = 5): Promise<void> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    // Find stale online devices before marking them offline
    const staleDevices = await this.deviceRepository
      .createQueryBuilder('device')
      .select('device.id')
      .where('device.isOnline = true AND device.lastSeenAt < :threshold', { threshold })
      .getMany();

    if (staleDevices.length === 0) return;

    const staleIds = staleDevices.map((d) => d.id);

    await this.deviceRepository
      .createQueryBuilder()
      .update(Device)
      .set({ isOnline: false })
      .whereInIds(staleIds)
      .execute();

    // Cancel PENDING commands for devices that just went offline
    await this.commandRepository
      .createQueryBuilder()
      .update(Command)
      .set({ status: CommandStatus.FAILED, result: () => `'{"cancelled":true,"reason":"device_offline"}'::jsonb` })
      .where('deviceId IN (:...staleIds) AND status = :status', {
        staleIds,
        status: CommandStatus.PENDING,
      })
      .execute();
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const device = await this.findOne(tenantId, id);
    // Send UNINSTALL_AGENT so the app removes itself and clears Device Owner
    if (device.isOnline) {
      await this.commandRepository.save(
        this.commandRepository.create({
          tenantId,
          deviceId: id,
          type: CommandType.UNINSTALL_AGENT,
          payload: {},
          status: CommandStatus.PENDING,
          createdBy: 'system',
        }),
      );
      // Give the device a moment to pick up the command before we cascade-delete
      await new Promise((r) => setTimeout(r, 3000));
    }
    await this.deviceRepository.remove(device);
  }

  /** Send ADMIN_UNLOCK (if locked) + UPDATE_POLICY with empty rules when a device loses its policy. */
  async clearPolicyForDevice(tenantId: string, deviceId: string): Promise<void> {
    const commands: Partial<Command>[] = [];

    // Unlock if currently locked
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

    // Reset all policy rules to defaults (empty = all restrictions off)
    commands.push(this.commandRepository.create({
      tenantId, deviceId,
      type: CommandType.UPDATE_POLICY,
      payload: { policyId: null, rules: {} },
      status: CommandStatus.PENDING,
      createdBy: 'system',
    }));

    if (commands.length > 0) await this.commandRepository.save(commands);
  }

  // ─── Enrollment Token (QR-based zero-touch enrollment) ────────────────────

  async generateEnrollmentToken(
    tenantId: string,
    policyId?: string,
  ): Promise<{ token: string; expiresAt: Date; qrPayload: string }> {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.enrollmentTokenRepository.save(
      this.enrollmentTokenRepository.create({ tenantId, policyId: policyId ?? null, token, expiresAt }),
    );

    const qrPayload = JSON.stringify({ tenantId, enrollmentToken: token, policyId: policyId ?? null });
    return { token, expiresAt, qrPayload };
  }

  async enrollWithToken(
    tenantId: string,
    enrollmentToken: string,
    dto: RegisterDeviceDto,
  ): Promise<Device & { deviceToken: string }> {
    const record = await this.enrollmentTokenRepository.findOne({
      where: { token: enrollmentToken, tenantId },
    });

    if (!record) throw new NotFoundException('Invalid enrollment token');
    if (record.used) throw new GoneException('Enrollment token already used');
    if (record.expiresAt < new Date()) throw new GoneException('Enrollment token expired');

    // Mark token as used before registering (prevent race conditions)
    await this.enrollmentTokenRepository.update(record.id, { used: true });

    const device = await this.register(tenantId, {
      ...dto,
      policyId: dto.policyId ?? record.policyId ?? undefined,
    });

    return device;
  }
}
