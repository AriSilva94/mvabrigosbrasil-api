import type { Request } from 'express';
import { getClientIp } from './client-ip';

function makeRequest(
  ip: string | undefined,
  headers: Record<string, string> = {},
): Request {
  return { ip, headers } as unknown as Request;
}

describe('getClientIp', () => {
  it.each(['162.158.10.20', '::ffff:172.70.1.2', '2606:4700::1'])(
    'uses CF-Connecting-IP when the connection comes from Cloudflare (%s)',
    (edge) => {
      expect(
        getClientIp(makeRequest(edge, { 'cf-connecting-ip': '200.10.20.30' })),
      ).toBe('200.10.20.30');
    },
  );

  it('ignores CF-Connecting-IP sent straight to the origin', () => {
    expect(
      getClientIp(
        makeRequest('200.10.20.30', { 'cf-connecting-ip': '1.2.3.4' }),
      ),
    ).toBe('200.10.20.30');
  });

  it('ignores a malformed CF-Connecting-IP even from Cloudflare', () => {
    expect(
      getClientIp(
        makeRequest('162.158.10.20', { 'cf-connecting-ip': 'not-an-ip' }),
      ),
    ).toBe('162.158.10.20');
  });

  it('falls back to req.ip without the header', () => {
    expect(getClientIp(makeRequest('::ffff:172.18.0.5'))).toBe('172.18.0.5');
  });

  it('returns an empty tracker when req.ip is missing', () => {
    expect(getClientIp(makeRequest(undefined))).toBe('');
  });
});
