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

// Chamadas server-side do Next (SSR, ISR e refresh no proxy de sessão)
// chegam pela rede privada e sem cabeçalhos de proxy; sem esta exceção todas
// dividiriam o limite por IP do container web. Tráfego do navegador sempre
// passa pelo Traefik/nginx, que adicionam esses cabeçalhos, então um cliente
// externo não consegue se passar por chamada interna.
export function isInternalRequest(req: Request): boolean {
  if (PROXY_HEADERS.some((header) => req.headers[header] !== undefined)) {
    return false;
  }

  const address = req.socket?.remoteAddress?.replace(/^::ffff:/, '');
  if (!address) return false;

  return PRIVATE_NETWORKS.check(address, isIPv4(address) ? 'ipv4' : 'ipv6');
}
