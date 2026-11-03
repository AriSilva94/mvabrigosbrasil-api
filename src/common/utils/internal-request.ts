import { createHash, timingSafeEqual } from 'crypto';
import { BlockList, isIPv4 } from 'net';
import type { Request } from 'express';

const PRIVATE_NETWORKS = new BlockList();
PRIVATE_NETWORKS.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_NETWORKS.addAddress('::1', 'ipv6');
PRIVATE_NETWORKS.addSubnet('fc00::', 7, 'ipv6');

const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'];

export const INTERNAL_TOKEN_HEADER = 'x-internal-api-token';

function sameSecret(provided: string, expected: string): boolean {
  // Hash antes de comparar: timingSafeEqual exige tamanhos iguais e o
  // tamanho do segredo também não deve vazar.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

// Chamadas server-side do Next (SSR, ISR e refresh no proxy de sessão) não
// podem dividir o limite por IP do container web. Com `INTERNAL_API_TOKEN`
// configurado, só quem envia o segredo é isento. Sem ele (legado), vale a
// heurística de rede privada sem cabeçalhos de proxy — que também isenta
// qualquer outro container da rede ou uma porta publicada sem proxy.
export function isInternalRequest(
  req: Request,
  internalToken?: string,
): boolean {
  if (internalToken) {
    const provided = req.headers[INTERNAL_TOKEN_HEADER];
    return typeof provided === 'string' && sameSecret(provided, internalToken);
  }

  if (PROXY_HEADERS.some((header) => req.headers[header] !== undefined)) {
    return false;
  }

  const address = req.socket?.remoteAddress?.replace(/^::ffff:/, '');
  if (!address) return false;

  return PRIVATE_NETWORKS.check(address, isIPv4(address) ? 'ipv4' : 'ipv6');
}
