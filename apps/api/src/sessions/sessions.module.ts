import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

/**
 * Exports the service because RtcModule needs it to authorise a join. The
 * dependency runs one way only — sessions knows nothing about rtc — so there is
 * no cycle.
 */
@Module({
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
