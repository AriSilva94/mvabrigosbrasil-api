import {
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminService } from './admin.service';

type TxMock = {
  teamMembership: {
    deleteMany: jest.Mock;
    createMany: jest.Mock;
  };
};

describe('AdminService', () => {
  const tx: TxMock = {
    teamMembership: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma = {
    user: { findMany: jest.fn(), findUnique: jest.fn() },
    teamMembership: { findMany: jest.fn() },
    shelter: { findMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  };
  let service: AdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (callback: (client: TxMock) => Promise<unknown>) => callback(tx),
    );
    tx.teamMembership.deleteMany.mockResolvedValue({ count: 0 });
    tx.teamMembership.createMany.mockResolvedValue({ count: 0 });
    service = new AdminService(prisma as unknown as PrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('lists managers with only active manager memberships and JSON-safe ids', async () => {
    const createdAt = new Date('2026-09-01T12:00:00.000Z');
    prisma.user.findMany.mockResolvedValue([
      { id: 'm1', email: 'm1@test', createdAt, wpUserId: 42 },
      { id: 'm2', email: 'm2@test', createdAt, wpUserId: null },
    ]);
    prisma.teamMembership.findMany.mockResolvedValue([
      { memberWpUserId: 42n, abrigoPostId: 99n },
    ]);
    prisma.shelter.findMany.mockResolvedValue([
      { id: 's1', name: 'Abrigo', wpPostId: 99 },
    ]);

    await expect(service.listManagers()).resolves.toEqual({
      managers: [
        {
          id: 'm1',
          email: 'm1@test',
          created_at: createdAt,
          wp_user_id: 42,
          shelters: [{ id: 's1', name: 'Abrigo', wp_post_id: 99 }],
        },
        {
          id: 'm2',
          email: 'm2@test',
          created_at: createdAt,
          wp_user_id: null,
          shelters: [],
        },
      ],
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'gerente' },
      select: { id: true, email: true, createdAt: true, wpUserId: true },
    });
    expect(prisma.teamMembership.findMany).toHaveBeenCalledWith({
      where: {
        memberWpUserId: { in: [42n] },
        role: 'manager',
        status: 'active',
      },
      select: { memberWpUserId: true, abrigoPostId: true },
    });
  });

  it('returns 404 when the selected manager has no legacy user id', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: null });

    await expect(
      service.replaceManagerShelters('manager-id', []),
    ).rejects.toThrow(new NotFoundException('Gerente não encontrado'));
  });

  it('assigns a negative synthetic id and replaces links atomically', async () => {
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.123);
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 12 });
    prisma.shelter.findMany.mockResolvedValue([
      { id: 's1', wpPostId: null },
      { id: 's2', wpPostId: 88 },
    ]);
    prisma.shelter.update.mockResolvedValue({ wpPostId: -123000001 });

    await expect(
      service.replaceManagerShelters('manager-id', ['s1', 's2']),
    ).resolves.toEqual({ success: true });

    expect(prisma.shelter.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { wpPostId: -123000001 },
      select: { wpPostId: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.teamMembership.deleteMany).toHaveBeenCalledWith({
      where: { memberWpUserId: 12n, role: 'manager' },
    });
    expect(tx.teamMembership.createMany).toHaveBeenCalledWith({
      data: [
        {
          memberWpUserId: 12n,
          abrigoPostId: -123000001n,
          role: 'manager',
          status: 'active',
        },
        {
          memberWpUserId: 12n,
          abrigoPostId: 88n,
          role: 'manager',
          status: 'active',
        },
      ],
    });
  });

  it.each([
    [{ code: 'P2002' }],
    [{ cause: { originalError: { code: '23505' } } }],
  ])('retries synthetic ids on unique conflicts', async (error) => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 12 });
    prisma.shelter.findMany.mockResolvedValue([{ id: 's1', wpPostId: null }]);
    prisma.shelter.update
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ wpPostId: -1 });

    await expect(
      service.replaceManagerShelters('manager-id', ['s1']),
    ).resolves.toEqual({ success: true });
    expect(prisma.shelter.update).toHaveBeenCalledTimes(5);
  });

  it('fails after five unique conflicts', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 12 });
    prisma.shelter.findMany.mockResolvedValue([{ id: 's1', wpPostId: null }]);
    prisma.shelter.update.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.replaceManagerShelters('manager-id', ['s1']),
    ).rejects.toThrow(
      new InternalServerErrorException('Erro ao vincular abrigo sem ID legado'),
    );
    expect(prisma.shelter.update).toHaveBeenCalledTimes(5);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not retry a non-unique synthetic id failure', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 12 });
    prisma.shelter.findMany.mockResolvedValue([{ id: 's1', wpPostId: null }]);
    prisma.shelter.update.mockRejectedValue(new Error('db down'));

    await expect(
      service.replaceManagerShelters('manager-id', ['s1']),
    ).rejects.toThrow(
      new InternalServerErrorException('Erro ao vincular abrigo sem ID legado'),
    );
    expect(prisma.shelter.update).toHaveBeenCalledTimes(1);
  });

  it('maps delete and insert failures to their literal stage errors', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 12 });
    prisma.shelter.findMany.mockResolvedValue([]);
    tx.teamMembership.deleteMany.mockRejectedValueOnce(new Error('delete'));

    await expect(
      service.replaceManagerShelters('manager-id', []),
    ).rejects.toThrow(
      new InternalServerErrorException('Erro ao atualizar vínculos'),
    );

    tx.teamMembership.deleteMany.mockResolvedValue({ count: 1 });
    prisma.shelter.findMany.mockResolvedValue([{ id: 's1', wpPostId: 88 }]);
    tx.teamMembership.createMany.mockRejectedValueOnce(new Error('insert'));
    await expect(
      service.replaceManagerShelters('manager-id', ['s1']),
    ).rejects.toThrow(
      new InternalServerErrorException('Erro ao criar vínculos'),
    );
  });

  it('resolves the current manager active shelters', async () => {
    prisma.user.findUnique.mockResolvedValue({ wpUserId: 42 });
    prisma.teamMembership.findMany.mockResolvedValue([{ abrigoPostId: 99n }]);
    prisma.shelter.findMany.mockResolvedValue([
      { id: 's1', name: 'Abrigo', wpPostId: 99 },
    ]);

    await expect(service.listMyShelters('manager-id')).resolves.toEqual({
      shelters: [{ id: 's1', name: 'Abrigo', wp_post_id: 99 }],
    });
    expect(prisma.teamMembership.findMany).toHaveBeenCalledWith({
      where: {
        memberWpUserId: 42n,
        role: 'manager',
        status: 'active',
      },
      select: { abrigoPostId: true },
    });
  });
});
