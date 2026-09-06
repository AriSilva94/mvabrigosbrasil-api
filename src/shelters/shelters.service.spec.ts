import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  REQUIRED_SHELTER_FIELDS,
  REQUIRED_VOLUNTEER_FIELDS,
  SheltersService,
} from './shelters.service';
import type { ShelterProfileInput } from './schemas/shelter-profile.schema';

const userId = '11111111-1111-1111-1111-111111111111';

const validInput: ShelterProfileInput = {
  shelterType: 'private',
  cnpj: '12.345.678/0001-90',
  shelterName: 'Abrigo Bom Lar',
  cep: '12345-678',
  street: 'Rua Um',
  number: 25,
  district: 'Centro',
  state: 'sp',
  city: 'Sao Paulo',
  website: '',
  foundationDate: '2020-01-02',
  species: 'dogs',
  additionalSpecies: ['cats'],
  temporaryAgreement: true,
  referralSource: 'internet',
  initialDogs: 10,
  initialCats: 4,
  initialDogsLt: 2,
  initialCatsLt: 1,
  authorizedName: 'Maria',
  authorizedRole: 'Diretora',
  authorizedEmail: 'maria@example.com',
  authorizedPhone: '(11) 91234-5678',
  acceptTerms: true,
};

type ShelterUpsertArg = {
  where: { profileId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

type TransactionMock = {
  $executeRaw: jest.Mock;
  shelter: {
    upsert: jest.Mock<Promise<Record<string, unknown>>, [ShelterUpsertArg]>;
    update: jest.Mock;
  };
};

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
  };
  shelter: {
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    findMany: jest.Mock;
    count: jest.Mock;
    upsert: jest.Mock;
    update: jest.Mock;
  };
  volunteer: {
    findFirst: jest.Mock;
  };
  shelterHistory: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  $executeRaw: jest.Mock;
  $transaction: jest.Mock;
};

