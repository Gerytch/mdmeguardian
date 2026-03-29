import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Command, CommandStatus, CommandType } from './entities/command.entity';
import { Device } from '../devices/entities/device.entity';
import { Policy } from '../policies/entities/policy.entity';
import { App } from '../apps/entities/app.entity';

export interface CreateCommandDto {
  deviceId: string;
  type: CommandType;
  payload?: Record<string, any>;
  createdBy: string;
}

export class AckCommandDto {
  @IsBoolean()
  success: boolean;

  @IsOptional()
  @IsObject()
  result?: Record<string, any>;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}

@Injectable()
export class CommandsService {
  constructor(
    @InjectRepository(Command)
    private readonly commandRepository: Repository<Command>,
    @InjectRepository(Device)
    private readonly deviceRepository: Repository<Device>,
    @InjectRepository(Policy)
    private readonly policyRepository: Repository<Policy>,
    @InjectRepository(App)
    private readonly appRepository: Repository<App>,
  ) {}

  async create(tenantId: string, dto: CreateCommandDto): Promise<Command> {
    const device = await this.deviceRepository.findOne({
      where: { id: dto.deviceId, tenantId },
    });
    if (!device) throw new NotFoundException(`Device "${dto.deviceId}" not found`);

    if (dto.type === CommandType.WIPE && !dto.payload?.confirmed) {
      throw new BadRequestException('WIPE command requires payload.confirmed = true');
    }

    // If UPDATE_POLICY arrives without a payload, auto-populate from the
    // device's currently assigned policy so the agent gets the full rules.
    if (dto.type === CommandType.UPDATE_POLICY && !dto.payload?.rules) {
      const deviceWithPolicy = await this.deviceRepository.findOne({
        where: { id: dto.deviceId, tenantId },
        select: ['id', 'policyId'],
      });
      if (deviceWithPolicy?.policyId) {
        const policy = await this.policyRepository.findOne({
          where: { id: deviceWithPolicy.policyId, tenantId },
        });
        if (policy) {
          let requiredApps: any[] = [];
          if (policy.requiredAppIds?.length) {
            const apps = await this.appRepository.findBy({ id: In(policy.requiredAppIds) });
            requiredApps = apps.map((a) => ({
              id: a.id,
              name: a.name,
              packageName: a.packageName,
              version: a.version,
              apkUrl: a.apkUrl,
            }));
          }
          dto.payload = { policyId: policy.id, rules: policy.rules, requiredApps };
        }
      }
    }

    const command = this.commandRepository.create({
      tenantId,
      deviceId: dto.deviceId,
      type: dto.type,
      payload: dto.payload ?? {},
      status: CommandStatus.PENDING,
      createdBy: dto.createdBy,
    });

    return this.commandRepository.save(command);
  }

  async findAll(tenantId: string, deviceId?: string): Promise<Command[]> {
    const where: any = { tenantId };
    if (deviceId) where.deviceId = deviceId;
    return this.commandRepository.find({ where, order: { createdAt: 'DESC' }, take: 500 });
  }

  async findOne(tenantId: string, id: string): Promise<Command> {
    const command = await this.commandRepository.findOne({ where: { id, tenantId } });
    if (!command) throw new NotFoundException(`Command "${id}" not found`);
    return command;
  }

  /** Resolves a Device from its token. Throws ForbiddenException if invalid. */
  async resolveDeviceByToken(deviceToken: string): Promise<Device> {
    const device = await this.deviceRepository
      .createQueryBuilder('device')
      .addSelect('device.deviceToken')
      .where('device.deviceToken = :deviceToken', { deviceToken })
      .getOne();
    if (!device) throw new ForbiddenException('Invalid device token');
    return device;
  }

