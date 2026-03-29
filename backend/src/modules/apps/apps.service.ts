import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { App } from './entities/app.entity';

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
    await this.appRepository.remove(app);
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
