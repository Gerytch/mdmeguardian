import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';

import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { Device } from '../devices/entities/device.entity';

export interface JwtPayload {
  sub: string;
  email?: string;
  role: string;
  tenantId: string;
  isDevice?: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Tenant)
    private readonly tenantRepository: Repository<Tenant>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async login(dto: LoginDto, tenantIdentifier?: string): Promise<TokenPair & { user: Partial<User> }> {
    let tenant: Tenant | null = null;

    if (tenantIdentifier) {
      const isUuid = /^[0-9a-f-]{36}$/i.test(tenantIdentifier);
      tenant = await this.tenantRepository.findOne({
        where: isUuid ? { id: tenantIdentifier } : { slug: tenantIdentifier },
      });
      if (!tenant || !tenant.isActive) {
        throw new UnauthorizedException('Tenant not found or inactive');
      }
    }

    // Find user by email (optionally scoped to tenant)
    const qb = this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .andWhere('user.email = :email', { email: dto.email });

    if (tenant) qb.andWhere('user.tenantId = :tenantId', { tenantId: tenant.id });

    const user = await qb.getOne();

    // If tenant not provided, resolve it from the user
    if (!tenant && user) {
      tenant = await this.tenantRepository.findOne({ where: { id: user.tenantId } });
      if (!tenant || !tenant.isActive) {
        throw new UnauthorizedException('Tenant not found or inactive');
      }
    }

    if (!user) {
      await bcrypt.compare('dummy', '$2b$12$dummyhashfortimingnobodycanuse');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) throw new ForbiddenException('User account is inactive');

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) throw new UnauthorizedException('Invalid email or password');

    await this.userRepository.update(user.id, { lastLoginAt: new Date() });

    const tokens = this.generateTokenPair(user, tenant);
    this.logger.log(`User ${user.email} logged in (tenant: ${tenant.slug})`);

    return {
      ...tokens,
      user: {
        id: user.id,
        tenantId: tenant.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    };
  }

  async register(dto: RegisterDto): Promise<TokenPair & { tenant: Partial<Tenant>; user: Partial<User> }> {
    const existing = await this.tenantRepository.findOne({ where: { slug: dto.companySlug } });
    if (existing) throw new ConflictException(`Slug "${dto.companySlug}" is already taken`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const tenant = queryRunner.manager.create(Tenant, {
        name: dto.companyName,
        slug: dto.companySlug,
        isActive: true,
        settings: {},
      });
      await queryRunner.manager.save(Tenant, tenant);

      const passwordHash = await bcrypt.hash(dto.password, 12);
      const user = queryRunner.manager.create(User, {
        tenantId: tenant.id,
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: UserRole.TENANT_ADMIN,
        isActive: true,
        lastLoginAt: new Date(),
      });
      await queryRunner.manager.save(User, user);

      await queryRunner.commitTransaction();

      const tokens = this.generateTokenPair(user, tenant);
      return {
        ...tokens,
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        user: { id: user.id, email: user.email, role: user.role },
      };
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async refreshToken(token: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.userRepository.findOne({ where: { id: payload.sub } });
    if (!user || !user.isActive) throw new UnauthorizedException('User not found or inactive');

    const tenant = await this.tenantRepository.findOne({ where: { id: user.tenantId } });
    if (!tenant || !tenant.isActive) throw new ForbiddenException('Tenant inactive');

    return this.generateTokenPair(user, tenant);
  }

  async getProfile(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async deviceLogin(deviceToken: string): Promise<{ token: string; device: Partial<Device> }> {
    const device = await this.deviceRepository
      .createQueryBuilder('device')
      .addSelect('device.deviceToken')
      .where('device.deviceToken = :deviceToken', { deviceToken })
      .getOne();

    if (!device) throw new UnauthorizedException('Invalid device token');
    if (device.status !== 'ACTIVE' as any) throw new ForbiddenException('Device is not active');

    const tenant = await this.tenantRepository.findOne({ where: { id: device.tenantId } });
    if (!tenant || !tenant.isActive) throw new ForbiddenException('Tenant inactive');

    const payload: JwtPayload = {
      sub: device.id,
      role: 'DEVICE',
      tenantId: device.tenantId,
      isDevice: true,
    };

    const token = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: '30d',
    });

    return {
      token,
      device: { id: device.id, name: device.name, tenantId: device.tenantId },
    };
  }

  private generateTokenPair(user: User, tenant: Tenant): TokenPair {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantId: tenant.id,
      isDevice: false,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_SECRET'),
      expiresIn: this.configService.get('JWT_EXPIRATION', '15m'),
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION', '7d'),
      },
    );

    return { accessToken, refreshToken, expiresIn: 900, tokenType: 'Bearer' };
  }
}
