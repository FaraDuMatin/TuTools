import express from 'express';
import type { INestApplication } from '@nestjs/common';

export const LIVEKIT_WEBHOOK_PATH = '/api/rtc/webhook';

/**
 * Keeps the untouched request bytes for the LiveKit webhook route.
 *
 * LiveKit signs a sha256 of exactly what it posted, so a body that has been
 * parsed and re-serialised will not verify. Three constraints force this shape:
 *
 *  - main.ts calls `express.json()` globally with no path scope. Whichever
 *    parser reads the stream first wins, and json() leaves no route back to the
 *    original bytes — so this must be registered BEFORE it.
 *  - A Nest MiddlewareConsumer is too late: module middleware is wired during
 *    app.init(), after every app.use() in main.ts has already run.
 *  - LiveKit posts `application/webhook+json`, which express.json() happens to
 *    skip today. That is an accident of its default type filter, not a promise.
 *
 * Exported rather than inlined so the e2e fixture wires itself the same way and
 * cannot drift from production.
 */
export function useLiveKitRawBody(app: INestApplication): void {
  app.use(LIVEKIT_WEBHOOK_PATH, express.raw({ type: '*/*', limit: '512kb' }));
}
