import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant, TenantPlan } from './entities/tenant.entity';

export interface CreateTenantDto {
  name: string;
  slug: string;
  plan?: TenantPlan;
  settings?: Record<string, any>;
}

export interface UpdateTenantDto {
  name?: string;
  plan?: TenantPlan;
  isActive?: boolean;
  settings?: Record<string, any>;
}

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(dto.slug)) {
      throw new BadRequestException(
        'Slug must contain only lowercase letters, numbers, and hyphens',
      );
    }

    const existing = await this.tenantRepository.findOne({
      where: { slug: dto.slug },
    });
    if (existing) {
      throw new ConflictException(`Tenant with slug "${dto.slug}" already exists`);
    }

    const tenant = this.tenantRepository.create({
      name: dto.name,
      slug: dto.slug,
      plan: dto.plan ?? TenantPlan.FREE,
      settings: dto.settings ?? {},
      isActive: true,
    });

    return this.tenantRepository.save(tenant);
  }

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`Tenant "${id}" not found`);
    return tenant;
  }

  async findBySlug(slug: string): Promise<Tenant> {
    const tenant = await this.tenantRepository.findOne({ where: { slug } });
    if (!tenant) throw new NotFoundException(`Tenant with slug "${slug}" not found`);
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findOne(id);
    if (dto.name !== undefined) tenant.name = dto.name;
    if (dto.plan !== undefined) tenant.plan = dto.plan;
    if (dto.isActive !== undefined) tenant.isActive = dto.isActive;
    if (dto.settings !== undefined) tenant.settings = { ...tenant.settings, ...dto.settings };
    return this.tenantRepository.save(tenant);
  }

  async deactivate(id: string): Promise<Tenant> {
    const tenant = await this.findOne(id);
    tenant.isActive = false;
    return this.tenantRepository.save(tenant);
  }

  async remove(id: string): Promise<void> {
    const tenant = await this.findOne(id);
    await this.tenantRepository.remove(tenant);
  }
}
