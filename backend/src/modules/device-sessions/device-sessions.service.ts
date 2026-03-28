import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { DeviceSession, DeviceSessionStatus } from './entities/device-session.entity'

@Injectable()
export class DeviceSessionsService {
  constructor(
    @InjectRepository(DeviceSession)
    private readonly sessionRepository: Repository<DeviceSession>,
  ) {}

  async create(tenantId: string, deviceId: string, deviceUserId: string): Promise<DeviceSession> {
    const session = this.sessionRepository.create({
      tenantId,
      deviceId,
      deviceUserId,
      status: DeviceSessionStatus.ACTIVE,
    })
    return this.sessionRepository.save(session)
  }

  async closeActiveForDevice(tenantId: string, deviceId: string, reason: string): Promise<void> {
    await this.sessionRepository
      .createQueryBuilder()
      .update(DeviceSession)
      .set({ status: DeviceSessionStatus.INTERRUPTED, endedAt: new Date(), endedReason: reason })
      .where('tenantId = :tenantId', { tenantId })
      .andWhere('deviceId = :deviceId', { deviceId })
      .andWhere('status = :status', { status: DeviceSessionStatus.ACTIVE })
      .execute()
  }

  async endSession(
    deviceId: string,
    sessionId: string,
    status: DeviceSessionStatus,
    reason: string,
  ): Promise<void> {
    const result = await this.sessionRepository.update(
      { id: sessionId, deviceId },
      { endedAt: new Date(), status, endedReason: reason },
    )
    if (!result.affected || result.affected === 0) {
      throw new NotFoundException(`Session "${sessionId}" not found`)
    }
  }

  async findAll(
    tenantId: string,
    filters?: {
      deviceId?: string
      deviceUserId?: string
      status?: DeviceSessionStatus
      from?: string
      to?: string
      page?: number
      limit?: number
    },
  ): Promise<{ data: DeviceSession[]; total: number; page: number; limit: number }> {
    const page = filters?.page ?? 1
    const limit = filters?.limit ?? 50

    const qb = this.sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.deviceUser', 'deviceUser')
      .leftJoin('session.device', 'device')
      .addSelect(['deviceUser.fullName', 'deviceUser.username', 'device.name'])
      .where('session.tenantId = :tenantId', { tenantId })
      .orderBy('session.startedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)

    if (filters?.deviceId) {
      qb.andWhere('session.deviceId = :deviceId', { deviceId: filters.deviceId })
    }
    if (filters?.deviceUserId) {
      qb.andWhere('session.deviceUserId = :deviceUserId', { deviceUserId: filters.deviceUserId })
    }
    if (filters?.status) {
      qb.andWhere('session.status = :status', { status: filters.status })
    }
    if (filters?.from) {
      qb.andWhere('session.startedAt >= :from', { from: new Date(filters.from) })
    }
    if (filters?.to) {
      qb.andWhere('session.startedAt <= :to', { to: new Date(filters.to) })
    }

    const [data, total] = await qb.getManyAndCount()
    return { data, total, page, limit }
  }

  async exportCsv(
    tenantId: string,
    filters?: {
      deviceId?: string
      deviceUserId?: string
      status?: DeviceSessionStatus
      from?: string
      to?: string
    },
  ): Promise<DeviceSession[]> {
    const qb = this.sessionRepository
      .createQueryBuilder('session')
      .leftJoin('session.deviceUser', 'deviceUser')
      .leftJoin('session.device', 'device')
      .addSelect(['deviceUser.fullName', 'deviceUser.username', 'device.name'])
      .where('session.tenantId = :tenantId', { tenantId })
      .orderBy('session.startedAt', 'DESC')

    if (filters?.deviceId) {
      qb.andWhere('session.deviceId = :deviceId', { deviceId: filters.deviceId })
    }
    if (filters?.deviceUserId) {
      qb.andWhere('session.deviceUserId = :deviceUserId', { deviceUserId: filters.deviceUserId })
    }
    if (filters?.status) {
      qb.andWhere('session.status = :status', { status: filters.status })
    }
    if (filters?.from) {
      qb.andWhere('session.startedAt >= :from', { from: new Date(filters.from) })
    }
    if (filters?.to) {
      qb.andWhere('session.startedAt <= :to', { to: new Date(filters.to) })
    }

    return qb.getMany()
  }
}