  /** Called by Android agent to fetch pending commands. Marks them as SENT atomically. */
  async getPendingForDevice(deviceToken: string): Promise<Command[]> {
    const device = await this.deviceRepository
      .createQueryBuilder('device')
      .addSelect('device.deviceToken')
      .where('device.deviceToken = :deviceToken', { deviceToken })
      .getOne();

    if (!device) throw new ForbiddenException('Invalid device token');

    const pending = await this.commandRepository.find({
      where: { deviceId: device.id, tenantId: device.tenantId, status: CommandStatus.PENDING },
      order: { createdAt: 'ASC' },
    });

    const now = new Date();

    // Update device heartbeat on every poll
    await this.deviceRepository.update(device.id, { lastSeenAt: now, isOnline: true });

    if (pending.length > 0) {
      await this.commandRepository
        .createQueryBuilder()
        .update(Command)
        .set({ status: CommandStatus.SENT, sentAt: now })
        .whereInIds(pending.map((c) => c.id))
        .execute();

      pending.forEach((c) => {
        c.status = CommandStatus.SENT;
        c.sentAt = now;
      });
    }

    return pending;
  }

  /** Called by Android agent to acknowledge command result. */
  async acknowledgeCommand(deviceToken: string, commandId: string, dto: AckCommandDto): Promise<Command> {
    const device = await this.deviceRepository
      .createQueryBuilder('device')
      .addSelect('device.deviceToken')
      .where('device.deviceToken = :deviceToken', { deviceToken })
      .getOne();

    if (!device) throw new ForbiddenException('Invalid device token');

    const command = await this.commandRepository.findOne({
      where: { id: commandId, deviceId: device.id, tenantId: device.tenantId },
    });
    if (!command) throw new NotFoundException(`Command "${commandId}" not found for this device`);

    if (command.status !== CommandStatus.SENT && command.status !== CommandStatus.PENDING) {
      throw new BadRequestException(`Command is already in terminal state: ${command.status}`);
    }

    command.status = dto.success ? CommandStatus.EXECUTED : CommandStatus.FAILED;
    command.executedAt = new Date();
    command.result = dto.result ?? (dto.errorMessage ? { error: dto.errorMessage } : null);

    await this.commandRepository.save(command);

    // Sync device state fields when the relevant command is successfully executed
    if (dto.success) {
      if (command.type === CommandType.ENABLE_KIOSK) {
        await this.deviceRepository.update(device.id, { isKioskMode: true });
      } else if (command.type === CommandType.DISABLE_KIOSK) {
        await this.deviceRepository.update(device.id, { isKioskMode: false });
      }
    }

    return command;
  }

  /** Called by device to report in-progress status for long-running commands (e.g. NETWORK_TEST). */
  async updateCommandProgress(
    deviceToken: string,
    commandId: string,
    progress: number,
    message: string,
    screenshotUrl?: string,
  ): Promise<void> {
    const device = await this.deviceRepository
      .createQueryBuilder('device')
      .addSelect('device.deviceToken')
      .where('device.deviceToken = :deviceToken', { deviceToken })
      .getOne();
    if (!device) throw new ForbiddenException('Invalid device token');

    const command = await this.commandRepository.findOne({
      where: { id: commandId, deviceId: device.id },
    });
    if (!command) throw new NotFoundException(`Command "${commandId}" not found`);

    const existing = command.result ?? {};
    command.result = { ...existing, progress, message, ...(screenshotUrl ? { screenshotUrl } : {}) };
    await this.commandRepository.save(command);
  }

  async cancel(tenantId: string, id: string): Promise<Command> {
    const command = await this.findOne(tenantId, id);
    if (command.status !== CommandStatus.PENDING) {
      throw new BadRequestException(`Only PENDING commands can be cancelled. Current: ${command.status}`);
    }
    command.status = CommandStatus.FAILED;
    command.result = { cancelled: true };
    return this.commandRepository.save(command);
  }

  async retryFailed(tenantId: string, id: string): Promise<Command> {
    const original = await this.findOne(tenantId, id);
    if (original.status !== CommandStatus.FAILED) {
      throw new BadRequestException('Only FAILED commands can be retried');
    }

    const retry = this.commandRepository.create({
      tenantId,
      deviceId: original.deviceId,
      type: original.type,
      payload: original.payload,
      status: CommandStatus.PENDING,
      createdBy: original.createdBy,
    });

    return this.commandRepository.save(retry);
  }
}
