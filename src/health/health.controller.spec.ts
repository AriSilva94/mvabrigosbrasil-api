import { HealthController } from './health.controller';

const TOKEN = 'a'.repeat(32);
const details = {
  status: 'ok' as const,
  revision: 'abc123',
  db: 'up' as const,
  redis: 'up' as const,
};

function build(token?: string) {
  const health = { check: jest.fn().mockResolvedValue(details) };
  const config = { get: jest.fn().mockReturnValue(token) };
  return new HealthController(health as never, config as never);
}

describe('HealthController', () => {
  it('returns only the status without the internal token', async () => {
    const result = await build(TOKEN).check({ headers: {} } as never);
    expect(result).toEqual({ status: 'ok' });
  });

  it('returns only the status with a wrong token', async () => {
    const req = { headers: { 'x-internal-api-token': 'b'.repeat(32) } };
    expect(await build(TOKEN).check(req as never)).toEqual({ status: 'ok' });
  });

  it('returns revision, db and redis with the right token', async () => {
    const req = { headers: { 'x-internal-api-token': TOKEN } };
    expect(await build(TOKEN).check(req as never)).toEqual(details);
  });

  it('never exposes details when no token is configured', async () => {
    const req = { headers: { 'x-internal-api-token': TOKEN } };
    expect(await build(undefined).check(req as never)).toEqual({
      status: 'ok',
    });
  });
});
