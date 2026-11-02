import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type HealthStatus = {
  status: 'ok' | 'degraded';
  revision: string;
  db: 'up' | 'down';
  redis: 'up' | 'down';
};

const PROBE_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('probe timed out'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async check(): Promise<HealthStatus> {
    const db = await withTimeout(
      this.prisma.$queryRaw`SELECT 1`.then(() => undefined),
      PROBE_TIMEOUT_MS,
    )
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    const redis = await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS)
      .then(() => 'up' as const)
      .catch(() => 'down' as const);
    return {
      status: db === 'up' && redis === 'up' ? 'ok' : 'degraded',
      revision: process.env.APP_REVISION ?? 'local',
      db,
      redis,
    };
  }
}
