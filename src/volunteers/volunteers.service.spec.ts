import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { VolunteerProfileInput } from './schemas/volunteer-profile.schema';
import { VolunteersService } from './volunteers.service';

const loggerErrorSpy = jest
  .spyOn(Logger.prototype, 'error')
  .mockImplementation(() => undefined);

afterAll(() => loggerErrorSpy.mockRestore());

const claims: Claims = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'volunteer@example.com',
  role: 'voluntario',
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: 'sid-volunteer',
};

const payload: VolunteerProfileInput = {
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
  comentarios: undefined,
  referralSource: 'Instagram',
  acceptTerms: true,
};

const volunteer = {
  id: '22222222-2222-4222-8222-222222222222',
  wpPostId: null,
  ownerProfileId: claims.sub,
  name: payload.name,
  slug: null,
  telefone: '41999991234',
  cidade: payload.cidade,
  estado: payload.estado,
  profissao: payload.profissao,
  escolaridade: payload.escolaridade,
  faixaEtaria: payload.faixa_etaria,
  genero: payload.genero,
  experiencia: payload.experiencia,
  atuacao: payload.atuacao,
  disponibilidade: payload.disponibilidade,
  periodo: payload.periodo,
  descricao: payload.descricao,
  comentarios: null,
  referralSource: payload.referralSource,
  isPublic: true,
  acceptTerms: true,
  createdAt: new Date('2026-01-02T03:04:05.000Z'),
  updatedAt: new Date('2026-01-02T03:04:05.000Z'),
};

const expectedForm = {
  name: payload.name,
  telefone: volunteer.telefone,
  profissao: payload.profissao,
  faixa_etaria: payload.faixa_etaria,
  genero: payload.genero,
  escolaridade: payload.escolaridade,
  estado: payload.estado,
  cidade: payload.cidade,
  disponibilidade: payload.disponibilidade,
  periodo: payload.periodo,
  experiencia: payload.experiencia,
  atuacao: payload.atuacao,
  descricao: payload.descricao,
  comentarios: '',
  referral_source: payload.referralSource,
  acceptTerms: true,
  is_public: true,
};

type PrismaMock = {
  $transaction: jest.Mock;
  user: { findUnique: jest.Mock };
  volunteer: {
    findFirst: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
};

function createPrismaMock(): PrismaMock {
  const prisma = {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    volunteer: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: PrismaMock) => unknown) => callback(prisma),
  );
  return prisma;
}

