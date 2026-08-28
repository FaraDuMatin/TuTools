import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '../prisma/prisma.client.js';
import { requireEnv, requireEnvList } from '../env.js';

/**
 * Better Auth runs in-process as a library — there is no external auth service
 * and no hosted login page. Users, sessions and password hashes live in our own
 * Postgres, which is what keeps the eventual Keycloak move a data migration.
 */
export const auth = betterAuth({
  appName: 'TutoringAllInOne',
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: requireEnv('BETTER_AUTH_SECRET'),
  baseURL: requireEnv('BETTER_AUTH_URL'),
  basePath: '/api/auth',

  // Next dev server(s). Requests from anywhere else are rejected.
  trustedOrigins: requireEnvList('WEB_ORIGIN'),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // No mail provider wired yet (AWS SES is a "gradual" capability), so
    // requiring verification here would lock every user out on day one.
    requireEmailVerification: false,
  },

  session: {
    // The build-order requirement: a login survives refresh, reconnect and a
    // device switch. A 30-day server-side session row is what delivers that —
    // the cookie only carries a token, the truth is the Session table.
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      // Deliberately off. It caches the user record — role included — in a
      // signed cookie, so a demotion would leave elevated access live until it
      // expires. Role scoping has to be enforced server-side on every request,
      // and at this scale reading the session row costs ~1ms.
      enabled: false,
    },
  },

  user: {
    additionalFields: {
      // `input: false` is the important part: role can never be set from the
      // signup payload, so nobody signs themselves up as CEO. Role changes go
      // through server-side code only.
      role: {
        type: 'string',
        required: false,
        defaultValue: 'STUDENT',
        input: false,
      },
      // Bilingual from the schema up — carried on the user, not guessed from
      // the browser, so it follows them across devices.
      language: {
        type: 'string',
        required: false,
        defaultValue: 'FR',
        input: true,
      },
    },
  },

  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: 'lax',
      // Ports don't affect same-site, so localhost:3000 -> localhost:3001 works
      // in dev. Flip to secure + sameSite 'none' behind HTTPS in production.
      secure: process.env.NODE_ENV === 'production',
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;
