import { BlockList, isIP } from 'net';
import type { Request } from 'express';

// https://www.cloudflare.com/ips/ (conferido em 2026-11-03).
const CLOUDFLARE_IPV4 = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];
const CLOUDFLARE_IPV6 = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

const CLOUDFLARE_NETWORKS = new BlockList();
for (const [ranges, family] of [
  [CLOUDFLARE_IPV4, 'ipv4'],
  [CLOUDFLARE_IPV6, 'ipv6'],
] as const) {
  for (const range of ranges) {
    const [network, prefix] = range.split('/');
    CLOUDFLARE_NETWORKS.addSubnet(network, Number(prefix), family);
  }
}

function isCloudflare(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  return CLOUDFLARE_NETWORKS.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

// Com o Cloudflare na frente do Traefik, `req.ip` é o servidor do Cloudflare
// e todos os usuários atendidos por ele dividiriam o mesmo rate limit. O IP
// real vem em `CF-Connecting-IP`, mas a origem também responde direto pelo IP
// da VPS, então o cabeçalho só vale quando a conexão veio mesmo do Cloudflare.
export function getClientIp(req: Request): string {
  const ip = (req.ip ?? '').replace(/^::ffff:/, '');
  const forwarded = req.headers['cf-connecting-ip'];

  if (typeof forwarded === 'string' && isIP(forwarded) && isCloudflare(ip)) {
    return forwarded;
  }
  return ip;
}
