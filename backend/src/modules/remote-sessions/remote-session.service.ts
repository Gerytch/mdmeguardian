import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { RemoteSession, RemoteSessionStatus } from './remote-session.entity';
import { Command, CommandStatus, CommandType } from '../commands/entities/command.entity';
import { Device } from '../devices/entities/device.entity';

/** Auto-close PENDING sessions after 30 seconds */
const PENDING_TIMEOUT_MS = 30_000;
/** Cleanup interval runs every 15 seconds */
const CLEANUP_INTERVAL_MS = 15_000;

@Injectable()
export class RemoteSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('RemoteSessionService');
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(RemoteSession)
    private readonly sessionRepo: Repository<RemoteSession>,
    @InjectRepository(Command)
    private readonly commandRepo: Repository<Command>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
  ) {}

  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanupStaleSessions(), CLEANUP_INTERVAL_MS);
    this.logger.log('Session cleanup timer started (every 15s)');
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  /**
   * Auto-close PENDING sessions that exceeded timeout (device never connected).
   */
  private async cleanupStaleSessions() {
    const cutoff = new Date(Date.now() - PENDING_TIMEOUT_MS);
    const stale = await this.sessionRepo.find({
      where: {
        status: RemoteSessionStatus.PENDING,
        createdAt: LessThan(cutoff),
      },
    });
    for (const session of stale) {
      session.status = RemoteSessionStatus.CLOSED;
      session.endedAt = new Date();
      await this.sessionRepo.save(session);
      this.logger.warn(`Auto-closed stale PENDING session ${session.id} (created ${session.createdAt.toISOString()})`);
    }
  }

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
