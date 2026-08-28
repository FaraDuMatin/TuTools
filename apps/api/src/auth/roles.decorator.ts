import { SetMetadata } from '@nestjs/common';
import type { Role } from '../generated/prisma/enums.js';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles. Enforced by AuthGuard on the server —
 * the frontend hiding a button is never the control.
 *
 * @example @Roles('CEO')
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
