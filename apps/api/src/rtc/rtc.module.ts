import { Module } from '@nestjs/common';
import { RtcController } from './rtc.controller.js';
import { RtcService } from './rtc.service.js';

@Module({
  controllers: [RtcController],
  providers: [RtcService],
})
export class RtcModule {}
