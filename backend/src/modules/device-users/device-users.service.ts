import { Injectable, NotFoundException, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import * as bcrypt from 'bcryptjs'
import { DeviceUser, DeviceUserStatus } from './entities/device-user.entity'
import { CreateDeviceUserDto, UpdateDeviceUserDto } from './dto/device-user.dto'

@Injectable()
export class DeviceUsersService {
  constructor(
    @InjectRepository(DeviceUser)
    private readonly deviceUserRepository: Repository<DeviceUser>,
  ) {}

  async create(tenantId: string, dto: CreateDeviceUserDto): Promise<DeviceUser> {
    const existing = await this.deviceUserRepository.findOne({ where: { tenantId, username: dto.username } })
    if (existing) throw new ConflictException(`Username "${dto.username}" already exists in this tenant`)

    if (dto.isDeviceAdmin && dto.pin.length < 6) {
      throw new BadRequestException('Admin PIN must be at least 6 digits')
    }

    const pinHash = await bcrypt.hash(dto.pin, 10)
    const deviceUser = this.deviceUserRepository.create({
      tenantId,
      username: dto.username,
      fullName: dto.fullName,
      pinHash,
      isDeviceAdmin: dto.isDeviceAdmin ?? false,
      department: dto.department ?? null,
      jobTitle: dto.jobTitle ?? null,
      photoUrl: dto.photoUrl ?? null,
    })
    return this.deviceUserRepository.save(deviceUser)
  }

  async findAll(
    tenantId: string,
    filters?: { department?: string; status?: DeviceUserStatus; page?: number; limit?: number },
  ): Promise<{ data: DeviceUser[]; total: number; page: number; limit: number }> {
    const page = filters?.page || 1
    const limit = filters?.limit || 20

    const qb = this.deviceUserRepository
      .createQueryBuilder('deviceUser')
      .where('deviceUser.tenantId = :tenantId', { tenantId })
      .orderBy('deviceUser.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)

    if (filters?.department) {
      qb.andWhere('deviceUser.department = :department', { department: filters.department })
    }
    if (filters?.status) {
      qb.andWhere('deviceUser.status = :status', { status: filters.status })
    }

    const [data, total] = await qb.getManyAndCount()
    return { data, total, page, limit }
  }

  async findOne(tenantId: string, id: string): Promise<DeviceUser> {
    const deviceUser = await this.deviceUserRepository.findOne({ where: { id, tenantId } })
    if (!deviceUser) throw new NotFoundException(`DeviceUser "${id}" not found`)
    return deviceUser
  }

  async update(tenantId: string, id: string, dto: UpdateDeviceUserDto): Promise<DeviceUser> {
    const deviceUser = await this.findOne(tenantId, id)
    if (dto.username !== undefined) deviceUser.username = dto.username
    if (dto.fullName !== undefined) deviceUser.fullName = dto.fullName
    if (dto.isDeviceAdmin !== undefined) deviceUser.isDeviceAdmin = dto.isDeviceAdmin
    if (dto.department !== undefined) deviceUser.department = dto.department ?? null
    if (dto.jobTitle !== undefined) deviceUser.jobTitle = dto.jobTitle ?? null
    if (dto.photoUrl !== undefined) deviceUser.photoUrl = dto.photoUrl ?? null
    return this.deviceUserRepository.save(deviceUser)
  }

  async updatePin(tenantId: string, id: string, pin: string): Promise<void> {
    const user = await this.findOne(tenantId, id)
    if (user.isDeviceAdmin && pin.length < 6) {
      throw new BadRequestException('Admin PIN must be at least 6 digits')
    }
    const pinHash = await bcrypt.hash(pin, 10)
    await this.deviceUserRepository.update({ id, tenantId }, { pinHash })
  }

  async updateStatus(tenantId: string, id: string, status: DeviceUserStatus): Promise<DeviceUser> {
    const deviceUser = await this.findOne(tenantId, id)
    deviceUser.status = status
    return this.deviceUserRepository.save(deviceUser)
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const deviceUser = await this.findOne(tenantId, id)
    await this.deviceUserRepository.remove(deviceUser)
  }

  async findAllWithPinHash(tenantId: string): Promise<DeviceUser[]> {
    return this.deviceUserRepository
      .createQueryBuilder('deviceUser')
      .addSelect('deviceUser.pinHash')
      .where('deviceUser.tenantId = :tenantId', { tenantId })
      .andWhere('deviceUser.status = :status', { status: DeviceUserStatus.ACTIVE })
      .getMany()
  }

  async validateCredentials(tenantId: string, username: string, pin: string): Promise<DeviceUser> {
    const deviceUser = await this.deviceUserRepository
      .createQueryBuilder('deviceUser')
      .addSelect('deviceUser.pinHash')
      .where('deviceUser.tenantId = :tenantId', { tenantId })
      .andWhere('deviceUser.username = :username', { username })
      .getOne()

    if (!deviceUser) throw new UnauthorizedException('Invalid credentials')

    const valid = await bcrypt.compare(pin, deviceUser.pinHash)
    if (!valid) throw new UnauthorizedException('Invalid credentials')

    if (deviceUser.status !== DeviceUserStatus.ACTIVE) throw new UnauthorizedException('Invalid credentials')

    await this.deviceUserRepository.update(deviceUser.id, { lastLoginAt: new Date() })

    const { pinHash: _, ...result } = deviceUser as DeviceUser & { pinHash: string }
    return result as DeviceUser
  }
}
