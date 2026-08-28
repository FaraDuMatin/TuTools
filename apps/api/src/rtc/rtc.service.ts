import { Injectable } from '@nestjs/common';
import { AccessToken } from 'livekit-server-sdk';
import { requireEnv } from '../env.js';

/**
 * Longer than any tutoring session will run.
 *
 * This is not laziness about token lifetime: LiveKit's client reconnects with
 * the token it already holds, so a TTL shorter than the call turns a recoverable
 * network blip into a dead session — the exact failure step 2 exists to prevent.
 * The token is only useful for joining one named room as one identity.
 */
const TOKEN_TTL_SECONDS = 60 * 60 * 4;

@Injectable()
export class RtcService {
  private readonly apiKey = requireEnv('LIVEKIT_API_KEY');
  private readonly apiSecret = requireEnv('LIVEKIT_API_SECRET');
  private readonly wsUrl = requireEnv('LIVEKIT_WS_URL');

  /**
   * Mints a join token. The API secret signs it here and never leaves the
   * server — the browser only ever sees the derived, room-scoped JWT.
   */
  async mintToken(params: { room: string; identity: string; name: string }) {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      // The user's own id, so a participant in a room is traceable to a row in
      // our database. Step 3's attendance events are keyed off this.
      identity: params.identity,
      name: params.name,
      ttl: TOKEN_TTL_SECONDS,
    });

    token.addGrant({
      room: params.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Used by the whiteboard in step 4; harmless now.
      canPublishData: true,
    });

    return { token: await token.toJwt(), url: this.wsUrl };
  }
}
