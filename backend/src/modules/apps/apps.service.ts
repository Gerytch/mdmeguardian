import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Like, Repository } from 'typeorm';
import { App } from './entities/app.entity';
import { Device } from '../devices/entities/device.entity';
import { Command, CommandStatus, CommandType } from '../commands/entities/command.entity';
import { Policy } from '../policies/entities/policy.entity';

export interface CreateAppDto {
  name: string;
  packageName: string;
  version: string;
  apkUrl?: string;
  description?: string;
  iconUrl?: string;
  isSystem?: boolean;
  isRequired?: boolean;
  sizeBytes?: number;
}

export interface UpdateAppDto {
  name?: string;
  version?: string;
  apkUrl?: string;
  description?: string;
  iconUrl?: string;
  isSystem?: boolean;
  isRequired?: boolean;
  sizeBytes?: number;
}

@Injectable()
export class AppsService {
  constructor(
    @InjectRepository(App)
    private readonly appRepository: Repository<App>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectRepository(Command)
    private readonly commandRepository: Repository<Command>,
    @InjectRepository(Policy)
    private readonly policyRepository: Repository<Policy>,
  ) {}

  async create(tenantId: string, dto: CreateAppDto): Promise<App> {
    const existing = await this.appRepository.findOne({
      where: { tenantId, packageName: dto.packageName },
    });
    if (existing) {
      throw new ConflictException(`App "${dto.packageName}" already exists in this tenant`);
    }

    const app = this.appRepository.create({
      tenantId,
      name: dto.name,
      packageName: dto.packageName,
      version: dto.version,
      apkUrl: dto.apkUrl ?? null,
      description: dto.description ?? null,
      iconUrl: dto.iconUrl ?? null,
      isSystem: dto.isSystem ?? false,
      isRequired: dto.isRequired ?? false,
      sizeBytes: dto.sizeBytes ?? null,
    });

    return this.appRepository.save(app);
  }

  async findAll(tenantId: string): Promise<App[]> {
    return this.appRepository.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async findOne(tenantId: string, id: string): Promise<App> {
    const app = await this.appRepository.findOne({ where: { id, tenantId } });
    if (!app) throw new NotFoundException(`App "${id}" not found`);
    return app;
  }

  async update(tenantId: string, id: string, dto: UpdateAppDto): Promise<App> {
    const app = await this.findOne(tenantId, id);
    Object.assign(app, dto);
    return this.appRepository.save(app);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const app = await this.findOne(tenantId, id);
    const { packageName, name } = app;

    await this.appRepository.remove(app);

    // Remove this app from requiredAppIds in all policies that reference it
    const policies = await this.policyRepository.find({ where: { tenantId } });
    const toUpdate = policies.filter(p => p.requiredAppIds?.includes(id));
    if (toUpdate.length > 0) {
      await Promise.all(
        toUpdate.map(p => {
          p.requiredAppIds = p.requiredAppIds.filter(aid => aid !== id);
          return this.policyRepository.save(p);
        }),
      );
    }

    // Queue UNINSTALL_APP on all tenant devices — they ignore it if not installed
    const devices = await this.deviceRepository.find({
      where: { tenantId },
      select: ['id'],
    });
    if (devices.length > 0) {
      const commands = devices.map(device =>
        this.commandRepository.create({
          tenantId,
          deviceId: device.id,
          type: CommandType.UNINSTALL_APP,
          payload: { packageName, appName: name },
          status: CommandStatus.PENDING,
          createdBy: 'system',
        }),
      );
      await this.commandRepository.save(commands);
    }
  }

  /** Returns the most recently uploaded E.Guardian agent APK for this tenant. */
  async getAgentApk(tenantId: string): Promise<App | null> {
    return this.appRepository.findOne({
      where: { tenantId, packageName: Like('com.mdm.enterprise%') },
      order: { updatedAt: 'DESC' },
    });
  }

  /** Upserts the agent app record after an APK upload. */
  async upsertAgentApk(
    tenantId: string,
    packageName: string,
    version: string,
    apkUrl: string,
    sizeBytes?: number,
  ): Promise<App> {
    const existing = await this.appRepository.findOne({ where: { tenantId, packageName } });
    if (existing) {
      existing.version = version;
      existing.apkUrl = apkUrl;
      if (sizeBytes) existing.sizeBytes = sizeBytes;
      return this.appRepository.save(existing);
    }
    return this.appRepository.save(
      this.appRepository.create({
        tenantId,
        packageName,
        name: 'E.Guardian MDM Agent',
        version,
        apkUrl,
        sizeBytes: sizeBytes ?? null,
        isSystem: true,
      }),
    );
  }

  async getRequired(tenantId: string): Promise<App[]> {
    return this.appRepository.find({ where: { tenantId, isRequired: true }, order: { name: 'ASC' } });
  }

  async syncFromDevice(tenantId: string, apps: { packageName: string; name: string }[]): Promise<void> {
    for (const app of apps) {
      const existing = await this.appRepository.findOne({
        where: { tenantId, packageName: app.packageName },
      });
      if (existing) {
        // Update only the display name — never touch isSystem so manually
        // catalogued apps (isSystem=false) keep their flag after device sync.
        existing.name = app.name;
        await this.appRepository.save(existing);
      } else {
        await this.appRepository.save(
          this.appRepository.create({
            tenantId,
            packageName: app.packageName,
            name: app.name,
            version: '0',
            isSystem: true,
          }),
        );
      }
    }
  }
}
