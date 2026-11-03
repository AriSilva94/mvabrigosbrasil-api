import { createHash } from 'crypto';
import { RedisService } from './redis.service';
import { refreshRotationGraceKey } from './session.keys';
import { SessionService } from './session.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('SessionService', () => {
  let redis: RedisService;
  let service: SessionService;

  beforeAll(async () => {
    redis = new RedisService({
      get: () => process.env.REDIS_TEST_URL ?? 'redis://localhost:6380/15',
    } as never);
    await redis.onModuleInit();
    service = new SessionService(redis, {
      get: () => '30d',
    } as never);
  });

  afterEach(async () => {
    const keys = await redis.client.keys('sess:*');
    const graceKeys = await redis.client.keys('sess_grace:*');
    const userSessKeys = await redis.client.keys('user_sess:*');
    const revokedKeys = await redis.client.keys('user_revoked_at:*');
    const all = [...keys, ...graceKeys, ...userSessKeys, ...revokedKeys];
    if (all.length > 0) {
      await redis.client.del(...all);
    }
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  describe('create', () => {
    it('returns a uuid sid and a base64url rt of at least 43 chars', async () => {
      const { sid, rt } = await service.create('user-1');

      expect(sid).toMatch(UUID_RE);
      expect(rt.length).toBeGreaterThanOrEqual(43);
      expect(rt).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('stores sess:{sid} with the rt hash and adds sid to user_sess:{userId}', async () => {
      const { sid, rt } = await service.create('user-1');

      const raw = await redis.client.get(`sess:${sid}`);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw as string) as {
        userId: string;
        rtHash: string;
        createdAt: number;
      };
      expect(parsed.userId).toBe('user-1');
      expect(parsed.rtHash).toBe(sha256(rt));
      expect(typeof parsed.createdAt).toBe('number');

      const members = await redis.client.smembers('user_sess:user-1');
      expect(members).toContain(sid);
    });

    it('sets a TTL of approximately 30 days on sess:{sid}', async () => {
      const { sid } = await service.create('user-1');

      const ttl = await redis.client.ttl(`sess:${sid}`);
      const thirtyDays = 30 * 24 * 60 * 60;
      expect(ttl).toBeGreaterThan(thirtyDays - 60);
      expect(ttl).toBeLessThanOrEqual(thirtyDays);
    });
  });

  describe('validate', () => {
    it('returns { userId } for the correct sid/rt pair', async () => {
      const { sid, rt } = await service.create('user-2');

      const result = await service.validate(sid, rt);

      expect(result).toEqual({ userId: 'user-2' });
    });

    it('returns null for a wrong rt', async () => {
      const { sid } = await service.create('user-2');

      const result = await service.validate(sid, 'wrong-rt-value');

      expect(result).toBeNull();
    });

    it('returns null for an unknown sid', async () => {
      const result = await service.validate('unknown-sid', 'whatever');

      expect(result).toBeNull();
    });
  });

  describe('rotate', () => {
    it('returns the same valid successor to concurrent uses of the current rt', async () => {
      const { sid, rt } = await service.create('user-concurrent');

      const [first, second] = await Promise.all([
        service.rotate(sid, rt),
        service.rotate(sid, rt),
      ]);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(second?.rt).toBe(first?.rt);
      expect(await service.validate(sid, first!.rt)).toEqual({
        userId: 'user-concurrent',
      });
    });

    it('returns a new rt for the same sid and updates rtHash', async () => {
      const { sid, rt } = await service.create('user-3');

      const rotated = await service.rotate(sid, rt);

      expect(rotated).not.toBeNull();
      expect(rotated?.rt).not.toBe(rt);

      const raw = await redis.client.get(`sess:${sid}`);
      const parsed = JSON.parse(raw as string) as { rtHash: string };
      expect(parsed.rtHash).toBe(sha256(rotated!.rt));
    });

    it('invalidates the old rt after rotation (single use)', async () => {
      const { sid, rt } = await service.create('user-3');

      await service.rotate(sid, rt);

      const result = await service.validate(sid, rt);
      expect(result).toBeNull();
    });

    it('validates with the new rt after rotation', async () => {
      const { sid, rt } = await service.create('user-3');

      const rotated = await service.rotate(sid, rt);

      const result = await service.validate(sid, rotated!.rt);
      expect(result).toEqual({ userId: 'user-3' });
    });

    it('keeps the raw successor only in a short-lived grace record', async () => {
      const { sid, rt } = await service.create('user-grace-storage');

      const rotated = await service.rotate(sid, rt);

      const sessionRaw = await redis.client.get(`sess:${sid}`);
      const graceKey = refreshRotationGraceKey(sid, sha256(rt));
      const graceRaw = await redis.client.get(graceKey);
      expect(sessionRaw).not.toContain(rotated!.rt);
      expect(graceRaw).toContain(rotated!.rt);
      expect(await redis.client.ttl(graceKey)).toBeGreaterThan(0);
      expect(await redis.client.ttl(graceKey)).toBeLessThanOrEqual(5);
    });

    it('returns the same successor for an immediate duplicate without revoking', async () => {
      const { sid, rt } = await service.create('user-4');
      const firstRotation = await service.rotate(sid, rt);

      const duplicate = await service.rotate(sid, rt);

      expect(duplicate).toEqual(firstRotation);
      expect(await service.validate(sid, firstRotation!.rt)).toEqual({
        userId: 'user-4',
      });
      expect(await redis.client.get(`sess:${sid}`)).not.toBeNull();
      expect(await redis.client.smembers('user_sess:user-4')).toContain(sid);
    });

    it('does not recover a stale grace successor after that successor rotates', async () => {
      const { sid, rt: originalRt } = await service.create('user-stale-grace');
      const firstRotation = await service.rotate(sid, originalRt);
      const secondRotation = await service.rotate(sid, firstRotation!.rt);

      const staleDuplicate = await service.rotate(sid, originalRt);

      expect(staleDuplicate).toBeNull();
      expect(await service.validate(sid, secondRotation!.rt)).toBeNull();
    });

    it('revokes the session when the previous rt is reused after grace expires', async () => {
      const { sid, rt } = await service.create('user-grace-expired');
      const firstRotation = await service.rotate(sid, rt);
      await redis.client.del(refreshRotationGraceKey(sid, sha256(rt)));

      const reuseResult = await service.rotate(sid, rt);

      expect(reuseResult).toBeNull();
      expect(await redis.client.get(`sess:${sid}`)).toBeNull();
      expect(
        await redis.client.smembers('user_sess:user-grace-expired'),
      ).not.toContain(sid);
      expect(await service.validate(sid, firstRotation!.rt)).toBeNull();
    });

    it('keeps the current successor valid after the previous grace expires', async () => {
      const { sid, rt } = await service.create('user-current-after-grace');
      const firstRotation = await service.rotate(sid, rt);
      await redis.client.del(refreshRotationGraceKey(sid, sha256(rt)));

      expect(await service.validate(sid, firstRotation!.rt)).toEqual({
        userId: 'user-current-after-grace',
      });
      const secondRotation = await service.rotate(sid, firstRotation!.rt);
      expect(secondRotation).not.toBeNull();
      expect(await service.validate(sid, secondRotation!.rt)).toEqual({
        userId: 'user-current-after-grace',
      });
    });

    it('revokes the session for an arbitrary wrong rt', async () => {
      const { sid } = await service.create('user-wrong-rt');

      const result = await service.rotate(sid, 'arbitrary-wrong-rt');

      expect(result).toBeNull();
      expect(await redis.client.get(`sess:${sid}`)).toBeNull();
      expect(
        await redis.client.smembers('user_sess:user-wrong-rt'),
      ).not.toContain(sid);
    });

    it('refreshes the session and user-session TTLs on rotation', async () => {
      const { sid, rt } = await service.create('user-ttl');
      await redis.client.expire(`sess:${sid}`, 60);
      await redis.client.expire('user_sess:user-ttl', 60);

      await service.rotate(sid, rt);

      const thirtyDays = 30 * 24 * 60 * 60;
      expect(await redis.client.ttl(`sess:${sid}`)).toBeGreaterThan(
        thirtyDays - 60,
      );
      expect(await redis.client.ttl(`sess:${sid}`)).toBeLessThanOrEqual(
        thirtyDays,
      );
      expect(await redis.client.ttl('user_sess:user-ttl')).toBeGreaterThan(
        thirtyDays - 60,
      );
      expect(await redis.client.ttl('user_sess:user-ttl')).toBeLessThanOrEqual(
        thirtyDays,
      );
    });

    it('returns null when rotating an unknown sid', async () => {
      const result = await service.rotate('unknown-sid', 'whatever');
      expect(result).toBeNull();
    });
  });

  describe('getUserId', () => {
    it('returns the userId stored for a known sid', async () => {
      const { sid } = await service.create('user-8');

      const userId = await service.getUserId(sid);

      expect(userId).toBe('user-8');
    });

    it('returns null for an unknown sid', async () => {
      const userId = await service.getUserId('unknown-sid');

      expect(userId).toBeNull();
    });
  });

  describe('revoke', () => {
    it('removes sess:{sid} and removes sid from user_sess:{userId}', async () => {
      const { sid } = await service.create('user-5');

      await service.revoke(sid);

      const raw = await redis.client.get(`sess:${sid}`);
      expect(raw).toBeNull();
      const members = await redis.client.smembers('user_sess:user-5');
      expect(members).not.toContain(sid);
    });
  });

  describe('isActive', () => {
    it('is true while the session exists and false after revoke', async () => {
      const { sid } = await service.create('user-5');
      expect(await service.isActive(sid)).toBe(true);

      await service.revoke(sid);

      expect(await service.isActive(sid)).toBe(false);
    });
  });

  describe('revokeAll', () => {
    it('deletes all sessions of a user', async () => {
      const a = await service.create('user-6');
      const b = await service.create('user-6');

      await service.revokeAll('user-6');

      expect(await redis.client.get(`sess:${a.sid}`)).toBeNull();
      expect(await redis.client.get(`sess:${b.sid}`)).toBeNull();
      expect(await redis.client.smembers('user_sess:user-6')).toHaveLength(0);
    });

    it('preserves the excepted sid when given', async () => {
      const a = await service.create('user-7');
      const b = await service.create('user-7');

      await service.revokeAll('user-7', a.sid);

      expect(await redis.client.get(`sess:${a.sid}`)).not.toBeNull();
      expect(await redis.client.get(`sess:${b.sid}`)).toBeNull();
      const members = await redis.client.smembers('user_sess:user-7');
      expect(members).toEqual([a.sid]);
    });

    it('records when it happened so in-flight logins can be discarded', async () => {
      const before = Date.now() - 1;

      await service.revokeAll('user-8');

      expect(await service.revokedSince('user-8', before)).toBe(true);
      expect(await service.revokedSince('user-8', Date.now() + 1)).toBe(false);
      expect(await service.revokedSince('user-never-revoked', before)).toBe(
        false,
      );
    });
  });

  // Outside the bounded concurrency grace window, reusing an already-rotated
  // refresh token must fully destroy the session so that the current token
  // also fails. This preserves theft detection without penalizing duplicate
  // requests that race during a legitimate refresh.
  describe('refresh reuse / theft detection (end-to-end)', () => {
    it('rejects the old rt outside grace, and also rejects the current rt afterwards', async () => {
      const { sid, rt: originalRt } = await service.create('user-9');

      const firstRotation = await service.rotate(sid, originalRt);
      expect(firstRotation).not.toBeNull();
      const currentRt = firstRotation!.rt;
      await redis.client.del(refreshRotationGraceKey(sid, sha256(originalRt)));

      const reuseAttempt = await service.rotate(sid, originalRt);
      expect(reuseAttempt).toBeNull();

      const afterTheftWithCurrentRt = await service.rotate(sid, currentRt);
      expect(afterTheftWithCurrentRt).toBeNull();

      expect(await service.validate(sid, currentRt)).toBeNull();
      expect(await service.getUserId(sid)).toBeNull();
    });
  });
});
