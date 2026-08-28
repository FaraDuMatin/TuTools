import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RtcModule } from './rtc/rtc.module.js';
import { UsersController } from './users/users.controller.js';

@Module({
  imports: [PrismaModule, RtcModule],
  controllers: [AppController, UsersController],
  providers: [
    // Global: every route requires a session unless it declares @Public().
    // Locked by default so a new endpoint can't leak by omission.
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
