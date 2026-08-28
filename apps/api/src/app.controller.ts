import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/public.decorator.js';
import { PrismaService } from './prisma/prisma.service.js';

@Controller('api')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness + database reachability. Public so an uptime check can hit it
   * without credentials.
   */
  @Public()
  @Get('health')
  async health(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
