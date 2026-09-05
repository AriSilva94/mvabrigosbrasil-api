import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

export type Role = 'admin' | 'gerente' | 'abrigo' | 'voluntario';

/**
 * Declares the roles allowed to call a route/handler.
 * `RolesGuard` checks `req.user.role` against this list.
 * When absent, `RolesGuard` allows any authenticated user.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
