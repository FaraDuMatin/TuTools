import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Injectable,
  InternalServerErrorException,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { WebhookReceiver } from 'livekit-server-sdk';
import { Public } from '../auth/public.decorator.js';
import { requireEnv } from '../env.js';
import { SessionsService } from '../sessions/sessions.service.js';
import type { SessionEventType } from '../generated/prisma/enums.js';

/**
 * LiveKit event names we store. Anything absent — track_*, egress_*, ingress_* —
 * falls through to the "ignored" path rather than being an error, so LiveKit is
 * not told to retry something we simply do not model.
 */
const EVENT_TYPES: Record<string, SessionEventType> = {
  room_started: 'ROOM_STARTED',
  room_finished: 'ROOM_FINISHED',
  participant_joined: 'PARTICIPANT_JOINED',
  participant_left: 'PARTICIPANT_LEFT',
  participant_connection_aborted: 'PARTICIPANT_CONNECTION_ABORTED',
};

@Injectable()
class LiveKitWebhookVerifier {
  // Same credentials that sign join tokens; LiveKit needs no separate secret.
  readonly receiver = new WebhookReceiver(
    requireEnv('LIVEKIT_API_KEY'),
    requireEnv('LIVEKIT_API_SECRET'),
  );
}

@Controller('api/rtc')
export class RtcWebhookController {
  private readonly logger = new Logger(RtcWebhookController.name);

  constructor(
    private readonly sessions: SessionsService,
    private readonly verifier: LiveKitWebhookVerifier,
  ) {}

  /**
   * Session events, reported by the media server rather than by a browser.
   *
   * This is what makes attendance survive a client crash: LiveKit notices the
   * dead peer connection and tells us, so the record is written even though the
   * participant's machine sent nothing.
   *
   * @Public() does NOT mean unauthenticated. LiveKit carries no session cookie;
   * instead the Authorization header is a JWT signed with LIVEKIT_API_SECRET
   * whose sha256 claim must equal a hash of the exact body posted. A request
   * failing either check never reaches the database.
   */
  @Public()
  @HttpCode(200)
  @Post('webhook')
  async receive(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ) {
    // The raw-body middleware hands over a Buffer. Anything else means the
    // middleware ordering in main.ts has been broken — fail loudly rather than
    // attempt verification against re-serialised bytes that can never match.
    if (!Buffer.isBuffer(body)) {
      this.logger.error(
        'Webhook body is not a Buffer — useLiveKitRawBody() must run before express.json() in main.ts',
      );
      throw new InternalServerErrorException('Webhook body was consumed');
    }

    let event;
    try {
      event = await this.verifier.receiver.receive(
        body.toString('utf8'),
        authorization,
      );
    } catch {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const type = EVENT_TYPES[event.event];
    const roomName = event.room?.name;
    // Same shape as an unknown room, so every "we did nothing" answer looks the
    // same to a caller and to a log.
    if (!type || !roomName) return { ok: true, outcome: 'ignored' as const };

    const outcome = await this.sessions.recordLiveKitEvent({
      roomName,
      type,
      externalId: event.id || null,
      actorIdentity: event.participant?.identity ?? null,
      // LiveKit sends seconds as a bigint. Fall back to arrival time rather than
      // writing an epoch-zero timestamp that would wreck every duration.
      occurredAt: event.createdAt
        ? new Date(Number(event.createdAt) * 1000)
        : new Date(),
      // The parsed JSON, never the decoded protobuf object: that carries bigint
      // fields and JSON.stringify throws on those, which Prisma would hit when
      // writing the Json column.
      payload: safeParse(body.toString('utf8')),
      roomSid: event.room?.sid ?? null,
    });

    return { ok: true, outcome };
  }
}

export const WEBHOOK_PROVIDERS = [LiveKitWebhookVerifier];

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
