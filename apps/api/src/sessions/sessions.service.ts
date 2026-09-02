import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { projectSession, type ProjectionEvent } from './session-projection.js';
import type {
  Language,
  SessionEventType,
  SessionParticipantRole,
  SessionVisibility,
} from '../generated/prisma/enums.js';

export interface CreateSessionInput {
  studentEmail: string;
  title?: string;
  scheduledFor?: Date;
  language?: Language;
  visibility?: SessionVisibility;
}

/** What the webhook controller hands over once a delivery is verified. */
export interface LiveKitEventInput {
  roomName: string;
  type: SessionEventType;
  externalId: string | null;
  /** LiveKit participant identity, which is our User.id — but never trusted as one. */
  actorIdentity: string | null;
  occurredAt: Date;
  payload: unknown;
  roomSid?: string | null;
}

export type LiveKitEventOutcome = 'recorded' | 'duplicate' | 'ignored';

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a session and its first event in one transaction.
   *
   * The log starts at creation rather than at first join, so a session nobody
   * ever attended is still a visible row with a history — which is exactly the
   * kind of thing the CEO dashboard needs to be able to show.
   */
  async create(creatorId: string, input: CreateSessionInput) {
    const email = input.studentEmail.trim().toLowerCase();
    if (!email) throw new BadRequestException('studentEmail is required');
    if (input.title !== undefined && input.title.length > 200) {
      throw new BadRequestException('title must be 200 characters or fewer');
    }

    const student = await this.findStudentByEmail(email);
    if (student.id === creatorId) {
      throw new BadRequestException('Cannot create a session with yourself');
    }

    return this.prisma.db.$transaction(async (tx) => {
      const session = await tx.tutoringSession.create({
        data: {
          roomName: newRoomName(),
          title: input.title?.trim() || null,
          scheduledFor: input.scheduledFor ?? null,
          language: input.language ?? 'FR',
          visibility: input.visibility ?? 'PRIVATE',
          createdById: creatorId,
          participants: {
            create: [
              { userId: creatorId, role: 'TUTOR' },
              { userId: student.id, role: 'STUDENT' },
            ],
          },
        },
        include: PARTICIPANT_INCLUDE,
      });

      await tx.sessionEvent.create({
        data: {
          sessionId: session.id,
          type: 'SESSION_CREATED',
          source: 'API',
          actorId: creatorId,
          occurredAt: new Date(),
        },
      });

      return session;
    });
  }

  /**
   * Student lookup is isolated here on purpose. Swapping email-only matching for
   * search, or scoping it to an organisation, changes this method and nothing
   * else.
   */
  private async findStudentByEmail(email: string) {
    const student = await this.prisma.db.user.findUnique({
      where: { email },
      select: { id: true, role: true },
    });
    if (!student) throw new NotFoundException('No user with that email');
    if (student.role !== 'STUDENT') {
      throw new BadRequestException('That user is not a student');
    }
    return student;
  }

  /** Sessions the caller takes part in — not every session in the system. */
  async listForUser(userId: string) {
    return this.prisma.db.tutoringSession.findMany({
      where: { participants: { some: { userId } } },
      include: PARTICIPANT_INCLUDE,
      orderBy: [{ scheduledFor: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
  }

  async getForUser(sessionId: string, userId: string) {
    const session = await this.prisma.db.tutoringSession.findUnique({
      where: { id: sessionId },
      include: PARTICIPANT_INCLUDE,
    });
    if (!session) throw new NotFoundException('Session not found');

    const isMember = session.participants.some((p) => p.userId === userId);
    if (!isMember && session.visibility !== 'PUBLIC') {
      // Same shape as a missing session would give a non-member, so this does
      // not become an oracle for which session ids exist.
      throw new NotFoundException('Session not found');
    }
    return session;
  }

  /**
   * The authorisation gate for joining a call. Replaces step 2's arrangement
   * where any signed-in user could join any room they could name.
   *
   * A PUBLIC session admits any signed-in user and records them as an OBSERVER,
   * so even a drop-in shows up in the attendance log rather than being invisible.
   */
  async getJoinable(sessionId: string, userId: string) {
    const session = await this.prisma.db.tutoringSession.findUnique({
      where: { id: sessionId },
      include: PARTICIPANT_INCLUDE,
    });
    if (!session) throw new NotFoundException('Session not found');

    if (session.status === 'ENDED' || session.status === 'CANCELLED') {
      throw new ConflictException('This session has ended');
    }

    const isMember = session.participants.some((p) => p.userId === userId);
    if (!isMember) {
      if (session.visibility !== 'PUBLIC') {
        throw new ForbiddenException('You are not a participant in this session');
      }
      const participant = await this.prisma.db.sessionParticipant.create({
        data: { sessionId: session.id, userId, role: 'OBSERVER' },
        include: PARTICIPANT_INCLUDE.participants.include,
      });
      // `session` was read before this row existed, so its `participants` is a
      // snapshot that does not contain the drop-in we just admitted. Callers
      // that decide from it — the whiteboard upgrade reads the caller's role
      // out of it — would otherwise reject the very person this branch let in.
      session.participants.push(participant);
    }

    return session;
  }

  async invite(
    sessionId: string,
    inviterId: string,
    email: string,
    role: SessionParticipantRole = 'STUDENT',
  ) {
    const session = await this.getForUser(sessionId, inviterId);
    const inviter = session.participants.find((p) => p.userId === inviterId);
    if (inviter?.role !== 'TUTOR') {
      throw new ForbiddenException('Only the tutor can invite');
    }

    const user = await this.prisma.db.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('No user with that email');
    if (session.participants.some((p) => p.userId === user.id)) {
      throw new ConflictException('Already a participant');
    }

    return this.prisma.db.$transaction(async (tx) => {
      await tx.sessionParticipant.create({
        data: { sessionId, userId: user.id, role },
      });
      await tx.sessionEvent.create({
        data: {
          sessionId,
          type: 'PARTICIPANT_INVITED',
          source: 'API',
          actorId: user.id,
          occurredAt: new Date(),
        },
      });
      return tx.tutoringSession.findUniqueOrThrow({
        where: { id: sessionId },
        include: PARTICIPANT_INCLUDE,
      });
    });
  }

  /**
   * Appends a verified LiveKit event and recomputes the session's projection.
   *
   * Returns 'ignored' rather than throwing for a room we do not own: a 404 would
   * make LiveKit retry forever for a room that will never exist here.
   */
  async recordLiveKitEvent(input: LiveKitEventInput): Promise<LiveKitEventOutcome> {
    const session = await this.prisma.db.tutoringSession.findUnique({
      where: { roomName: input.roomName },
      select: { id: true },
    });
    if (!session) return 'ignored';

    return this.prisma.db.$transaction(async (tx) => {
      // Serialise concurrent deliveries for this session. The projection below
      // reads every event row, so two overlapping transactions would each
      // compute from a partial view and the later commit would win with stale
      // input.
      await tx.$queryRaw`SELECT id FROM "TutoringSession" WHERE id = ${session.id} FOR UPDATE`;

      if (input.externalId) {
        const seen = await tx.sessionEvent.findUnique({
          where: { externalId: input.externalId },
          select: { id: true },
        });
        if (seen) return 'duplicate' as const;
      }

      const members = await tx.sessionParticipant.findMany({
        where: { sessionId: session.id },
        select: { userId: true },
      });
      const memberIds = members.map((m) => m.userId);

      // Only link an actor we recognise. An unexpected identity would otherwise
      // fail the foreign key, return 500, and have LiveKit retry a permanently
      // poisoned event forever. The raw identity survives in `payload`.
      const actorId =
        input.actorIdentity && memberIds.includes(input.actorIdentity)
          ? input.actorIdentity
          : null;

      await tx.sessionEvent.create({
        data: {
          sessionId: session.id,
          type: input.type,
          source: 'LIVEKIT_WEBHOOK',
          actorId,
          externalId: input.externalId,
          occurredAt: input.occurredAt,
          payload: input.payload as never,
        },
      });

      await this.recompute(tx, session.id, memberIds, input.roomSid ?? null);
      return 'recorded' as const;
    });
  }

  /**
   * Rewrites the derived columns from the full event log.
   *
   * `tx` is typed loosely because Prisma's transaction client type is not
   * exported in a form usable here; every call site passes a real one.
   */
  private async recompute(
    tx: any,
    sessionId: string,
    memberIds: string[],
    roomSid: string | null,
  ) {
    const rows: ProjectionEvent[] = await tx.sessionEvent.findMany({
      where: { sessionId },
      select: { type: true, actorId: true, occurredAt: true },
    });

    const projection = projectSession(rows, memberIds);

    await tx.tutoringSession.update({
      where: { id: sessionId },
      data: {
        status: projection.status,
        startedAt: projection.startedAt,
        endedAt: projection.endedAt,
        durationSeconds: projection.durationSeconds,
        ...(roomSid ? { roomSid } : {}),
      },
    });

    for (const [userId, attendance] of projection.attendance) {
      await tx.sessionParticipant.updateMany({
        where: { sessionId, userId },
        data: attendance,
      });
    }
  }
}

const PARTICIPANT_INCLUDE = {
  participants: {
    include: {
      user: { select: { id: true, name: true, email: true } },
    },
  },
} as const;

/**
 * 128 bits of randomness. Unguessable, and separate from the primary key so a
 * database id never travels in a URL or reaches LiveKit. Fits the
 * `[a-zA-Z0-9_-]{1,64}` shape LiveKit room names are held to.
 */
function newRoomName(): string {
  return `s-${randomBytes(16).toString('hex')}`;
}
