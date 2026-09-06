import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import type { PrismaService } from '../prisma/prisma.service';
import { DynamicsService } from './dynamics.service';
import type { DynamicsSubmit } from './schemas/dynamics.schema';
import type { CacheInvalidationService } from '../redis/cache-invalidation.service';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

afterAll(() => loggerErrorSpy.mockRestore());

const ownerClaims: Claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'owner@example.com',
  role: 'abrigo',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: 'sid-owner',
};

const shelter = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Abrigo Exemplo',
  shelterType: 'private',
  temporaryAgreement: true,
  initialDogs: 10,
  initialCats: 5,
  initialDogsLt: 2,
  initialCatsLt: 1,
};

type PrismaMock = {
  user: { findUnique: jest.Mock };
  shelter: { findUnique: jest.Mock };
  teamMembership: { findFirst: jest.Mock };
  shelterDynamics: {
    findMany: jest.Mock;
    upsert: jest.Mock;
    deleteMany: jest.Mock;
  };
};

function createPrismaMock(): PrismaMock {
  return {
    user: { findUnique: jest.fn() },
    shelter: { findUnique: jest.fn() },
    teamMembership: { findFirst: jest.fn() },
    shelterDynamics: {
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };
}

describe('DynamicsService shelter resolution', () => {
  let prisma: PrismaMock;
  let service: DynamicsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new DynamicsService(
      prisma as unknown as PrismaService,
      {
        invalidatePublicData: jest.fn(),
      } as unknown as CacheInvalidationService,
    );
  });

  it('resolves the shelter owned by claims.sub', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);

    await expect(service.resolveShelter(ownerClaims)).resolves.toEqual(shelter);
    expect(prisma.shelter.findUnique).toHaveBeenCalledWith({
      where: { profileId: ownerClaims.sub },
      select: expect.objectContaining({ id: true }) as unknown,
    });
  });

  it('falls back to creatorProfileId for a team-only user', async () => {
    prisma.shelter.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(shelter);
    const claims: Claims = {
      ...ownerClaims,
      sub: '33333333-3333-3333-3333-333333333333',
      isTeamOnly: true,
      creatorProfileId: ownerClaims.sub,
    };

    await expect(service.resolveShelter(claims)).resolves.toEqual(shelter);
    expect(prisma.shelter.findUnique).toHaveBeenNthCalledWith(2, {
      where: { profileId: ownerClaims.sub },
      select: expect.objectContaining({ id: true }) as unknown,
    });
  });

  it('resolves a manager shelter by wpPostId only with an active manager link', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 42 });
    prisma.teamMembership.findFirst.mockResolvedValue({ id: 'membership-1' });
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    const claims: Claims = { ...ownerClaims, role: 'gerente' };

    await expect(service.resolveShelter(claims, 123)).resolves.toEqual(shelter);
    expect(prisma.teamMembership.findFirst).toHaveBeenCalledWith({
      where: {
        memberWpUserId: 42n,
        abrigoPostId: 123n,
        role: 'manager',
        status: 'active',
      },
      select: { id: true },
    });
    expect(prisma.shelter.findUnique).toHaveBeenCalledWith({
      where: { wpPostId: 123 },
      select: expect.objectContaining({ id: true }) as unknown,
    });
  });

  it('does not resolve a wpPostId when the manager has no active link', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 42 });
    prisma.teamMembership.findFirst.mockResolvedValue(null);
    const claims: Claims = { ...ownerClaims, role: 'gerente' };

    await expect(service.resolveShelter(claims, 123)).resolves.toBeNull();
    expect(prisma.shelter.findUnique).not.toHaveBeenCalled();
  });

  it('does not authorize the wpPostId manager path for a non-manager role', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 42 });
    prisma.teamMembership.findFirst.mockResolvedValue({ id: 'membership-1' });
    prisma.shelter.findUnique.mockResolvedValue(shelter);

    await expect(service.resolveShelter(ownerClaims, 123)).resolves.toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.teamMembership.findFirst).not.toHaveBeenCalled();
    expect(prisma.shelter.findUnique).not.toHaveBeenCalled();
  });
});

