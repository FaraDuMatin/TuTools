import type {
  SessionEventType,
  TutoringSessionStatus,
} from '../generated/prisma/enums.js';

/**
 * The only three fields of an event this computation needs. Kept narrow, and
 * free of any Prisma import, so the whole thing is a pure function of its
 * arguments — which is what makes the order-independence test possible.
 */
export interface ProjectionEvent {
  type: SessionEventType;
  actorId: string | null;
  occurredAt: Date;
}

export interface ParticipantAttendance {
  firstJoinedAt: Date | null;
  lastLeftAt: Date | null;
  totalSeconds: number | null;
}

export interface SessionProjection {
  status: TutoringSessionStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  /** Keyed by userId. Only contains people who actually showed up. */
  attendance: Map<string, ParticipantAttendance>;
}

const JOIN_TYPES: SessionEventType[] = ['PARTICIPANT_JOINED'];
const LEAVE_TYPES: SessionEventType[] = [
  'PARTICIPANT_LEFT',
  'PARTICIPANT_CONNECTION_ABORTED',
];

const min = (a: Date | null, b: Date) => (a === null || b < a ? b : a);
const max = (a: Date | null, b: Date) => (a === null || b > a ? b : a);

/**
 * Derives a session's state from its event log.
 *
 * Recomputed from *every* event each time one arrives, rather than patching the
 * previous state. That is deliberate: webhook deliveries arrive out of order and
 * more than once, and a fold over the whole log is immune to both by
 * construction. It costs one small read per event.
 */
export function projectSession(
  events: ProjectionEvent[],
  participantIds: string[],
): SessionProjection {
  // Sorting here rather than trusting the caller is what makes the result
  // independent of delivery order.
  const ordered = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
  );

  let startedAt: Date | null = null;
  let lastPresenceAt: Date | null = null;
  let roomFinishedAt: Date | null = null;
  let cancelled = false;

  for (const event of ordered) {
    if (event.type === 'SESSION_CANCELLED') cancelled = true;
    if (event.type === 'ROOM_STARTED' || JOIN_TYPES.includes(event.type)) {
      startedAt = min(startedAt, event.occurredAt);
    }
    if (LEAVE_TYPES.includes(event.type)) {
      lastPresenceAt = max(lastPresenceAt, event.occurredAt);
    }
    if (event.type === 'ROOM_FINISHED') {
      roomFinishedAt = max(roomFinishedAt, event.occurredAt);
    }
  }

  // The non-obvious line, and the one that matters most.
  //
  // LiveKit fires room_finished `empty_timeout` seconds AFTER the last person
  // leaves (300s by default). Taking endedAt from that timestamp would inflate
  // every session by up to five minutes — and duration is a CEO metric, so the
  // error would land directly in the number the business is run on. The last
  // presence event is the truthful end; room close is only a fallback for a
  // session that somehow recorded no departure.
  const endedAt =
    roomFinishedAt === null ? null : (lastPresenceAt ?? roomFinishedAt);

  const durationSeconds =
    startedAt !== null && endedAt !== null
      ? Math.max(
          0,
          Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
        )
      : null;

  let status: TutoringSessionStatus;
  if (cancelled) status = 'CANCELLED';
  else if (endedAt !== null) status = 'ENDED';
  else if (startedAt !== null) status = 'LIVE';
  else status = 'SCHEDULED';

  return {
    status,
    startedAt,
    endedAt,
    durationSeconds,
    attendance: projectAttendance(ordered, participantIds, endedAt),
  };
}

/**
 * Per-person attendance, paired join→leave so a participant who drops and
 * reconnects is credited for both stretches rather than the wall-clock span.
 */
function projectAttendance(
  ordered: ProjectionEvent[],
  participantIds: string[],
  endedAt: Date | null,
): Map<string, ParticipantAttendance> {
  const attendance = new Map<string, ParticipantAttendance>();

  for (const userId of participantIds) {
    const own = ordered.filter((event) => event.actorId === userId);
    if (own.length === 0) continue;

    let firstJoinedAt: Date | null = null;
    let lastLeftAt: Date | null = null;
    let openedAt: Date | null = null;
    let seconds = 0;

    for (const event of own) {
      if (JOIN_TYPES.includes(event.type)) {
        firstJoinedAt = min(firstJoinedAt, event.occurredAt);
        // A second join without a leave means we missed the leave; keep the
        // earlier open rather than restarting the clock.
        openedAt ??= event.occurredAt;
      } else if (LEAVE_TYPES.includes(event.type)) {
        lastLeftAt = max(lastLeftAt, event.occurredAt);
        if (openedAt !== null) {
          seconds += Math.max(
            0,
            Math.floor((event.occurredAt.getTime() - openedAt.getTime()) / 1000),
          );
          openedAt = null;
        }
      }
    }

    // Still in the room when the session closed: credit up to the end. If the
    // session is still live, totalSeconds stays null rather than being a
    // snapshot that is stale the moment it is written.
    if (openedAt !== null && endedAt !== null) {
      seconds += Math.max(
        0,
        Math.floor((endedAt.getTime() - openedAt.getTime()) / 1000),
      );
      openedAt = null;
    }

    attendance.set(userId, {
      firstJoinedAt,
      lastLeftAt,
      totalSeconds: openedAt === null ? seconds : null,
    });
  }

  return attendance;
}
