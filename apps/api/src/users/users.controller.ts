import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/session.decorator.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthSession } from '../auth/auth.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('api')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Who am I. The frontend calls this on load to restore state after a refresh
   * or on a new device — the cookie alone is not treated as truth.
   */
  @Get('me')
  me(@CurrentUser() user: AuthSession['user']) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      language: user.language,
    };
  }

  /**
   * Roster. CEO only — the check lives here on the server, so calling the
   * endpoint directly with a STUDENT cookie returns 403 regardless of what the
   * frontend chooses to render.
   */
  @Roles('CEO')
  @Get('users')
  async list() {
    return this.prisma.db.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
