import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { WebSocket } from 'ws';
import { PrismaService } from '../prisma/prisma.service.js';
import { reconcile, type SyncElement } from './reconcile.js';
import type { SessionParticipantRole } from '../generated/prisma/enums.js';

/** How long a room may hold unsaved strokes. Bounds what a crash can lose. */
const SAVE_DEBOUNCE_MS = 5_000;

/** Refuse absurd payloads rather than trying to store them. */
const MAX_ELEMENTS_PER_MESSAGE = 5_000;

export interface Client {
  socket: WebSocket;
  userId: string;
  name: string;
  role: SessionParticipantRole;
}

interface Room {
  /** Authoritative element state, by element id. */
  elements: Map<string, SyncElement>;
  clients: Set<Client>;
  /** Unsaved changes since the last write. */
  dirty: boolean;
  saveTimer: NodeJS.Timeout | null;
}

/**
 * Holds the live state of every open whiteboard.
 *
 * Rooms live in memory and are the authority while anyone is connected;
 * Postgres is the durable copy. **This means exactly one API instance.** A
 * second would keep its own rooms and the two would silently diverge. That is
 * fine on one VPS and must be solved before scaling out — Redis pub/sub, or
 * pinning a session to an instance.
 */
@Injectable()
export class WhiteboardService implements OnModuleDestroy {
  private readonly logger = new Logger(WhiteboardService.name);
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attaches a client and sends it the current board.
   *
   * The row is created on first join rather than when a session is scheduled,
   * so sessions whose board is never opened cost nothing.
   */
  async join(sessionId: string, client: Client): Promise<void> {
    let room = this.rooms.get(sessionId);

    if (!room) {
      const stored = await this.prisma.db.whiteboard.upsert({
        where: { sessionId },
        create: { sessionId },
        update: {},
      });
      const elements = (stored.elements as unknown as SyncElement[]) ?? [];
      room = {
        elements: new Map(elements.map((e) => [e.id, e])),
        clients: new Set(),
        dirty: false,
        saveTimer: null,
      };
      this.rooms.set(sessionId, room);
    }

    room.clients.add(client);

    this.send(client, {
      type: 'init',
      elements: [...room.elements.values()],
      you: { userId: client.userId, readOnly: client.role === 'OBSERVER' },
      collaborators: [...room.clients]
        .filter((c) => c !== client)
        .map((c) => ({ userId: c.userId, name: c.name })),
    });

    this.broadcast(room, client, {
      type: 'peer-joined',
      userId: client.userId,
      name: client.name,
    });
  }

  async leave(sessionId: string, client: Client): Promise<void> {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    room.clients.delete(client);
    this.broadcast(room, client, {
      type: 'peer-left',
      userId: client.userId,
    });

    if (room.clients.size === 0) {
      // Last one out saves and turns off the lights. Waiting for the debounce
      // would keep an idle room resident for no reason.
      if (room.saveTimer) clearTimeout(room.saveTimer);
      if (room.dirty) await this.save(sessionId, room);
      this.rooms.delete(sessionId);
    }
  }

  /**
   * Applies a client's element updates and fans them out.
   *
   * Returns an error string when the update is refused, so the caller can tell
   * the client why rather than dropping it silently.
   */
  handleUpdate(
    sessionId: string,
    client: Client,
    elements: unknown,
  ): string | null {
    // The check that actually enforces read-only. `viewModeEnabled` in the
    // browser is a courtesy; this is the rule.
    if (client.role === 'OBSERVER') return 'read-only';

    if (!Array.isArray(elements)) return 'elements must be an array';
    if (elements.length > MAX_ELEMENTS_PER_MESSAGE) return 'too many elements';

    const incoming = elements.filter(isSyncElement);
    if (incoming.length === 0) return null;

    const room = this.rooms.get(sessionId);
    if (!room) return 'room is not open';

    const before = room.elements.size;
    const merged = reconcile([...room.elements.values()], incoming);
    room.elements = new Map(merged.map((e) => [e.id, e]));

    // Relay what the sender sent, not the whole board: peers run the same
    // reconciliation and will reject anything stale on their side.
    this.broadcast(room, client, { type: 'update', elements: incoming });

    this.markDirty(sessionId, room);
    if (room.elements.size < before) {
      this.logger.warn(`Room ${sessionId} shrank; that should not happen`);
    }
    return null;
  }

  /** Cursor positions. Never persisted — they are meaningless a second later. */
  handlePointer(sessionId: string, client: Client, payload: unknown): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;

    this.broadcast(room, client, {
      type: 'pointer',
      userId: client.userId,
      name: client.name,
      payload,
    });
  }

  private markDirty(sessionId: string, room: Room) {
    room.dirty = true;
    if (room.saveTimer) return;

    // Trailing debounce. A write per stroke would hammer Postgres; a write per
    // session would risk losing an hour of a lesson.
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null;
      void this.save(sessionId, room);
    }, SAVE_DEBOUNCE_MS);
  }

  private async save(sessionId: string, room: Room): Promise<void> {
    const elements = [...room.elements.values()];
    room.dirty = false;
    try {
      await this.prisma.db.whiteboard.update({
        where: { sessionId },
        data: {
          elements: elements as never,
          revision: { increment: 1 },
        },
      });
    } catch (error) {
      // Put the flag back: a failed write must not look like a saved one.
      room.dirty = true;
      this.logger.error(`Failed to save whiteboard ${sessionId}`, error);
    }
  }

  /** Flush everything on shutdown rather than dropping unsaved strokes. */
  async onModuleDestroy(): Promise<void> {
    for (const [sessionId, room] of this.rooms) {
      if (room.saveTimer) clearTimeout(room.saveTimer);
      if (room.dirty) await this.save(sessionId, room);
    }
  }

  private send(client: Client, message: unknown) {
    if (client.socket.readyState === client.socket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private broadcast(room: Room, sender: Client, message: unknown) {
    const encoded = JSON.stringify(message);
    for (const client of room.clients) {
      if (client === sender) continue;
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.send(encoded);
      }
    }
  }
}

function isSyncElement(value: unknown): value is SyncElement {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SyncElement).id === 'string' &&
    typeof (value as SyncElement).version === 'number' &&
    typeof (value as SyncElement).versionNonce === 'number'
  );
}
