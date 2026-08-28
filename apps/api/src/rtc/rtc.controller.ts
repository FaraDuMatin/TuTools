import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/session.decorator.js';
import type { AuthSession } from '../auth/auth.js';
import { RtcService } from './rtc.service.js';

/**
 * Room names are the only thing a client controls here, so they are constrained
 * rather than trusted: a room name reaches LiveKit's API and will become part of
 * a URL. Letting through slashes or spaces invites confusion at best.
 */
const ROOM_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

@Controller('api/rtc')
export class RtcController {
  constructor(private readonly rtc: RtcService) {}

  /**
   * Hands the caller a token for `room`.
   *
   * Protected by the global AuthGuard, so an anonymous caller gets 401 and the
   * identity written into the token is the server's idea of who they are — not
   * a name the client supplies.
   *
   * KNOWN GAP (closes in step 3): any signed-in user may join any room they can
   * name. Real membership — "is this person the tutor or the student on this
   * session?" — needs the TutoringSession table, which does not exist yet.
   * Until then this is authenticated but not authorised.
   */
  @Post('token')
  async token(
    @Body() body: { room?: unknown },
    @CurrentUser() user: AuthSession['user'],
  ) {
    const room = typeof body?.room === 'string' ? body.room.trim() : '';

    if (!ROOM_NAME.test(room)) {
      throw new BadRequestException(
        'room must be 1-64 characters of letters, digits, hyphen or underscore',
      );
    }

    return this.rtc.mintToken({
      room,
      identity: user.id,
      name: user.name,
    });
  }
}
