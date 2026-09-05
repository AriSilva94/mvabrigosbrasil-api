import { createHash } from 'crypto';
import { RedisService } from './redis.service';
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
    const userSessKeys = await redis.client.keys('user_sess:*');
    const all = [...keys, ...userSessKeys];
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

    it('returns null and deletes the session when an already-rotated rt is reused (theft detection)', async () => {
      const { sid, rt } = await service.create('user-4');
      await service.rotate(sid, rt);

      const reuseResult = await service.rotate(sid, rt);

      expect(reuseResult).toBeNull();

      const raw = await redis.client.get(`sess:${sid}`);
      expect(raw).toBeNull();

      const members = await redis.client.smembers('user_sess:user-4');
      expect(members).not.toContain(sid);
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
  });

  // Doc 03 §12, case 13: reusing an already-rotated refresh token must 401
  // AND fully destroy the session, so that a subsequent refresh attempt with
  // the CURRENT (latest) rt also fails. This is the theft-detection
  // guarantee that `AuthController.refresh` relies on (task 9).
  describe('refresh reuse / theft detection (end-to-end)', () => {
    it('rejects the old rt after one rotation, and also rejects the current rt afterwards', async () => {
      const { sid, rt: originalRt } = await service.create('user-9');

      const firstRotation = await service.rotate(sid, originalRt);
      expect(firstRotation).not.toBeNull();
      const currentRt = firstRotation!.rt;

      // Simulate a stolen/replayed OLD refresh token being used again.
      const reuseAttempt = await service.rotate(sid, originalRt);
      expect(reuseAttempt).toBeNull();

      // The session must now be fully destroyed: even the CURRENT
      // (legitimately latest) rt no longer works.
      const afterTheftWithCurrentRt = await service.rotate(sid, currentRt);
      expect(afterTheftWithCurrentRt).toBeNull();

      expect(await service.validate(sid, currentRt)).toBeNull();
      expect(await service.getUserId(sid)).toBeNull();
    });
  });
});
