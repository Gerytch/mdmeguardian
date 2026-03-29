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

    if (dto.name !== undefined) policy.name = dto.name;
    if (dto.description !== undefined) policy.description = dto.description;
    if (dto.isDefault !== undefined) policy.isDefault = dto.isDefault;
    if (dto.rules !== undefined) policy.rules = { ...policy.rules, ...dto.rules };
    if (dto.requiredAppIds !== undefined) policy.requiredAppIds = dto.requiredAppIds;

    const saved = await this.policyRepository.save(policy);

    // Propagate update to all assigned devices
    await this.propagatePolicyUpdate(tenantId, id, saved);

    return saved;
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
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const policy = await this.findOne(tenantId, id);
    await this.deviceRepository.update({ tenantId, policyId: id }, { policyId: null });
    await this.policyRepository.remove(policy);
  }
}
