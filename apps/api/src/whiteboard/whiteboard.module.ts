import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { WhiteboardGateway } from './whiteboard.gateway.js';
import { WhiteboardService } from './whiteboard.service.js';

/**
 * Imports SessionsModule for `getJoinable` — the board reuses the call's
 * authorisation rather than defining its own.
 */
@Module({
  imports: [SessionsModule],
  providers: [WhiteboardGateway, WhiteboardService],
})
export class WhiteboardModule {}
