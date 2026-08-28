import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';
import type { AuthSession } from './auth.js';

/** Injects the session AuthGuard already resolved. @CurrentUser() user */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthSession['user'] =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().auth.user,
);