describe('VolunteersService private profile', () => {
  let prisma: PrismaMock;
  let service: VolunteersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new VolunteersService(prisma as unknown as PrismaService);
  });

  it('returns null when the current user has no volunteer profile', async () => {
    prisma.volunteer.findFirst.mockResolvedValue(null);

    await expect(service.getMe(claims)).resolves.toEqual({ volunteer: null });
    expect(prisma.volunteer.findFirst).toHaveBeenCalledWith({
      where: { ownerProfileId: claims.sub },
    });
  });

  it('returns the current volunteer mapped to form data', async () => {
    prisma.volunteer.findFirst.mockResolvedValue(volunteer);

    await expect(service.getMe(claims)).resolves.toEqual({
      volunteer: expectedForm,
    });
  });

  it('translates a GET query failure to the literal consultation error', async () => {
    prisma.volunteer.findFirst.mockRejectedValue(new Error('db'));

    await expect(service.getMe(claims)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Erro ao consultar cadastro' },
      }),
    );
  });

  it('translates an unexpected GET mapping failure to the literal load error', async () => {
    const brokenRow = Object.defineProperty({}, 'name', {
      get: () => {
        throw new Error('unexpected');
      },
    });
    prisma.volunteer.findFirst.mockResolvedValue(brokenRow);

    await expect(service.getMe(claims)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Erro ao carregar cadastro' },
      }),
    );
  });

  it('returns 500 when validating the user fails', async () => {
    prisma.user.findUnique.mockRejectedValue(new Error('db'));

    await expect(service.saveMe(claims, payload)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Erro ao validar usuário' },
      }),
    );
    expect(prisma.volunteer.findFirst).not.toHaveBeenCalled();
  });

  it('returns 409 for an orphan JWT subject', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.saveMe(claims, payload)).rejects.toEqual(
      expect.objectContaining({
        status: 409,
        response: {
          error:
            'Perfil do usuário não encontrado. Refaça o login ou contate o suporte.',
        },
      }),
    );
    expect(prisma.volunteer.findFirst).not.toHaveBeenCalled();
  });

  it('returns 500 when the existing volunteer lookup fails', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: claims.sub });
    prisma.volunteer.findFirst.mockRejectedValue(new Error('db'));

    await expect(service.saveMe(claims, payload)).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Erro ao consultar cadastro' },
      }),
    );
  });

  it('returns the existing form without writing when nothing changed', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: claims.sub });
    prisma.volunteer.findFirst.mockResolvedValue({
      ...volunteer,
      slug: 'maria-silva',
    });

    await expect(service.saveMe(claims, payload)).resolves.toEqual({
      ok: true,
      volunteer: expectedForm,
    });
    expect(prisma.volunteer.create).not.toHaveBeenCalled();
    expect(prisma.volunteer.update).not.toHaveBeenCalled();
  });

  it('backfills a missing slug even when the profile fields did not change', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: claims.sub });
    prisma.volunteer.findFirst.mockResolvedValue(volunteer);
    prisma.volunteer.update.mockResolvedValue({
      ...volunteer,
      slug: 'maria-silva-22222222',
    });

    await expect(service.saveMe(claims, payload)).resolves.toEqual({
      ok: true,
      volunteer: expectedForm,
    });
    expect(prisma.volunteer.update).toHaveBeenCalledWith({
      where: { id: volunteer.id },
      data: expect.objectContaining({
        slug: 'maria-silva-22222222',
      }) as unknown,
    });
  });

  it('creates a volunteer, persists both D4 fields, and stores its public slug', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: claims.sub });
    prisma.volunteer.findFirst.mockResolvedValue(null);
    prisma.volunteer.create.mockResolvedValue(volunteer);
    prisma.volunteer.update.mockResolvedValue({
      ...volunteer,
      slug: 'maria-silva-22222222',
    });

    await expect(service.saveMe(claims, payload)).resolves.toEqual({
      ok: true,
      volunteer: expectedForm,
    });
    expect(prisma.volunteer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ownerProfileId: claims.sub,
        telefone: '41999991234',
        referralSource: payload.referralSource,
        isPublic: true,
      }) as unknown,
    });
    expect(prisma.volunteer.update).toHaveBeenCalledWith({
      where: { id: volunteer.id },
      data: { slug: 'maria-silva-22222222' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('updates strictly by existing id and persists both D4 fields', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: claims.sub });
    prisma.volunteer.findFirst.mockResolvedValue({
      ...volunteer,
      profissao: 'Biologa',
      referralSource: 'Outro',
      isPublic: false,
    });
    prisma.volunteer.update.mockResolvedValue(volunteer);

    await expect(service.saveMe(claims, payload)).resolves.toEqual({
      ok: true,
      volunteer: expectedForm,
    });
    expect(prisma.volunteer.update).toHaveBeenCalledWith({
      where: { id: volunteer.id },
      data: expect.objectContaining({
        referralSource: payload.referralSource,
        isPublic: true,
      }) as unknown,
    });
  });

  it.each(['create', 'update'] as const)(
    'returns the literal save error when %s fails',
    async (operation) => {
      prisma.user.findUnique.mockResolvedValue({ id: claims.sub });
      prisma.volunteer.findFirst.mockResolvedValue(
        operation === 'create' ? null : { ...volunteer, profissao: 'Biologa' },
      );
      prisma.volunteer[operation].mockRejectedValue(new Error('db'));

      await expect(service.saveMe(claims, payload)).rejects.toEqual(
        expect.objectContaining({
          response: { error: 'Erro ao salvar cadastro' },
        }),
      );
    },
  );

  it('uses InternalServerErrorException for private database failures', async () => {
    prisma.volunteer.findFirst.mockRejectedValue(new Error('db'));

    await expect(service.getMe(claims)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe('VolunteersService public data', () => {
  let prisma: PrismaMock;
  let service: VolunteersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new VolunteersService(prisma as unknown as PrismaService);
  });

  it('loads public cards with strict filters and newest-first order', async () => {
    prisma.volunteer.findMany.mockResolvedValue([volunteer]);

    const result = await service.listPublic();

    expect(prisma.volunteer.findMany).toHaveBeenCalledWith({
      where: { acceptTerms: true, isPublic: true },
      orderBy: { createdAt: 'desc' },
    });
    expect(result).toEqual({
      volunteers: [
        expect.objectContaining({
          id: volunteer.id,
          name: volunteer.name,
          source: 'new',
        }),
      ],
    });
  });

  it('reports public card query failures instead of masking them as an empty list', async () => {
    prisma.volunteer.findMany.mockRejectedValue(new Error('db'));

    await expect(service.listPublic()).rejects.toEqual(
      expect.objectContaining({
        status: 500,
        response: { error: 'Erro ao buscar voluntários' },
      }),
    );
  });

  it('rejects an empty public slug without querying', async () => {
    await expect(service.getPublic('   ')).rejects.toEqual(
      expect.objectContaining({
        status: 404,
        response: { error: 'Voluntário não encontrado' },
      }),
    );
    expect(prisma.volunteer.findFirst).not.toHaveBeenCalled();
  });

  it('loads a public profile by exact trimmed slug with owner email', async () => {
    prisma.volunteer.findFirst.mockResolvedValue({
      ...volunteer,
      slug: 'maria-silva',
      owner: { email: 'owner@example.com' },
    });

    const result = await service.getPublic(' maria-silva ');

    expect(prisma.volunteer.findFirst).toHaveBeenCalledWith({
      where: {
        slug: 'maria-silva',
        acceptTerms: true,
        isPublic: true,
      },
      include: { owner: { select: { email: true } } },
    });
    expect(result).toEqual(
      expect.objectContaining({
        id: volunteer.id,
        email: 'owner@example.com',
        source: 'new',
      }),
    );
    expect(prisma.volunteer.findFirst).toHaveBeenCalledTimes(1);
  });

  it('falls back to the base slug with the same public filters', async () => {
    prisma.volunteer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...volunteer,
        slug: 'maria-silva',
        owner: { email: null },
      });

    await expect(service.getPublic('maria-silva-123e4567')).resolves.toEqual(
      expect.objectContaining({ id: volunteer.id }),
    );
    expect(prisma.volunteer.findFirst).toHaveBeenNthCalledWith(2, {
      where: {
        slug: 'maria-silva',
        acceptTerms: true,
        isPublic: true,
      },
      include: { owner: { select: { email: true } } },
    });
  });

  it('returns 404 when no public profile matches', async () => {
    prisma.volunteer.findFirst.mockResolvedValue(null);

    await expect(service.getPublic('maria-silva')).rejects.toEqual(
      expect.objectContaining({
        response: { error: 'Voluntário não encontrado' },
      }),
    );
  });

  it('reports exact and fallback query errors instead of returning 404', async () => {
    prisma.volunteer.findFirst
      .mockRejectedValueOnce(new Error('exact db error'))
      .mockRejectedValueOnce(new Error('fallback db error'));

    await expect(service.getPublic('maria-silva-123e4567')).rejects.toEqual(
      expect.objectContaining({
        status: 500,
        response: { error: 'Erro ao buscar voluntário' },
      }),
    );
    expect(prisma.volunteer.findFirst).toHaveBeenCalledTimes(2);
  });
});
