import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import type { Role } from '../generated/prisma/enums.js';
import { auth, type AuthSession } from './auth.js';
import { ROLES_KEY } from './roles.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export interface AuthenticatedRequest extends Request {
  auth: AuthSession;
}

/**
 * Resolves the session from the request cookie and enforces @Roles.
 *
 * Registered globally in app.module.ts, so a route is protected unless it opts
 * out with @Public — the safe default is "locked", not "open".
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });

    if (!session) {
      throw new UnauthorizedException('Not signed in');
    }
    request.auth = session;

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      targets,
    );
    if (required?.length && !required.includes(session.user.role as Role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
