import '../src/env';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AccessToken } from 'livekit-server-sdk';
import { RtcWebhookController, WEBHOOK_PROVIDERS } from '../src/rtc/rtc-webhook.controller';
import { useLiveKitRawBody } from '../src/rtc/webhook-raw-body';
import { SessionsService } from '../src/sessions/sessions.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { prisma } from '../src/prisma/prisma.client';

/**
 * Hits the real database, deliberately.
 *
 * Idempotency and the persisted projection are the two claims of step 3 that a
 * mock cannot support: "we do not double-write a retry" is only meaningful
 * against a real unique index.
 *
 * AppModule is NOT imported — see the note in jest-integration.json. The global
 * AuthGuard is therefore absent, which costs nothing here: the 401 this suite
 * cares about comes from signature verification inside the controller, not from
 * the guard.
 */
const API_KEY = process.env.LIVEKIT_API_KEY!;
const API_SECRET = process.env.LIVEKIT_API_SECRET!;

/** Signs a body the way LiveKit does — a JWT whose sha256 claim hashes the exact bytes. */
async function sign(body: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET);
  token.sha256 = createHash('sha256').update(body).digest('base64');
  return token.toJwt();
}

function webhookBody(params: {
  event: string;
  roomName: string;
  identity?: string;
  at: Date;
  id?: string;
}): string {
  return JSON.stringify({
    event: params.event,
    id: params.id ?? randomUUID(),
    createdAt: Math.floor(params.at.getTime() / 1000),
    room: { name: params.roomName, sid: 'RM_test' },
    ...(params.identity ? { participant: { identity: params.identity } } : {}),
  });
}

