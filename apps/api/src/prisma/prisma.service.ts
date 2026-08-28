import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { prisma } from './prisma.client.js';

/**
 * Injectable handle on the shared client. Domain modules inject this rather
 * than importing the singleton directly, so they stay mockable in tests.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly db = prisma;

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
  }
}
