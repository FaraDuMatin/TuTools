import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { auth } from '../auth/auth.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { WhiteboardService, type Client } from './whiteboard.service.js';

export const WHITEBOARD_WS_PATH = '/ws/whiteboard';

/** Refuse oversized frames at the socket rather than after parsing. */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/**
 * The whiteboard WebSocket, attached to the same HTTP server Nest already
 * listens on — one process, one port, per the modular-monolith rule.
 *
 * `@nestjs/platform-ws` is deliberately not used: it replaces the platform
 * adapter, and the upgrade still needs hand-written auth, so it would add a
 * dependency without removing the work.
 */
@Injectable()
export class WhiteboardGateway implements OnModuleInit {
  private readonly logger = new Logger(WhiteboardGateway.name);
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
  });

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sessions: SessionsService,
    private readonly whiteboard: WhiteboardService,
  ) {}

  onModuleInit(): void {
    const server = this.adapterHost.httpAdapter.getHttpServer() as Server;
    server.on('upgrade', (request, socket, head) => {
      void this.handleUpgrade(request, socket, head);
    });
  }

  /**
   * Authorises before the socket exists.
   *
   * Nest's global AuthGuard never runs here — it is an HTTP-pipeline guard, and
   * an upgrade bypasses the pipeline entirely. So the same two checks are made
   * by hand, using the same functions the HTTP side uses. There is deliberately
   * no second permission model and no bespoke token: the cookie identifies the
   * user, and `getJoinable` decides whether they may be in this session.
   */
  private async handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    let url: URL;
    try {
      url = new URL(request.url ?? '', `http://${request.headers.host}`);
    } catch {
      return reject(socket, 400, 'Bad Request');
    }

    // Leave other upgrade paths alone — this server does not own them.
    if (url.pathname !== WHITEBOARD_WS_PATH) return;

    const sessionId = url.searchParams.get('session');
    if (!sessionId) return reject(socket, 400, 'Bad Request');

    try {
      // Identical to auth.guard.ts. The upgrade request carries the session
      // cookie because web and API are same-site.
      const authSession = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!authSession) return reject(socket, 401, 'Unauthorized');

      // Throws 404 / 403 / 409 exactly as it does for the LiveKit token route,
      // so a person who cannot join the call cannot join its board either.
      const tutoringSession = await this.sessions.getJoinable(
        sessionId,
        authSession.user.id,
      );

      const participant = tutoringSession.participants.find(
        (p) => p.userId === authSession.user.id,
      );
      if (!participant) return reject(socket, 403, 'Forbidden');

      this.wss.handleUpgrade(request, socket, head, (ws) => {
        this.onConnection(ws, sessionId, {
          socket: ws,
          userId: authSession.user.id,
          name: authSession.user.name,
          role: participant.role,
        });
      });
    } catch (error) {
      const status =
        typeof (error as { getStatus?: () => number })?.getStatus === 'function'
          ? (error as { getStatus: () => number }).getStatus()
          : 500;
      if (status >= 500) {
        this.logger.error('Whiteboard upgrade failed', error);
      }
      reject(socket, status, 'Rejected');
    }
  }

  private onConnection(ws: WebSocket, sessionId: string, client: Client): void {
    void this.whiteboard.join(sessionId, client);

    ws.on('message', (raw) => {
      let message: { type?: string; elements?: unknown; payload?: unknown };
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (message.type) {
        case 'update': {
          const error = this.whiteboard.handleUpdate(
            sessionId,
            client,
            message.elements,
          );
          if (error) ws.send(JSON.stringify({ type: 'error', reason: error }));
          break;
        }
        case 'pointer':
          this.whiteboard.handlePointer(sessionId, client, message.payload);
          break;
        default:
          break;
      }
    });

    const close = () => void this.whiteboard.leave(sessionId, client);
    ws.on('close', close);
    ws.on('error', close);
  }
}

/** Ends an upgrade before a WebSocket is created, with a real HTTP status. */
function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
