import {
  INestApplication,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { Claims } from '../auth/jwt/token.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { TeamActiveGuard } from '../common/guards/team-active.guard';
import { DynamicsController } from './dynamics.controller';
import { DynamicsService } from './dynamics.service';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

afterAll(() => loggerErrorSpy.mockRestore());

const activeClaims: Claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  role: 'abrigo',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: 'sid-owner',
};

const validPayload = {
  month: '03',
  year: '2026',
  dynamicType: 'dinamica',
  entries: 1,
  entriesCats: 2,
  adoptions: 3,
  adoptionsCats: 4,
  returns: 5,
  returnsCats: 6,
  euthanasias: 7,
  euthanasiasCats: 8,
  naturalDeaths: 9,
  naturalDeathsCats: 10,
  diseases: 11,
  diseasesCats: 12,
  tutorReturn: 13,
  tutorReturnCats: 14,
  originReturn: 15,
  originReturnCats: 16,
};

describe('DynamicsController', () => {
  let app: INestApplication;
  let currentClaims: Claims;
  const dynamicsService = {
    getDynamics: jest.fn(),
    saveDynamics: jest.fn(),
    deleteDynamics: jest.fn(),
    getSummary: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DynamicsController],
      providers: [
        { provide: DynamicsService, useValue: dynamicsService },
        TeamActiveGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { user: Claims }).user = currentClaims;
      next();
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    currentClaims = activeClaims;
    jest.clearAllMocks();
  });

  it('GET /dynamics returns empty sections when the service finds no shelter', async () => {
    dynamicsService.getDynamics.mockResolvedValue({ sections: [] });

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/dynamics')
      .expect(200);

    expect(response.body).toEqual({ sections: [] });
    expect(dynamicsService.getDynamics).toHaveBeenCalledWith(
      activeClaims,
      null,
    );
  });

  it.each(['abc', '12abc', '2147483648'])(
    'rejects invalid shelter_id %s without calling Prisma-facing service code',
    async (shelterId) => {
      const response = await request(
        app.getHttpServer() as Parameters<typeof request>[0],
      )
        .get(`/dynamics?shelter_id=${shelterId}`)
        .expect(400);

      expect(response.body).toMatchObject({ error: 'invalid_payload' });
      expect(response.body).toHaveProperty('details');
      expect(dynamicsService.getDynamics).not.toHaveBeenCalled();
    },
  );

  it('POST /dynamics preserves flattened Zod details in invalid_payload', async () => {
    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/dynamics')
      .send({ ...validPayload, year: '26' })
      .expect(400);

    expect(response.body).toEqual({
      error: 'invalid_payload',
      details: {
        formErrors: [],
        fieldErrors: { year: ['Ano inválido'] },
      },
    });
    expect(dynamicsService.saveDynamics).not.toHaveBeenCalled();
  });

  it('DELETE /dynamics preserves flattened Zod details in invalid_payload', async () => {
    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .delete('/dynamics')
      .send({ id: '' })
      .expect(400);

    expect(response.body).toHaveProperty('error', 'invalid_payload');
    expect(response.body).toHaveProperty('details.formErrors', []);
    expect(response.body).toHaveProperty('details.fieldErrors.id');
    expect(dynamicsService.deleteDynamics).not.toHaveBeenCalled();
  });

  it('blocks POST when TeamActiveGuard sees a disabled team user', async () => {
    currentClaims = { ...activeClaims, teamDisabled: true };

    await request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/dynamics')
      .send(validPayload)
      .expect(403);

    expect(dynamicsService.saveDynamics).not.toHaveBeenCalled();
  });

  it('returns literal shelter_not_found and save_failed bodies', async () => {
    dynamicsService.saveDynamics
      .mockRejectedValueOnce(
        new NotFoundException({ error: 'shelter_not_found' }),
      )
      .mockRejectedValueOnce(
        new InternalServerErrorException({ error: 'save_failed' }),
      );

    const notFound = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/dynamics')
      .send(validPayload)
      .expect(404);
    const failed = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .post('/dynamics')
      .send(validPayload)
      .expect(500);

    expect(notFound.body).toEqual({ error: 'shelter_not_found' });
    expect(failed.body).toEqual({ error: 'save_failed' });
  });

  it('GET /dynamics/summary delegates claims and parsed shelter_id', async () => {
    const result = {
      summary: { displayName: 'Abrigo Exemplo' },
      shelterId: 'shelter-1',
    };
    dynamicsService.getSummary.mockResolvedValue(result);

    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/dynamics/summary?shelter_id=123')
      .expect(200);

    expect(response.body).toEqual(result);
    expect(dynamicsService.getSummary).toHaveBeenCalledWith(activeClaims, 123);
  });
});
