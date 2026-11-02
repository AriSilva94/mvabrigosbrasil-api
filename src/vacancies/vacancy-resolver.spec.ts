import type { PrismaService } from '../prisma/prisma.service';
import { VacancyResolver } from './vacancy-resolver';

const uuid = '123e4567-e89b-12d3-a456-426614174000';
const shelterId = '223e4567-e89b-12d3-a456-426614174000';
const vacancy = { id: uuid, shelterId, status: 'active', isPublished: true };

describe('VacancyResolver', () => {
  let prisma: {
    vacancy: { findFirst: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let resolver: VacancyResolver;

  beforeEach(() => {
    prisma = {
      vacancy: { findFirst: jest.fn() },
      $queryRaw: jest.fn(),
    };
    resolver = new VacancyResolver(prisma as unknown as PrismaService);
  });

  it('resolves a full UUID with owner scope in the Prisma filter', async () => {
    prisma.vacancy.findFirst.mockResolvedValue(vacancy);

    await expect(resolver.resolveForShelter(uuid, shelterId)).resolves.toBe(
      vacancy,
    );
    expect(prisma.vacancy.findFirst).toHaveBeenCalledWith({
      where: { id: uuid, shelterId },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('uses a parameterized CAST query for an 8-char UUID prefix', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: uuid }]);
    prisma.vacancy.findFirst.mockResolvedValue(vacancy);

    await expect(
      resolver.resolveForShelter('cuidador-123e4567', shelterId),
    ).resolves.toBe(vacancy);

    const rawCall = prisma.$queryRaw.mock.calls[0] as unknown[];
    expect(rawCall[0]).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CAST(id AS text) LIKE'),
        expect.stringContaining('shelter_id'),
      ]),
    );
    expect(rawCall.slice(1)).toEqual(['123e4567%', shelterId]);
    expect((prisma as Record<string, unknown>).$queryRawUnsafe).toBeUndefined();
    expect(prisma.vacancy.findFirst).toHaveBeenCalledWith({
      where: { id: uuid, shelterId },
    });
  });

  it('does not resolve an ambiguous prefix in the same shelter', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: uuid }, { id: `${uuid}-other` }]);

    await expect(
      resolver.resolveForShelter('cuidador-123e4567', shelterId),
    ).resolves.toBeNull();
    expect(prisma.vacancy.findFirst).not.toHaveBeenCalled();
  });

  it('rejects malformed identifiers without querying Prisma', async () => {
    await expect(
      resolver.resolveForShelter('sem-prefixo', shelterId),
    ).resolves.toBeNull();
    expect(prisma.vacancy.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('enforces active and published filters in public prefix resolution', async () => {
    prisma.$queryRaw.mockResolvedValue([{ id: uuid }]);
    prisma.vacancy.findFirst.mockResolvedValue(vacancy);

    await expect(resolver.resolvePublic('vaga-123e4567')).resolves.toBe(
      vacancy,
    );
    expect(prisma.vacancy.findFirst).toHaveBeenCalledWith({
      where: { id: uuid, status: 'active', isPublished: true },
    });
    const rawCall = prisma.$queryRaw.mock.calls[0] as unknown[];
    expect(rawCall.slice(1)).toEqual(['123e4567%']);
    expect(rawCall[0]).toEqual(
      expect.arrayContaining([
        expect.stringContaining("status = 'active'"),
        expect.stringContaining('is_published = true'),
      ]),
    );
  });

  it('resolves an unpublished vacancy without public filters for apply checks', async () => {
    prisma.vacancy.findFirst.mockResolvedValue({
      ...vacancy,
      isPublished: false,
    });

    await resolver.resolveAny(uuid);

    expect(prisma.vacancy.findFirst).toHaveBeenCalledWith({
      where: { id: uuid },
    });
  });
});
