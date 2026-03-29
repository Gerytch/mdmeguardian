import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole } from './entities/user.entity';
import { CreateUserDto, UpdateUserDto, ChangePasswordDto } from './dto/create-user.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async create(tenantId: string, dto: CreateUserDto): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { tenantId, email: dto.email.toLowerCase().trim() },
    });
    if (existing) {
      throw new ConflictException(`User "${dto.email}" already exists in this tenant`);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    const user = this.userRepository.create({
      tenantId,
      email: dto.email.toLowerCase().trim(),
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role ?? UserRole.VIEWER,
      isActive: true,
    });

    const saved = await this.userRepository.save(user);
    delete (saved as any).passwordHash;
    return saved;
  }

  async findAll(tenantId: string): Promise<User[]> {
    return this.userRepository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      select: ['id', 'tenantId', 'email', 'firstName', 'lastName', 'role', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt'],
    });
  }

  async findOne(tenantId: string, id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
      select: ['id', 'tenantId', 'email', 'firstName', 'lastName', 'role', 'isActive', 'lastLoginAt', 'createdAt', 'updatedAt'],
    });
    if (!user) throw new NotFoundException(`User "${id}" not found`);
    return user;
  }

  async findByEmailWithPassword(tenantId: string, email: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.tenantId = :tenantId', { tenantId })
      .andWhere('user.email = :email', { email: email.toLowerCase().trim() })
      .getOne();
  }

  async findByIdWithPassword(id: string): Promise<User | null> {
    return this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.id = :id', { id })
      .getOne();
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(tenantId, id);
    if (dto.firstName !== undefined) user.firstName = dto.firstName;
    if (dto.lastName !== undefined) user.lastName = dto.lastName;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    return this.userRepository.save(user);
  }

  async changePassword(tenantId: string, id: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.findByIdWithPassword(id);
    if (!user || user.tenantId !== tenantId) throw new NotFoundException(`User "${id}" not found`);
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');
    user.passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.userRepository.save(user);
  }

  async recordLogin(id: string): Promise<void> {
    await this.userRepository.update(id, { lastLoginAt: new Date() });
  }

  async remove(tenantId: string, id: string, requesterId: string): Promise<void> {
    if (id === requesterId) throw new ForbiddenException('You cannot delete your own account');
    const user = await this.findOne(tenantId, id);
    await this.userRepository.remove(user);
  }
}
