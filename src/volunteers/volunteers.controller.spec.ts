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
import { VolunteersController } from './volunteers.controller';
import { VolunteersService } from './volunteers.service';

const claims: Claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'volunteer@example.com',
  role: 'voluntario',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: 'sid-volunteer',
};

const validPayload = {
  name: 'Maria Silva',
  telefone: '(41) 99999-1234',
  profissao: 'Veterinaria',
  faixa_etaria: '25-34',
  genero: 'Feminino',
  escolaridade: 'Superior completo',
  estado: 'PR',
  cidade: 'Curitiba',
  disponibilidade: 'Semanal',
  periodo: 'Matutino',
  experiencia: 'Sim',
  atuacao: 'Presencial',
  descricao: 'Cuidados com animais',
  referralSource: 'Instagram',
  acceptTerms: true,
};

function methodTarget(prototype: object, method: string): object {
  return Object.getOwnPropertyDescriptor(prototype, method)?.value as object;
}

describe('VolunteersController', () => {
  let app: INestApplication;
  let currentClaims: Claims | undefined;
  const service = {
    getMe: jest.fn(),
    saveMe: jest.fn(),
    listPublic: jest.fn(),
    getPublic: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [VolunteersController],
      providers: [
        { provide: VolunteersService, useValue: service },
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

  it('routes GET /volunteers/me to the private handler before :slug', async () => {
    service.getMe.mockResolvedValue({ volunteer: null });

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/volunteers/me')
      .expect(200);

    expect(response.body).toEqual({ volunteer: null });
    expect(service.getMe).toHaveBeenCalledWith(claims);
    expect(service.getPublic).not.toHaveBeenCalled();
  });

  it('returns the first Zod issue as {error}', async () => {
    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/volunteers/me')
      .send({ ...validPayload, name: '', telefone: '' })
      .expect(400);

    expect(response.body).toEqual({ error: 'Informe o nome social completo.' });
    expect(service.saveMe).not.toHaveBeenCalled();
  });

  it('delegates a valid private profile save', async () => {
    service.saveMe.mockResolvedValue({ ok: true, volunteer: null });

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/volunteers/me')
      .send(validPayload)
      .expect(200);

    expect(service.saveMe).toHaveBeenCalledWith(claims, validPayload);
  });

  it('enforces TeamActiveGuard on POST /volunteers/me', async () => {
    currentClaims = { ...claims, teamDisabled: true };

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/volunteers/me')
      .send(validPayload)
      .expect(403);
    expect(service.saveMe).not.toHaveBeenCalled();
  });

  it('delegates the public list and slug routes', async () => {
    service.listPublic.mockResolvedValue({ volunteers: [] });
    service.getPublic.mockResolvedValue({ id: 'volunteer-1' });

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/volunteers')
      .expect(200, { volunteers: [] });
    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/volunteers/maria-silva')
      .expect(200, { id: 'volunteer-1' });

    expect(service.listPublic).toHaveBeenCalledTimes(1);
    expect(service.getPublic).toHaveBeenCalledWith('maria-silva');
  });

  it('marks both public handlers as public', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        methodTarget(VolunteersController.prototype, 'listPublic'),
      ),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        methodTarget(VolunteersController.prototype, 'getPublic'),
      ),
    ).toBe(true);
  });

  it('marks POST as TeamActive and keeps the legacy 200 status', () => {
    const target = methodTarget(VolunteersController.prototype, 'saveMe');
    expect(Reflect.getMetadata(TEAM_ACTIVE_KEY, target)).toBe(true);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, target)).toBe(HttpStatus.OK);
  });
});
