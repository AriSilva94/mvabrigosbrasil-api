export const REFRESH_ROTATION_GRACE_SECONDS = 5;
export const USER_SESSIONS_KEY_PREFIX = 'user_sess:';

export function sessionKey(sid: string): string {
  return `sess:${sid}`;
}

// Instante da última revogação em massa (troca/redefinição de senha,
// desativação): um login que começou antes dele não pode manter a sessão.
export function userRevokedAtKey(userId: string): string {
  return `user_revoked_at:${userId}`;
}

export function userSessionsKey(userId: string): string {
  return `${USER_SESSIONS_KEY_PREFIX}${userId}`;
}

export function refreshRotationGraceKey(
  sid: string,
  previousRtHash: string,
): string {
  return `sess_grace:${sid}:${previousRtHash}`;
}
