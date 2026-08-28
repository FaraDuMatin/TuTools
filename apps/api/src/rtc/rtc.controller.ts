import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/session.decorator.js';
import type { AuthSession } from '../auth/auth.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { RtcService } from './rtc.service.js';

@Controller('api/rtc')
export class RtcController {
  constructor(
    private readonly rtc: RtcService,
    private readonly sessions: SessionsService,
  ) {}

  /**
   * Hands the caller a token for a session they are allowed to join.
   *
   * The client names a `sessionId`, never a room. Room names are generated
   * server-side and never accepted as input, so membership is what grants
   * access rather than knowing a string. `getJoinable` decides:
   * 404 unknown, 403 not a participant, 409 already ended.
   */
  @Post('token')
  async token(
    @Body() body: { sessionId?: unknown },
    @CurrentUser() user: AuthSession['user'],
  ) {
    const sessionId =
      typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    if (!sessionId) {
      throw new BadRequestException('sessionId is required');
    }

    const session = await this.sessions.getJoinable(sessionId, user.id);

    return this.rtc.mintToken({
      room: session.roomName,
      identity: user.id,
      name: user.name,
    });
  }
}
