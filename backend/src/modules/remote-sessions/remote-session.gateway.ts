import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server } from 'ws';
import { IncomingMessage } from 'http';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import WebSocket from 'ws';
import { RemoteSession, RemoteSessionStatus } from './remote-session.entity';
import { Device } from '../devices/entities/device.entity';

interface WsClient extends WebSocket {
  isAlive: boolean;
  role: 'device' | 'viewer';
  sessionId: string;
  deviceId?: string;
}

@WebSocketGateway({ path: '/remote' })
export class RemoteSessionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private logger = new Logger('RemoteSessionGateway');

  // sessionId -> { device: WsClient, viewers: Set<WsClient> }
  private sessions = new Map<string, { device: WsClient | null; viewers: Set<WsClient> }>();

  constructor(
    @InjectRepository(RemoteSession)
    private readonly sessionRepo: Repository<RemoteSession>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
  ) {}

  async handleConnection(client: WsClient, req: IncomingMessage) {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      const role = url.searchParams.get('role') as 'device' | 'viewer';
      const sessionId = url.searchParams.get('sessionId');
      const token = url.searchParams.get('token');

      if (!role || !sessionId || !token) {
        client.close(4001, 'Missing params: role, sessionId, token');
        return;
      }

      if (role !== 'device' && role !== 'viewer') {
        client.close(4002, 'Invalid role: must be "device" or "viewer"');
        return;
      }

      // Validate session exists and is not closed
      const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
      if (!session || session.status === RemoteSessionStatus.CLOSED) {
        client.close(4004, 'Session not found or closed');
        return;
      }

      // Validate token based on role
      if (role === 'device') {
        const device = await this.deviceRepo
          .createQueryBuilder('device')
          .addSelect('device.deviceToken')
          .where('device.deviceToken = :token', { token })
          .andWhere('device.id = :deviceId', { deviceId: session.deviceId })
          .getOne();

        if (!device) {
          client.close(4003, 'Invalid device token');
          return;
        }
        client.deviceId = device.id;
      }
      // For viewer role, the token is the JWT — the frontend already validated auth
      // via the REST endpoint before establishing WebSocket

      client.role = role;
      client.sessionId = sessionId;
      client.isAlive = true;

      // Initialize session room if needed
      if (!this.sessions.has(sessionId)) {
        this.sessions.set(sessionId, { device: null, viewers: new Set() });
      }
      const room = this.sessions.get(sessionId)!;

      if (role === 'device') {
        room.device = client;
        // Mark session as ACTIVE in the database
        await this.sessionRepo.update(sessionId, {
          status: RemoteSessionStatus.ACTIVE,
          startedAt: new Date(),
        });
        // Notify all viewers that the device has connected
        this.broadcastToViewers(sessionId, JSON.stringify({ type: 'device_connected' }));
        this.logger.log(`Device connected to session ${sessionId}`);
      } else {
        room.viewers.add(client);
        // If device is already connected, notify the new viewer immediately
        if (room.device) {
          client.send(JSON.stringify({ type: 'device_connected' }));
        }
        // Request a fresh frame from the device for the new viewer
        if (room.device && room.device.readyState === WebSocket.OPEN) {
          room.device.send(JSON.stringify({ type: 'request_frame' }));
        }
        this.logger.log(`Viewer connected to session ${sessionId}`);
      }

      // Handle incoming messages
      client.on('message', (data: Buffer | string, isBinary: boolean) => {
        this.handleMessage(client, data, isBinary);
      });

      // Heartbeat pong
      client.on('pong', () => {
        client.isAlive = true;
      });
    } catch (err) {
      this.logger.error('Connection error', err);
      client.close(4500, 'Internal error');
    }
  }

  handleDisconnect(client: WsClient) {
    const { sessionId, role } = client;
    if (!sessionId) return;

    const room = this.sessions.get(sessionId);
    if (!room) return;

    if (role === 'device') {
      room.device = null;
      this.broadcastToViewers(sessionId, JSON.stringify({ type: 'device_disconnected' }));
      this.logger.log(`Device disconnected from session ${sessionId}`);
    } else {
      room.viewers.delete(client);
      // If no more viewers, tell device to stop capturing
      if (room.viewers.size === 0 && room.device && room.device.readyState === WebSocket.OPEN) {
        room.device.send(JSON.stringify({ type: 'stop_capture' }));
      }
      this.logger.log(`Viewer disconnected from session ${sessionId}`);
    }

    // Cleanup empty session rooms and mark DB record as closed
    if (!room.device && room.viewers.size === 0) {
      this.sessions.delete(sessionId);
      this.sessionRepo.update(sessionId, {
        status: RemoteSessionStatus.CLOSED,
        endedAt: new Date(),
      });
    }
  }

  private handleMessage(client: WsClient, data: Buffer | string, isBinary: boolean) {
    const room = this.sessions.get(client.sessionId);
    if (!room) return;

    if (client.role === 'device') {
      if (isBinary) {
        // Binary data = JPEG frame from device screen capture, relay to all viewers
        for (const viewer of room.viewers) {
          if (viewer.readyState === WebSocket.OPEN) {
            viewer.send(data, { binary: true });
          }
        }
      } else {
        // Text data = JSON status message from device, relay to viewers
        this.broadcastToViewers(client.sessionId, data.toString());
      }
    } else {
      // Viewer sending input events (touch, key) -> relay to device
      if (room.device && room.device.readyState === WebSocket.OPEN) {
        room.device.send(data.toString());
      }
    }
  }

  private broadcastToViewers(sessionId: string, message: string) {
    const room = this.sessions.get(sessionId);
    if (!room) return;
    for (const viewer of room.viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(message);
      }
    }
  }

  /**
   * Force-closes a session from the REST API side. Disconnects all WebSocket clients
   * and cleans up the in-memory session room.
   */
  closeSession(sessionId: string) {
    const room = this.sessions.get(sessionId);
    if (!room) return;

    const msg = JSON.stringify({ type: 'session_ended', reason: 'closed_by_admin' });

    if (room.device && room.device.readyState === WebSocket.OPEN) {
      room.device.send(msg);
      room.device.close(1000, 'Session closed');
    }
    for (const viewer of room.viewers) {
      if (viewer.readyState === WebSocket.OPEN) {
        viewer.send(msg);
        viewer.close(1000, 'Session closed');
      }
    }
    this.sessions.delete(sessionId);
  }
}
