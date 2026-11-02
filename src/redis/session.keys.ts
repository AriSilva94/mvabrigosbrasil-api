export const REFRESH_ROTATION_GRACE_SECONDS = 5;
export const USER_SESSIONS_KEY_PREFIX = 'user_sess:';

export function sessionKey(sid: string): string {
  return `sess:${sid}`;
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
