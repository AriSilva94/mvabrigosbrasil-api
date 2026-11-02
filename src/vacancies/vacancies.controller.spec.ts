import { HttpStatus, INestApplication } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../auth/decorators/public';
import type { Claims } from '../auth/jwt/token.service';
import { TEAM_ACTIVE_KEY } from '../common/decorators/team-active';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  PublicVacanciesController,
  VacanciesController,
} from './vacancies.controller';
import { VacanciesService } from './vacancies.service';

const claims: Claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  role: 'abrigo',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: 'sid-owner',
};
const validPayload = {
  post_title: 'Cuidador',
  post_periodo: 'Matutino',
  post_carga: '4h',
  post_tipo_demanda: 'Recorrente',
  post_area_atuacao: 'Cuidados',
  post_quantidade: '2',
  post_is_published: true,
  post_content: 'Descrição',
  post_habilidades_e_funcoes: 'Cuidar',
  post_perfil_dos_voluntarios: 'Adultos',
};

function methodTarget(prototype: object, method: string): object {
  return Object.getOwnPropertyDescriptor(prototype, method)?.value as object;
}

describe('VacanciesController', () => {
  let app: INestApplication;
  let currentClaims: Claims | undefined;
  const service = {
    list: jest.fn(),
    create: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getMyStatus: jest.fn(),
    listPublic: jest.fn(),
    getPublic: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VacanciesController, PublicVacanciesController],
      providers: [
        { provide: VacanciesService, useValue: service },
        {
          provide: PrismaService,
          useValue: { user: { findUnique: jest.fn() } },
        },
        TeamActiveGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user?: Claims }).user = currentClaims;
      next();
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    currentClaims = claims;
    jest.clearAllMocks();
  });

  it('returns the first Zod issue as {error}', async () => {
    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/vacancies')
      .send({ ...validPayload, post_title: '', post_periodo: '' })
      .expect(400);

    expect(response.body).toEqual({ error: 'Informe o título da vaga.' });
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    ['post', '/vacancies'],
    ['put', '/vacancies/123e4567-e89b-12d3-a456-426614174000'],
    ['delete', '/vacancies/123e4567-e89b-12d3-a456-426614174000'],
  ])('enforces TeamActive on %s %s', async (method, path) => {
    currentClaims = { ...claims, teamDisabled: true };
    const operation = request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )[method as 'post' | 'put' | 'delete'](path);
    if (method !== 'delete') operation.send(validPayload);
    await operation.expect(403);
  });

  it('delegates optional claims for my-status', async () => {
    currentClaims = undefined;
    service.getMyStatus.mockResolvedValue({
      isOwner: false,
      hasApplied: false,
    });

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/vacancies/vaga-123e4567/my-status')
      .expect(200);

    expect(response.body).toEqual({ isOwner: false, hasApplied: false });
    expect(service.getMyStatus).toHaveBeenCalledWith(
      undefined,
      'vaga-123e4567',
    );
  });

  it('marks my-status and both public routes as public', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        methodTarget(VacanciesController.prototype, 'getMyStatus'),
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        methodTarget(PublicVacanciesController.prototype, 'list'),
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        methodTarget(PublicVacanciesController.prototype, 'get'),
      ),
    ).toBe(true);
  });

  it('marks all vacancy mutations as requiring an active team', () => {
    expect(
      Reflect.getMetadata(
        TEAM_ACTIVE_KEY,
        methodTarget(VacanciesController.prototype, 'create'),
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        TEAM_ACTIVE_KEY,
        methodTarget(VacanciesController.prototype, 'update'),
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        TEAM_ACTIVE_KEY,
        methodTarget(VacanciesController.prototype, 'remove'),
      ),
    ).toBe(true);
  });

  it('keeps POST /vacancies on the legacy 200 status', () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        methodTarget(VacanciesController.prototype, 'create'),
      ),
    ).toBe(HttpStatus.OK);
  });
});
