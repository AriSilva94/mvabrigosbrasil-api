import type { Request } from 'express';
import { isInternalRequest } from './internal-request';

function makeRequest(
  remoteAddress: string | undefined,
  headers: Record<string, string> = {},
): Request {
  return { socket: { remoteAddress }, headers } as unknown as Request;
}

describe('isInternalRequest', () => {
  it.each([
    '127.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '10.0.3.7',
    '172.18.0.5',
    '::ffff:172.18.0.5',
    '192.168.1.20',
    'fd12:3456::1',
  ])('accepts a direct call from private address %s', (address) => {
    expect(isInternalRequest(makeRequest(address))).toBe(true);
  });

  it.each(['8.8.8.8', '::ffff:200.10.20.30', '172.32.0.1', '2001:db8::1'])(
    'rejects a direct call from public address %s',
    (address) => {
      expect(isInternalRequest(makeRequest(address))).toBe(false);
    },
  );

  it.each(['x-forwarded-for', 'forwarded', 'x-real-ip'])(
    'rejects a private-socket call that went through a proxy (%s)',
    (header) => {
      expect(
        isInternalRequest(makeRequest('172.18.0.5', { [header]: '1.2.3.4' })),
      ).toBe(false);
    },
  );

  it('rejects a request without a socket address', () => {
    expect(isInternalRequest(makeRequest(undefined))).toBe(false);
  });
});
