import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.validation';
import { PrismaClient } from '../generated/prisma/client';

// ⚠️ Adaptação Task 3 (controller ruling): Prisma 7.10.0 não aceita mais `url` no bloco
// `datasource` do schema (ver prisma.config.ts) nem gera `PrismaClient` a partir de
// `@prisma/client` sem output customizado. A conexão passa a ser feita via driver adapter
// (`@prisma/adapter-pg`), com a URL lida do `ConfigService` (mesma fonte validada por
// `validateEnv`/`env.validation.ts`) em vez de `process.env` direto.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(configService: ConfigService<Env, true>) {
    const connectionString = configService.get('DATABASE_URL', {
      infer: true,
    });
    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
