import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RemoteSession, RemoteSessionStatus } from './remote-session.entity';
import { Command, CommandStatus, CommandType } from '../commands/entities/command.entity';
import { Device } from '../devices/entities/device.entity';

@Injectable()
export class RemoteSessionService {
  constructor(
    @InjectRepository(RemoteSession)
    private readonly sessionRepo: Repository<RemoteSession>,
    @InjectRepository(Command)
    private readonly commandRepo: Repository<Command>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
  ) {}

  /**
   * Creates a new remote viewing session and dispatches a REMOTE_VIEW_START command
   * to the target device.
   */
  async create(tenantId: string, deviceId: string, userId: string): Promise<RemoteSession> {
    // Verify device exists and belongs to tenant
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId, tenantId },
    });
    if (!device) {
      throw new NotFoundException(`Device "${deviceId}" not found`);
    }
    if (!device.isOnline) {
      throw new BadRequestException('Device is offline');
    }

    // Check for existing active session on this device
    const existing = await this.sessionRepo.findOne({
      where: { tenantId, deviceId, status: RemoteSessionStatus.ACTIVE },
    });
    if (existing) {
      throw new BadRequestException(
        `Device already has an active remote session: ${existing.id}`,
      );
    }

    // Also check for pending sessions (device hasn't connected yet)
    const pending = await this.sessionRepo.findOne({
      where: { tenantId, deviceId, status: RemoteSessionStatus.PENDING },
    });
    if (pending) {
      throw new BadRequestException(
        `Device already has a pending remote session: ${pending.id}`,
      );
    }

    // Create session record
    const session = this.sessionRepo.create({
      tenantId,
      deviceId,
      initiatedBy: userId,
      status: RemoteSessionStatus.PENDING,
    });
    const saved = await this.sessionRepo.save(session);

    // Dispatch REMOTE_VIEW_START command to the device
    const command = this.commandRepo.create({
      tenantId,
      deviceId,
      type: CommandType.REMOTE_VIEW_START,
      payload: { sessionId: saved.id },
      status: CommandStatus.PENDING,
      createdBy: userId,
    });
    await this.commandRepo.save(command);

    return saved;
  }

  /**
   * Finds the active or pending remote session for a device.
   */
  async findActive(tenantId: string, deviceId: string): Promise<RemoteSession | null> {
    return this.sessionRepo.findOne({
      where: [
        { tenantId, deviceId, status: RemoteSessionStatus.ACTIVE },
        { tenantId, deviceId, status: RemoteSessionStatus.PENDING },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Gets a session by ID.
   */
  async findOne(tenantId: string, sessionId: string): Promise<RemoteSession> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tenantId },
    });
    if (!session) {
      throw new NotFoundException(`Remote session "${sessionId}" not found`);
    }
    return session;
  }

  /**
   * Closes a remote session and dispatches REMOTE_VIEW_STOP to the device.
   */
  async close(tenantId: string, sessionId: string): Promise<RemoteSession> {
    const session = await this.findOne(tenantId, sessionId);

    if (session.status === RemoteSessionStatus.CLOSED) {
      throw new BadRequestException('Session is already closed');
    }

    session.status = RemoteSessionStatus.CLOSED;
    session.endedAt = new Date();
    const saved = await this.sessionRepo.save(session);

    // Dispatch REMOTE_VIEW_STOP command to the device
    const command = this.commandRepo.create({
      tenantId,
      deviceId: session.deviceId,
      type: CommandType.REMOTE_VIEW_STOP,
      payload: { sessionId },
      status: CommandStatus.PENDING,
      createdBy: session.initiatedBy,
    });
    await this.commandRepo.save(command);

    return saved;
  }
}
