import { projectSession, type ProjectionEvent } from './session-projection.js';

const TUTOR = 'tutor-1';
const STUDENT = 'student-1';
const MEMBERS = [TUTOR, STUDENT];

const at = (iso: string) => new Date(iso);

/** A whole session: starts 10:00:00, both leave 10:30:00, room closes 10:35:00. */
const fullSession = (): ProjectionEvent[] => [
  { type: 'SESSION_CREATED', actorId: TUTOR, occurredAt: at('2026-01-01T09:00:00Z') },
  { type: 'ROOM_STARTED', actorId: null, occurredAt: at('2026-01-01T10:00:00Z') },
  { type: 'PARTICIPANT_JOINED', actorId: TUTOR, occurredAt: at('2026-01-01T10:00:05Z') },
  { type: 'PARTICIPANT_JOINED', actorId: STUDENT, occurredAt: at('2026-01-01T10:01:00Z') },
  { type: 'PARTICIPANT_LEFT', actorId: STUDENT, occurredAt: at('2026-01-01T10:29:00Z') },
  { type: 'PARTICIPANT_LEFT', actorId: TUTOR, occurredAt: at('2026-01-01T10:30:00Z') },
  // Fired 5 minutes later by empty_timeout, NOT when the call actually ended.
  { type: 'ROOM_FINISHED', actorId: null, occurredAt: at('2026-01-01T10:35:00Z') },
];

describe('projectSession', () => {
  it('derives status, start, end and duration from the log', () => {
    const result = projectSession(fullSession(), MEMBERS);

    expect(result.status).toBe('ENDED');
    expect(result.startedAt).toEqual(at('2026-01-01T10:00:00Z'));
    expect(result.endedAt).toEqual(at('2026-01-01T10:30:00Z'));
    expect(result.durationSeconds).toBe(30 * 60);
  });

  // The regression that matters: room_finished lags the real end by
  // empty_timeout (300s), so reading endedAt from it inflates every session.
  it('ends at the last departure, not when LiveKit closed the room', () => {
    const result = projectSession(fullSession(), MEMBERS);

    expect(result.endedAt).toEqual(at('2026-01-01T10:30:00Z'));
    expect(result.endedAt).not.toEqual(at('2026-01-01T10:35:00Z'));
    expect(result.durationSeconds).toBe(1800); // not 2100
  });

  // Webhooks arrive out of order and are retried. Recomputing from the whole
  // log has to make delivery order irrelevant.
  it('is independent of event order', () => {
    const expected = projectSession(fullSession(), MEMBERS);

    const shuffles = [
      [...fullSession()].reverse(),
      [...fullSession()].sort(() => 0.5 - Math.random()),
      [...fullSession()].sort(() => 0.5 - Math.random()),
      [...fullSession()].sort(() => 0.5 - Math.random()),
    ];

    for (const events of shuffles) {
      const result = projectSession(events, MEMBERS);
      expect(result.status).toBe(expected.status);
      expect(result.startedAt).toEqual(expected.startedAt);
      expect(result.endedAt).toEqual(expected.endedAt);
      expect(result.durationSeconds).toBe(expected.durationSeconds);
      expect(result.attendance).toEqual(expected.attendance);
    }
  });

  it('duplicated events do not change the result', () => {
    const once = projectSession(fullSession(), MEMBERS);
    const twice = projectSession(
      [...fullSession(), ...fullSession()],
      MEMBERS,
    );

    expect(twice.startedAt).toEqual(once.startedAt);
    expect(twice.endedAt).toEqual(once.endedAt);
    expect(twice.durationSeconds).toBe(once.durationSeconds);
  });

  it('records per-participant attendance', () => {
    const { attendance } = projectSession(fullSession(), MEMBERS);

    expect(attendance.get(TUTOR)).toEqual({
      firstJoinedAt: at('2026-01-01T10:00:05Z'),
      lastLeftAt: at('2026-01-01T10:30:00Z'),
      totalSeconds: 1795,
    });
    expect(attendance.get(STUDENT)).toEqual({
      firstJoinedAt: at('2026-01-01T10:01:00Z'),
      lastLeftAt: at('2026-01-01T10:29:00Z'),
      totalSeconds: 1680,
    });
  });

  it('credits both stretches when someone drops and rejoins', () => {
    const events: ProjectionEvent[] = [
      { type: 'PARTICIPANT_JOINED', actorId: STUDENT, occurredAt: at('2026-01-01T10:00:00Z') },
      { type: 'PARTICIPANT_CONNECTION_ABORTED', actorId: STUDENT, occurredAt: at('2026-01-01T10:10:00Z') },
      { type: 'PARTICIPANT_JOINED', actorId: STUDENT, occurredAt: at('2026-01-01T10:15:00Z') },
      { type: 'PARTICIPANT_LEFT', actorId: STUDENT, occurredAt: at('2026-01-01T10:20:00Z') },
      { type: 'ROOM_FINISHED', actorId: null, occurredAt: at('2026-01-01T10:25:00Z') },
    ];

    // 10 minutes + 5 minutes present, not the 20-minute wall-clock span.
    expect(projectSession(events, MEMBERS).attendance.get(STUDENT)?.totalSeconds)
      .toBe(15 * 60);
  });

  // Both laptops die: LiveKit still reports the departures and closes the room.
  it('closes a session nobody ended cleanly', () => {
    const events: ProjectionEvent[] = [
      { type: 'ROOM_STARTED', actorId: null, occurredAt: at('2026-01-01T10:00:00Z') },
      { type: 'PARTICIPANT_JOINED', actorId: TUTOR, occurredAt: at('2026-01-01T10:00:01Z') },
      { type: 'PARTICIPANT_CONNECTION_ABORTED', actorId: TUTOR, occurredAt: at('2026-01-01T10:45:00Z') },
      { type: 'ROOM_FINISHED', actorId: null, occurredAt: at('2026-01-01T10:50:00Z') },
    ];

    const result = projectSession(events, MEMBERS);
    expect(result.status).toBe('ENDED');
    expect(result.durationSeconds).toBe(45 * 60);
  });

  it('survives room_finished with no start', () => {
    const result = projectSession(
      [{ type: 'ROOM_FINISHED', actorId: null, occurredAt: at('2026-01-01T10:00:00Z') }],
      MEMBERS,
    );

    expect(result.startedAt).toBeNull();
    expect(result.durationSeconds).toBeNull();
    expect(result.status).toBe('ENDED');
  });

  it('is LIVE while people are still in the room', () => {
    const result = projectSession(
      [
        { type: 'ROOM_STARTED', actorId: null, occurredAt: at('2026-01-01T10:00:00Z') },
        { type: 'PARTICIPANT_JOINED', actorId: TUTOR, occurredAt: at('2026-01-01T10:00:01Z') },
      ],
      MEMBERS,
    );

    expect(result.status).toBe('LIVE');
    expect(result.endedAt).toBeNull();
    // Still in the room, so a total would be stale the moment it was written.
    expect(result.attendance.get(TUTOR)?.totalSeconds).toBeNull();
  });

  it('cancellation outranks everything', () => {
    const result = projectSession(
      [
        ...fullSession(),
        { type: 'SESSION_CANCELLED', actorId: TUTOR, occurredAt: at('2026-01-01T09:30:00Z') },
      ],
      MEMBERS,
    );

    expect(result.status).toBe('CANCELLED');
  });

  it('a session with no events is still SCHEDULED', () => {
    const result = projectSession([], MEMBERS);

    expect(result.status).toBe('SCHEDULED');
    expect(result.startedAt).toBeNull();
    expect(result.attendance.size).toBe(0);
  });
});
