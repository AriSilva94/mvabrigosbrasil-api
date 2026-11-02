import type { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import type { Env } from '../config/env.validation';

// Com mais de uma instância da API, o adapter Redis entrega a todas elas os
// eventos emitidos para uma sala; sem ele cada instância só alcança os
// próprios sockets.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private readonly clients: Redis[] = [];

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const url = this.app
      .get(ConfigService<Env, true>)
      .get('REDIS_URL', { infer: true });
    const pub = new Redis(url, { lazyConnect: true });
    const sub = pub.duplicate();
    this.clients.push(pub, sub);
    await Promise.all([pub.connect(), sub.connect()]);
    this.adapterConstructor = createAdapter(pub, sub);
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    if (this.adapterConstructor) server.adapter(this.adapterConstructor);
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(this.clients.map((client) => client.quit()));
  }
}
