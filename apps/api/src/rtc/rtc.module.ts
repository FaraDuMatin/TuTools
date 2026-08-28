import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module.js';
import { RtcController } from './rtc.controller.js';
import {
  RtcWebhookController,
  WEBHOOK_PROVIDERS,
} from './rtc-webhook.controller.js';
import { RtcService } from './rtc.service.js';

@Module({
  imports: [SessionsModule],
  controllers: [RtcController, RtcWebhookController],
  providers: [RtcService, ...WEBHOOK_PROVIDERS],
})
export class RtcModule {}
