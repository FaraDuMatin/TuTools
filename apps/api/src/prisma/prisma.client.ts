import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { requireEnv } from '../env.js';

/**
 * One client, one connection pool for the whole process. Better Auth and the
 * Nest providers share this instance rather than opening a pool each.
 *
 * Prisma 7 requires an explicit driver adapter; the Rust query engine is gone.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});
