import { config } from 'dotenv';
import path from 'node:path';

// Loaded for its side effect, and imported first in main.ts so that env vars
// exist before any module that reads them at import time (prisma.client.ts,
// auth.ts). Resolves to the monorepo root .env from either src/ or dist/.
config({ path: path.resolve(__dirname, '../../../.env') });

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env at the repo root.`,
    );
  }
  return value;
}

/**
 * Comma-separated env var to a list. Used for allowed origins: Next falls back
 * to another port when 3000 is taken, and a single hardcoded origin turns that
 * into a confusing CORS failure.
 */
export function requireEnvList(name: string): string[] {
  return requireEnv(name)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