describe('LiveKit webhook → database', () => {
  let app: INestApplication;
  let tutorId: string;
  let studentId: string;
  let sessionId: string;
  let roomName: string;

  const post = (body: string, auth?: string) => {
    const req = request(app.getHttpServer())
      .post('/api/rtc/webhook')
      .set('Content-Type', 'application/webhook+json');
    if (auth) req.set('Authorization', auth);
    return req.send(body);
  };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [RtcWebhookController],
      providers: [SessionsService, PrismaService, ...WEBHOOK_PROVIDERS],
    }).compile();

    app = moduleRef.createNestApplication();
    // The same wiring main.ts uses; without it the controller gets a parsed
    // object and every signature check fails.
    useLiveKitRawBody(app);
    await app.init();

    const suffix = randomBytes(6).toString('hex');
    tutorId = `test-tutor-${suffix}`;
    studentId = `test-student-${suffix}`;
    roomName = `test-${suffix}`;

    await prisma.user.createMany({
      data: [
        { id: tutorId, name: 'Test Tutor', email: `${tutorId}@example.test`, role: 'TUTOR' },
        { id: studentId, name: 'Test Student', email: `${studentId}@example.test`, role: 'STUDENT' },
      ],
    });

    const session = await prisma.tutoringSession.create({
      data: {
        roomName,
        createdById: tutorId,
        participants: {
          create: [
            { userId: tutorId, role: 'TUTOR' },
            { userId: studentId, role: 'STUDENT' },
          ],
        },
      },
    });
    sessionId = session.id;
  });

  afterAll(async () => {
    await prisma.sessionEvent.deleteMany({ where: { sessionId } });
    await prisma.sessionParticipant.deleteMany({ where: { sessionId } });
    await prisma.tutoringSession.deleteMany({ where: { id: sessionId } });
    await prisma.user.deleteMany({ where: { id: { in: [tutorId, studentId] } } });
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects an unsigned delivery and writes nothing', async () => {
    const body = webhookBody({ event: 'room_finished', roomName, at: new Date() });
    await post(body).expect(401);
    expect(await prisma.sessionEvent.count({ where: { sessionId } })).toBe(0);
  });

  it('rejects a body that does not match its signature', async () => {
    const signed = webhookBody({ event: 'room_started', roomName, at: new Date() });
    const auth = await sign(signed);
    const tampered = webhookBody({ event: 'room_started', roomName, at: new Date() });

    await post(tampered, auth).expect(401);
    expect(await prisma.sessionEvent.count({ where: { sessionId } })).toBe(0);
  });

  it('ignores an unknown room without asking for a retry', async () => {
    const body = webhookBody({ event: 'room_finished', roomName: 'no-such-room', at: new Date() });
    // 200, not 404: a 404 would make LiveKit retry forever for a room that will
    // never exist here.
    const res = await post(body, await sign(body)).expect(200);
    expect(res.body.outcome).toBe('ignored');
  });

  it('ignores event types it does not model', async () => {
    const body = webhookBody({ event: 'track_published', roomName, at: new Date() });
    const res = await post(body, await sign(body)).expect(200);

    expect(res.body.outcome).toBe('ignored');
    expect(await prisma.sessionEvent.count({ where: { sessionId } })).toBe(0);
  });

  it('projects a full lifecycle delivered in reverse order', async () => {
    const deliveries = [
      webhookBody({ event: 'room_started', roomName, at: new Date('2026-02-01T10:00:00Z') }),
      webhookBody({ event: 'participant_joined', roomName, identity: tutorId, at: new Date('2026-02-01T10:00:10Z') }),
      webhookBody({ event: 'participant_joined', roomName, identity: studentId, at: new Date('2026-02-01T10:01:00Z') }),
      webhookBody({ event: 'participant_left', roomName, identity: studentId, at: new Date('2026-02-01T10:29:00Z') }),
      webhookBody({ event: 'participant_left', roomName, identity: tutorId, at: new Date('2026-02-01T10:30:00Z') }),
      webhookBody({ event: 'room_finished', roomName, at: new Date('2026-02-01T10:35:00Z') }),
    ].reverse();

    for (const body of deliveries) {
      await post(body, await sign(body)).expect(200);
    }

    const session = await prisma.tutoringSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe('ENDED');
    expect(session.startedAt?.toISOString()).toBe('2026-02-01T10:00:00.000Z');
    // The last departure, not the room close five minutes later.
    expect(session.endedAt?.toISOString()).toBe('2026-02-01T10:30:00.000Z');
    expect(session.durationSeconds).toBe(1800);
    expect(session.roomSid).toBe('RM_test');

    const tutor = await prisma.sessionParticipant.findFirstOrThrow({
      where: { sessionId, userId: tutorId },
    });
    expect(tutor.firstJoinedAt?.toISOString()).toBe('2026-02-01T10:00:10.000Z');
    expect(tutor.totalSeconds).toBe(1790);
  });

  it('does not double-write a retried delivery', async () => {
    const before = await prisma.sessionEvent.count({ where: { sessionId } });
    const body = webhookBody({
      event: 'room_finished',
      roomName,
      at: new Date('2026-02-01T10:35:00Z'),
      id: 'fixed-retry-id',
    });
    const auth = await sign(body);

    const first = await post(body, auth).expect(200);
    const second = await post(body, auth).expect(200);

    expect(first.body.outcome).toBe('recorded');
    expect(second.body.outcome).toBe('duplicate');
    expect(await prisma.sessionEvent.count({ where: { sessionId } })).toBe(before + 1);
  });

  it('does not link an actor who is not a member of the session', async () => {
    const body = webhookBody({
      event: 'participant_joined',
      roomName,
      identity: 'somebody-not-in-this-session',
      at: new Date('2026-02-01T10:05:00Z'),
    });
    // Must not throw a foreign-key error — that would be a 500 and LiveKit would
    // retry a permanently poisoned event forever.
    await post(body, await sign(body)).expect(200);

    const event = await prisma.sessionEvent.findFirstOrThrow({
      where: { sessionId, occurredAt: new Date('2026-02-01T10:05:00Z') },
    });
    expect(event.actorId).toBeNull();
    expect((event.payload as any).participant.identity).toBe('somebody-not-in-this-session');
  });
});
