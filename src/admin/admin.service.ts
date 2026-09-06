import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MAX_SYNTHETIC_ID_ATTEMPTS = 5;

class MembershipWriteError extends Error {
  constructor(readonly stage: 'delete' | 'insert') {
    super(stage);
  }
}

function hasErrorCode(error: unknown, expected: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  if (record.code === expected) return true;
  return Object.values(record).some((value) => hasErrorCode(value, expected));
}

function isUniqueConflict(error: unknown): boolean {
  return hasErrorCode(error, 'P2002') || hasErrorCode(error, '23505');
}

function syntheticWpPostId(): number {
  return -(Math.floor(Math.random() * 1_000_000_000) + 1);
}

function shelterDto(shelter: {
  id: string;
  name: string;
  wpPostId: number | null;
}) {
  return {
    id: shelter.id,
    name: shelter.name,
    wp_post_id: shelter.wpPostId,
  };
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listManagers() {
    const managers = await this.prisma.user.findMany({
      where: { role: 'gerente' },
      select: { id: true, email: true, createdAt: true, wpUserId: true },
    });
    const wpUserIds = managers
      .map((manager) => manager.wpUserId)
      .filter((id): id is number => id !== null)
      .map(BigInt);

    const memberships = wpUserIds.length
      ? await this.prisma.teamMembership.findMany({
          where: {
            memberWpUserId: { in: wpUserIds },
            role: 'manager',
            status: 'active',
          },
          select: { memberWpUserId: true, abrigoPostId: true },
        })
      : [];
    const shelterWpIds = [
      ...new Set(
        memberships
          .map((membership) => membership.abrigoPostId)
          .filter((id): id is bigint => id !== null)
          .map(Number),
      ),
    ];
    const shelters = shelterWpIds.length
      ? await this.prisma.shelter.findMany({
          where: { wpPostId: { in: shelterWpIds } },
          select: { id: true, name: true, wpPostId: true },
        })
      : [];

    return {
      managers: managers.map((manager) => {
        const managerWpId =
          manager.wpUserId === null ? null : BigInt(manager.wpUserId);
        const linkedWpIds = new Set(
          memberships
            .filter((membership) => membership.memberWpUserId === managerWpId)
            .map((membership) => Number(membership.abrigoPostId)),
        );
        return {
          id: manager.id,
          email: manager.email,
          created_at: manager.createdAt,
          wp_user_id: manager.wpUserId,
          shelters: shelters
            .filter(
              (shelter) =>
                shelter.wpPostId !== null && linkedWpIds.has(shelter.wpPostId),
            )
            .map(shelterDto),
        };
      }),
    };
  }

  async replaceManagerShelters(managerId: string, shelterIds: string[]) {
    const manager = await this.prisma.user.findUnique({
      where: { id: managerId },
      select: { wpUserId: true },
    });
    if (!manager?.wpUserId) {
      throw new NotFoundException('Gerente não encontrado');
    }

    const shelters = await this.prisma.shelter.findMany({
      where: { id: { in: shelterIds } },
      select: { id: true, wpPostId: true },
    });
    const wpPostIds: number[] = [];
    for (const shelter of shelters) {
      if (shelter.wpPostId !== null) {
        wpPostIds.push(shelter.wpPostId);
        continue;
      }
      wpPostIds.push(await this.assignSyntheticWpPostId(shelter.id));
    }

    const memberWpUserId = BigInt(manager.wpUserId);
    try {
      await this.prisma.$transaction(async (tx) => {
        try {
          await tx.teamMembership.deleteMany({
            where: { memberWpUserId, role: 'manager' },
          });
        } catch {
          throw new MembershipWriteError('delete');
        }

        if (wpPostIds.length) {
          try {
            await tx.teamMembership.createMany({
              data: wpPostIds.map((abrigoPostId) => ({
                memberWpUserId,
                abrigoPostId: BigInt(abrigoPostId),
                role: 'manager',
                status: 'active',
              })),
            });
          } catch {
            throw new MembershipWriteError('insert');
          }
        }
      });
    } catch (error) {
      if (error instanceof MembershipWriteError && error.stage === 'delete') {
        throw new InternalServerErrorException('Erro ao atualizar vínculos');
      }
      if (error instanceof MembershipWriteError && error.stage === 'insert') {
        throw new InternalServerErrorException('Erro ao criar vínculos');
      }
      throw new InternalServerErrorException('Erro ao atualizar vínculos');
    }

    return { success: true as const };
  }

  async listMyShelters(profileId: string) {
    const manager = await this.prisma.user.findUnique({
      where: { id: profileId },
      select: { wpUserId: true },
    });
    if (!manager?.wpUserId) return { shelters: [] };

    const memberships = await this.prisma.teamMembership.findMany({
      where: {
        memberWpUserId: BigInt(manager.wpUserId),
        role: 'manager',
        status: 'active',
      },
      select: { abrigoPostId: true },
    });
    const wpPostIds = memberships
      .map((membership) => membership.abrigoPostId)
      .filter((id): id is bigint => id !== null)
      .map(Number);
    const shelters = wpPostIds.length
      ? await this.prisma.shelter.findMany({
          where: { wpPostId: { in: wpPostIds } },
          select: { id: true, name: true, wpPostId: true },
        })
      : [];
    return { shelters: shelters.map(shelterDto) };
  }

  private async assignSyntheticWpPostId(shelterId: string): Promise<number> {
    for (let attempt = 0; attempt < MAX_SYNTHETIC_ID_ATTEMPTS; attempt += 1) {
      const wpPostId = syntheticWpPostId();
      try {
        const updated = await this.prisma.shelter.update({
          where: { id: shelterId },
          data: { wpPostId },
          select: { wpPostId: true },
        });
        return updated.wpPostId as number;
      } catch (error) {
        if (!isUniqueConflict(error)) break;
      }
    }
    throw new InternalServerErrorException(
      'Erro ao vincular abrigo sem ID legado',
    );
  }
}
