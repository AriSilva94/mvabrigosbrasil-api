import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

// Conta conexões por usuário (várias abas, várias instâncias da API). O TTL
// renovado pelo heartbeat do client limpa contadores de instâncias que
// caíram sem chamar disconnect.
export const PRESENCE_TTL_SECONDS = 90;

const presenceKey = (userId: string): string => `presence:${userId}`;

@Injectable()
export class PresenceService {
  constructor(private readonly redis: RedisService) {}

  async connect(userId: string): Promise<boolean> {
    const result = await this.redis.client
      .multi()
      .incr(presenceKey(userId))
      .expire(presenceKey(userId), PRESENCE_TTL_SECONDS)
      .exec();
    return result?.[0]?.[1] === 1;
  }

  async disconnect(userId: string): Promise<boolean> {
    const remaining = await this.redis.client.decr(presenceKey(userId));
    if (remaining > 0) return false;
    await this.redis.client.del(presenceKey(userId));
    return true;
  }

  async heartbeat(userId: string): Promise<void> {
    await this.redis.client.expire(presenceKey(userId), PRESENCE_TTL_SECONDS);
  }

  async onlineAmong(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const counts = await this.redis.client.mget(ids.map(presenceKey));
    return ids.filter((_, index) => Number(counts[index]) > 0);
  }
}
