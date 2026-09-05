import { randomBytes, randomUUID, createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { RedisService } from './redis.service';

interface StoredSession {
  userId: string;
  rtHash: string;
  createdAt: number;
}

const DURATION_UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60,
};

/**
 * Parses a duration string like '30d', '15m', '900s' into seconds.
 * Falls back to interpreting a plain number as seconds already.
 */
export function parseDurationToSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
    throw new Error(`Invalid duration string: ${value}`);
  }
  const [, amountStr, unit] = match;
  return Number(amountStr) * DURATION_UNIT_SECONDS[unit];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionKey(sid: string): string {
  return `sess:${sid}`;
}

function userSessionsKey(userId: string): string {
  return `user_sess:${userId}`;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get ttlSeconds(): number {
    return parseDurationToSeconds(
      this.config.get('AUTH_REFRESH_TTL', { infer: true }),
    );
  }

  async create(userId: string): Promise<{ sid: string; rt: string }> {
    const sid = randomUUID();
    const rt = randomBytes(32).toString('base64url');
    const stored: StoredSession = {
      userId,
      rtHash: sha256(rt),
      createdAt: Date.now(),
    };
    const ttl = this.ttlSeconds;

    await this.redis.client
      .multi()
      .set(sessionKey(sid), JSON.stringify(stored), 'EX', ttl)
      .sadd(userSessionsKey(userId), sid)
      .expire(userSessionsKey(userId), ttl)
      .exec();

    return { sid, rt };
  }

  async validate(sid: string, rt: string): Promise<{ userId: string } | null> {
    const raw = await this.redis.client.get(sessionKey(sid));
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as StoredSession;
    if (stored.rtHash !== sha256(rt)) {
      return null;
    }
    return { userId: stored.userId };
  }

  async rotate(sid: string, rt: string): Promise<{ rt: string } | null> {
    const raw = await this.redis.client.get(sessionKey(sid));
    if (!raw) {
      return null;
    }
    const stored = JSON.parse(raw) as StoredSession;
    if (stored.rtHash !== sha256(rt)) {
      // Reuse of an already-rotated (or otherwise invalid) rt: treat as
      // theft detection and kill the session so no further rt can be used.
      await this.revoke(sid);
      return null;
    }

    const newRt = randomBytes(32).toString('base64url');
    const updated: StoredSession = {
      ...stored,
      rtHash: sha256(newRt),
    };
    const ttl = this.ttlSeconds;

    await this.redis.client
      .multi()
      .set(sessionKey(sid), JSON.stringify(updated), 'EX', ttl)
      .expire(userSessionsKey(stored.userId), ttl)
      .exec();

    return { rt: newRt };
  }

  async revoke(sid: string): Promise<void> {
    const raw = await this.redis.client.get(sessionKey(sid));
    if (!raw) {
      return;
    }
    const stored = JSON.parse(raw) as StoredSession;

    await this.redis.client
      .multi()
      .del(sessionKey(sid))
      .srem(userSessionsKey(stored.userId), sid)
      .exec();
  }

  async revokeAll(userId: string, exceptSid?: string): Promise<void> {
    const sids = await this.redis.client.smembers(userSessionsKey(userId));
    const toRevoke = sids.filter((sid) => sid !== exceptSid);
    if (toRevoke.length === 0) {
      return;
    }

    const multi = this.redis.client.multi();
    for (const sid of toRevoke) {
      multi.del(sessionKey(sid));
      multi.srem(userSessionsKey(userId), sid);
    }
    await multi.exec();
  }
}