function createPrismaMock(): PrismaMock {
  return {
    user: {
      findUnique: jest.fn(),
    },
    shelter: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    volunteer: {
      findFirst: jest.fn(),
    },
    shelterHistory: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
}

describe('SheltersService', () => {
  let prisma: PrismaMock;
  let usersService: jest.Mocked<Pick<UsersService, 'resolveRole'>>;
  let service: SheltersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    usersService = {
      resolveRole: jest.fn(),
    };
    service = new SheltersService(
      prisma as unknown as PrismaService,
      usersService as unknown as UsersService,
    );
  });

  it('validateProfile returns all required shelter fields when abrigo has no shelter', async () => {
    const user = { id: userId, role: 'abrigo', isTeamOnly: false };
    prisma.user.findUnique.mockResolvedValue(user);
    usersService.resolveRole.mockResolvedValue('abrigo');
    prisma.shelter.findUnique.mockResolvedValue(null);

    await expect(service.validateProfile(userId)).resolves.toEqual({
      isValid: false,
      requiresProfileUpdate: true,
      missingFields: [...REQUIRED_SHELTER_FIELDS],
      registerType: 'abrigo',
      profileExists: false,
    });
    expect(prisma.shelter.findUnique).toHaveBeenCalledWith({
      where: { profileId: userId },
    });
  });

  it('validateProfile requires cpf for temporary shelters and cnpj otherwise', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      role: 'abrigo',
      isTeamOnly: false,
    });
    usersService.resolveRole.mockResolvedValue('abrigo');
    prisma.shelter.findUnique.mockResolvedValue({
      shelterType: 'temporary',
      cnpj: '12345678000190',
      cpf: null,
      name: 'Abrigo',
      cep: '12345678',
      street: 'Rua',
      number: 1,
      district: 'Bairro',
      state: 'SP',
      city: 'Cidade',
      foundationDate: new Date('2020-01-01T00:00:00.000Z'),
      species: 'dogs',
      referralSource: 'internet',
      authorizedName: 'Maria',
      authorizedRole: 'Diretora',
      authorizedEmail: 'maria@example.com',
      authorizedPhone: '11912345678',
    });

    const result = await service.validateProfile(userId);

    expect(result.missingFields).toEqual(['document']);
    expect(result.isValid).toBe(false);
    expect(result.requiresProfileUpdate).toBe(true);
    expect(result.profileExists).toBe(true);
  });

  it('validateProfile checks volunteers by ownerProfileId', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: userId,
      role: 'voluntario',
      isTeamOnly: false,
    });
    usersService.resolveRole.mockResolvedValue('voluntario');
    prisma.volunteer.findFirst.mockResolvedValue(null);

    await expect(service.validateProfile(userId)).resolves.toEqual({
      isValid: false,
      requiresProfileUpdate: true,
      missingFields: [...REQUIRED_VOLUNTEER_FIELDS],
      registerType: 'voluntario',
      profileExists: false,
    });
    expect(prisma.volunteer.findFirst).toHaveBeenCalledWith({
      where: { ownerProfileId: userId },
    });
  });

  it('upsertMyShelter throws 409 when the user profile no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.upsertMyShelter(userId, validInput)).rejects.toThrow(
      ConflictException,
    );
  });

  it('upsertMyShelter returns current shelter without transaction when nothing changed', async () => {
    const current = {
      profileId: userId,
      shelterType: 'private',
      cnpj: '12345678000190',
      cpf: null,
      name: 'Abrigo Bom Lar',
      cep: '12345678',
      street: 'Rua Um',
      number: 25,
      district: 'Centro',
      state: 'sp',
      city: 'Sao Paulo',
      website: '',
      foundationDate: new Date('2020-01-02T00:00:00.000Z'),
      species: 'dogs',
      additionalSpecies: ['cats'],
      temporaryAgreement: true,
      referralSource: 'internet',
      initialDogs: 10,
      initialCats: 4,
      initialDogsLt: 2,
      initialCatsLt: 1,
      authorizedName: 'Maria',
      authorizedRole: 'Diretora',
      authorizedEmail: 'maria@example.com',
      authorizedPhone: '11912345678',
      acceptTerms: true,
      active: true,
    };
    prisma.user.findUnique.mockResolvedValue({ id: userId });
    prisma.shelter.findUnique.mockResolvedValue(current);

    const result = await service.upsertMyShelter(userId, validInput);

    expect(result.ok).toBe(true);
    expect(result.shelter.name).toBe('Abrigo Bom Lar');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('upsertMyShelter preserves existing LT population when temporaryAgreement is not true', async () => {
    const existing = {
      profileId: userId,
      initialDogsLt: 7,
      initialCatsLt: 6,
      additionalSpecies: [],
      website: null,
      cnpj: '12345678000190',
      cpf: null,
    };
    const tx: TransactionMock = {
      $executeRaw: jest.fn(),
      shelter: {
        upsert: jest.fn<Promise<Record<string, unknown>>, [ShelterUpsertArg]>(),
        update: jest.fn(),
      },
    };
    prisma.user.findUnique.mockResolvedValue({ id: userId });
    prisma.shelter.findUnique.mockResolvedValue(existing);
    tx.shelter.upsert.mockResolvedValue({
      ...existing,
      shelterType: 'private',
      name: 'Abrigo Bom Lar',
      active: true,
      initialDogsLt: 7,
      initialCatsLt: 6,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: TransactionMock) => Promise<unknown>) =>
        callback(tx),
    );

    await service.upsertMyShelter(userId, {
      ...validInput,
      temporaryAgreement: false,
      initialDogsLt: 2,
      initialCatsLt: 1,
    });

    const upsertCall = tx.shelter.upsert.mock.calls[0]?.[0];
    expect(upsertCall?.where).toEqual({ profileId: userId });
    expect(upsertCall?.create).toMatchObject({
      initialDogsLt: 7,
      initialCatsLt: 6,
    });
    expect(upsertCall?.update).toMatchObject({
      initialDogsLt: 7,
      initialCatsLt: 6,
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('upsertMyShelter preserves empty website strings like the frontend payload', async () => {
    const tx: TransactionMock = {
      $executeRaw: jest.fn(),
      shelter: {
        upsert: jest.fn<Promise<Record<string, unknown>>, [ShelterUpsertArg]>(),
        update: jest.fn(),
      },
    };
    prisma.user.findUnique.mockResolvedValue({ id: userId });
    prisma.shelter.findUnique.mockResolvedValue(null);
    tx.shelter.upsert.mockResolvedValue({
      profileId: userId,
      website: '',
      shelterType: 'private',
      name: 'Abrigo Bom Lar',
      active: true,
    });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: TransactionMock) => Promise<unknown>) =>
        callback(tx),
    );

    await service.upsertMyShelter(userId, validInput);

    const upsertCall = tx.shelter.upsert.mock.calls[0]?.[0];
    expect(upsertCall?.create).toMatchObject({ website: '' });
    expect(upsertCall?.update).toMatchObject({ website: '' });
  });

  it('upsertMyShelter returns the documented save error when Prisma write fails', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: userId });
    prisma.shelter.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(new Error('db down'));

    await expect(service.upsertMyShelter(userId, validInput)).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(service.upsertMyShelter(userId, validInput)).rejects.toThrow(
      'Erro ao salvar cadastro',
    );
  });

  it('toggleMyShelterActive updates only the shelter owned by profileId', async () => {
    const tx: TransactionMock = {
      $executeRaw: jest.fn(),
      shelter: {
        upsert: jest.fn<Promise<Record<string, unknown>>, [ShelterUpsertArg]>(),
        update: jest.fn(),
      },
    };
    prisma.shelter.findUnique.mockResolvedValue({
      profileId: userId,
      active: true,
    });
    tx.shelter.update.mockResolvedValue({ active: false });
    prisma.$transaction.mockImplementation(
      async (callback: (transaction: TransactionMock) => Promise<unknown>) =>
        callback(tx),
    );

    await expect(service.toggleMyShelterActive(userId)).resolves.toEqual({
      ok: true,
      active: false,
      message: 'Cadastro inativado com sucesso',
    });
    expect(tx.shelter.update).toHaveBeenCalledWith({
      where: { profileId: userId },
      data: { active: false },
      select: { active: true },
    });
  });

  it('toggleMyShelterActive throws 404 when profile has no shelter', async () => {
    prisma.shelter.findUnique.mockResolvedValue(null);

    await expect(service.toggleMyShelterActive(userId)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getMyShelterHistory maps camelCase history rows to snake_case response fields', async () => {
    prisma.shelter.findUnique.mockResolvedValue({ id: 'shelter-1' });
    prisma.shelterHistory.findMany.mockResolvedValue([
      {
        id: 'history-1',
        shelterId: 'shelter-1',
        profileId: userId,
        operation: 'UPDATE',
        oldData: { name: 'Old' },
        newData: { name: 'New' },
        changedFields: ['name'],
        changedAt: new Date('2020-01-01T12:00:00.000Z'),
        changedBy: userId,
      },
    ]);
    prisma.shelterHistory.count.mockResolvedValue(1);

    await expect(service.getMyShelterHistory(userId, 10, 5)).resolves.toEqual({
      history: [
        {
          id: 'history-1',
          shelter_id: 'shelter-1',
          profile_id: userId,
          operation: 'UPDATE',
          old_data: { name: 'Old' },
          new_data: { name: 'New' },
          changed_fields: ['name'],
          changed_at: '2020-01-01T12:00:00.000Z',
          changed_by: userId,
        },
      ],
      total: 1,
      limit: 10,
      offset: 5,
    });
  });

  it('checkAddress filters active shelters by CEP and excludes the current profile', async () => {
    prisma.shelter.findMany.mockResolvedValue([
      {
        profileId: 'other-user',
        name: 'Outro Abrigo',
        street: 'Rua Um',
        number: 1,
        city: 'Cidade',
        state: 'SP',
      },
    ]);

    await expect(
      service.checkAddress(userId, '12345-678', ' Rua Um ', '1'),
    ).resolves.toEqual({
      exists: true,
      count: 1,
      shelters: [
        {
          name: 'Outro Abrigo',
          street: 'Rua Um',
          number: 1,
          city: 'Cidade',
          state: 'SP',
        },
      ],
    });
    expect(prisma.shelter.findMany).toHaveBeenCalledWith({
      where: {
        cep: '12345678',
        active: true,
        profileId: { not: userId },
        street: { equals: 'Rua Um', mode: 'insensitive' },
        number: 1,
      },
      select: {
        profileId: true,
        name: true,
        street: true,
        number: true,
        city: true,
        state: true,
      },
    });
  });

  it('listSheltersForAdmin returns D1 fields ordered by name', async () => {
    prisma.shelter.findMany.mockResolvedValue([
      { id: 'shelter-1', name: 'Abrigo', wpPostId: 10 },
    ]);

    await expect(service.listSheltersForAdmin()).resolves.toEqual({
      shelters: [{ id: 'shelter-1', name: 'Abrigo', wp_post_id: 10 }],
    });
    expect(prisma.shelter.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, wpPostId: true },
    });
  });
});
