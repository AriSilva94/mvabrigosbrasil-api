import { SetMetadata } from '@nestjs/common';

export const TEAM_ACTIVE_KEY = 'team-active';

/**
 * Marks a route/handler as requiring an active team membership.
 * `TeamActiveGuard` blocks users whose claims have `teamDisabled`.
 */
export const RequireTeamActive = () => SetMetadata(TEAM_ACTIVE_KEY, true);
