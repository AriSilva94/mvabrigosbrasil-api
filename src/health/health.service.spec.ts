import { HealthService } from './health.service';

describe('HealthService', () => {
  const prismaUp = {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
  const prismaDown = {
    $queryRaw: jest.fn().mockRejectedValue(new Error('no db')),
  };
  const redisUp = { ping: jest.fn().mockResolvedValue('PONG') };
  const redisDown = {
    ping: jest.fn().mockRejectedValue(new Error('no redis')),
  };

  it('ok when both up', async () => {
    expect(
      await new HealthService(prismaUp as never, redisUp as never).check(),
    ).toEqual({ status: 'ok', db: 'up', redis: 'up' });
  });
  it('degraded when db down', async () => {
    expect(
      await new HealthService(prismaDown as never, redisUp as never).check(),
    ).toEqual({ status: 'degraded', db: 'down', redis: 'up' });
  });
  it('degraded when redis down', async () => {
    expect(
      await new HealthService(prismaUp as never, redisDown as never).check(),
    ).toEqual({ status: 'degraded', db: 'up', redis: 'down' });
  });
});