describe('DynamicsService operations', () => {
  let prisma: PrismaMock;
  let cacheInvalidation: { invalidatePublicData: jest.Mock };
  let service: DynamicsService;

  const payload: DynamicsSubmit = {
    month: '03',
    year: '2026',
    dynamicType: 'dinamica_lar',
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

  beforeEach(() => {
    prisma = createPrismaMock();
    cacheInvalidation = { invalidatePublicData: jest.fn() };
    service = new DynamicsService(
      prisma as unknown as PrismaService,
      cacheInvalidation as unknown as CacheInvalidationService,
    );
  });

  it('returns empty sections when the user has no shelter', async () => {
    prisma.shelter.findUnique.mockResolvedValue(null);

    await expect(service.getDynamics(ownerClaims)).resolves.toEqual({
      sections: [],
    });
    expect(prisma.shelterDynamics.findMany).not.toHaveBeenCalled();
  });

  it('returns both empty displays when reading dynamics fails', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.shelterDynamics.findMany.mockRejectedValue(new Error('db down'));

    const result = await service.getDynamics(ownerClaims);

    expect(result.sections).toHaveLength(2);
    expect(result.sections.every(({ rows }) => rows.length === 0)).toBe(true);
  });

  it('upserts the complete payload and returns refreshed sections', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.shelterDynamics.upsert.mockResolvedValue({ id: 'record-1' });
    prisma.shelterDynamics.findMany.mockResolvedValue([]);

    const result = await service.saveDynamics(ownerClaims, payload);

    const data = {
      shelterId: shelter.id,
      kind: 'lar',
      dynamicType: 'dinamica_lar',
      referencePeriod: '2026-03',
      referenceDate: new Date('2026-03-01T00:00:00.000Z'),
      entradasDeAnimais: 1,
      entradasDeGatos: 2,
      adocoesCaes: 3,
      adocoesGatos: 4,
      devolucoesCaes: 5,
      devolucoesGatos: 6,
      eutanasiasCaes: 7,
      eutanasiasGatos: 8,
      mortesNaturaisCaes: 9,
      mortesNaturaisGatos: 10,
      doencasCaes: 11,
      doencasGatos: 12,
      retornoDeCaes: 13,
      retornoDeGatos: 14,
      retornoLocalCaes: 15,
      retornoLocalGatos: 16,
    };
    expect(prisma.shelterDynamics.upsert).toHaveBeenCalledWith({
      where: {
        shelterId_dynamicType_referencePeriod: {
          shelterId: shelter.id,
          dynamicType: 'dinamica_lar',
          referencePeriod: '2026-03',
        },
      },
      create: data,
      update: data,
    });
    expect(result.sections).toHaveLength(2);
    expect(cacheInvalidation.invalidatePublicData).toHaveBeenCalledTimes(1);
  });

  it('translates an upsert failure to save_failed', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.shelterDynamics.upsert.mockRejectedValue(new Error('db down'));

    await expect(service.saveDynamics(ownerClaims, payload)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'save_failed' },
      }),
    );
    expect(cacheInvalidation.invalidatePublicData).not.toHaveBeenCalled();
  });

  it('deletes only by id and the resolved shelter id', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.shelterDynamics.deleteMany.mockResolvedValue({ count: 1 });
    prisma.shelterDynamics.findMany.mockResolvedValue([]);

    const result = await service.deleteDynamics(ownerClaims, 'record-1');

    expect(prisma.shelterDynamics.deleteMany).toHaveBeenCalledWith({
      where: { id: 'record-1', shelterId: shelter.id },
    });
    expect(result.sections).toHaveLength(2);
    expect(cacheInvalidation.invalidatePublicData).toHaveBeenCalledTimes(1);
  });

  it('translates a scoped delete failure to delete_failed', async () => {
    prisma.shelter.findUnique.mockResolvedValue(shelter);
    prisma.shelterDynamics.deleteMany.mockRejectedValue(new Error('db down'));

    await expect(
      service.deleteDynamics(ownerClaims, 'record-1'),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(
      service.deleteDynamics(ownerClaims, 'record-1'),
    ).rejects.toEqual(
      expect.objectContaining({ response: { error: 'delete_failed' } }),
    );
    expect(cacheInvalidation.invalidatePublicData).not.toHaveBeenCalled();
  });

  it.each([
    ['public', 'Público'],
    ['private', 'Privado'],
    ['mixed', 'Misto'],
    ['temporary', 'LT/PI'],
  ])('builds the summary label for %s shelters', async (shelterType, label) => {
    prisma.user.findUnique.mockResolvedValue({
      fullName: 'Responsável',
      email: ownerClaims.email,
    });
    prisma.shelter.findUnique.mockResolvedValue({ ...shelter, shelterType });

    await expect(service.getSummary(ownerClaims)).resolves.toEqual({
      shelterId: shelter.id,
      summary: {
        displayName: 'Responsável',
        totalAnimals: 15,
        shelterTypeLabel: label,
        hasTemporaryAgreement: true,
        dogsCount: 10,
        catsCount: 5,
        totalAnimalsLt: 3,
        dogsCountLt: 2,
        catsCountLt: 1,
      },
    });
  });
});
