import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Prisma 7's "client" generator ships a WASM query compiler that it loads via a
// dynamic `import()` (see src/generated/prisma/internal/class.ts). That works fine
// under plain Node (verified manually via `npm run build && npm run start:prod`),
// but Jest's VM-based module runner cannot service a dynamic import without the
// `--experimental-vm-modules` flag, and turning that flag on breaks the rest of the
// CommonJS-transpiled dependency graph (@nestjs/config in particular). Real
// Postgres connectivity is exercised outside Jest (finding 3's manual boot, plus
// the docker-compose stack); here PrismaService is swapped for a lightweight fake
// so this smoke test can still boot the real AppModule end-to-end (Redis, filters,
// global prefix, HealthController) without hitting that Jest/WASM incompatibility.
class FakePrismaService {
  onModuleInit(): void {}
  onModuleDestroy(): void {}
  $queryRaw(): Promise<unknown> {
    return Promise.resolve([{ '?column?': 1 }]);
  }
}

describe('AppModule (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useClass(FakePrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('/api/v1/health (GET) reports status, db and redis', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('db');
    expect(res.body).toHaveProperty('redis');
  });

  afterEach(async () => {
    await app.close();
  });
});
