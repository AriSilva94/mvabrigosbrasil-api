import { randomUUID } from 'crypto';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { TokenService, Claims } from '../../src/auth/jwt/token.service';

export type ChatPeople = {
  shelterOwner: { id: string; token: string };
  volunteerUser: { id: string; token: string };
  outsider: { id: string; token: string };
  shelterId: string;
  volunteerId: string;
  vacancyId: string;
};

const claimsFor = (id: string, role: Claims['role']): Claims => ({
  sub: id,
  email: `${id}@chat.test`,
  role,
  isTeamOnly: false,
  teamDisabled: false,
  creatorProfileId: null,
  sid: `sid-${id}`,
});

// Cria abrigo + dono, voluntário + usuário, vaga publicada e um terceiro
// usuário sem relação, todos com ids novos para isolar cada suíte.
export async function seedChatPeople(
  prisma: PrismaService,
  tokens: TokenService,
  label: string,
): Promise<ChatPeople> {
  const shelterOwnerId = randomUUID();
  const volunteerUserId = randomUUID();
  const outsiderId = randomUUID();
  await prisma.user.createMany({
    data: [
      {
        id: shelterOwnerId,
        email: `${shelterOwnerId}@chat.test`,
        role: 'abrigo',
      },
      {
        id: volunteerUserId,
        email: `${volunteerUserId}@chat.test`,
        role: 'voluntario',
      },
      { id: outsiderId, email: `${outsiderId}@chat.test`, role: 'voluntario' },
    ],
  });
  const shelter = await prisma.shelter.create({
    data: { name: `Abrigo ${label}`, profileId: shelterOwnerId },
  });
  const volunteer = await prisma.volunteer.create({
    data: { name: `Voluntário ${label}`, ownerProfileId: volunteerUserId },
  });
  const vacancy = await prisma.vacancy.create({
    data: {
      title: `Vaga ${label}`,
      slug: `vaga-${label}-${randomUUID().slice(0, 8)}`,
      shelterId: shelter.id,
      status: 'active',
      isPublished: true,
    },
  });

  return {
    shelterOwner: {
      id: shelterOwnerId,
      token: await tokens.sign(claimsFor(shelterOwnerId, 'abrigo')),
    },
    volunteerUser: {
      id: volunteerUserId,
      token: await tokens.sign(claimsFor(volunteerUserId, 'voluntario')),
    },
    outsider: {
      id: outsiderId,
      token: await tokens.sign(claimsFor(outsiderId, 'voluntario')),
    },
    shelterId: shelter.id,
    volunteerId: volunteer.id,
    vacancyId: vacancy.id,
  };
}

export async function createThread(
  prisma: PrismaService,
  people: ChatPeople,
  overrides: { vacancyId?: string; status?: string } = {},
): Promise<string> {
  const thread = await prisma.chatThread.create({
    data: {
      vacancyId: overrides.vacancyId ?? people.vacancyId,
      volunteerProfileId: people.volunteerUser.id,
      shelterProfileId: people.shelterOwner.id,
      shelterId: people.shelterId,
      volunteerId: people.volunteerId,
      status: overrides.status ?? 'active',
      participants: {
        create: [
          { profileId: people.volunteerUser.id, role: 'volunteer' },
          { profileId: people.shelterOwner.id, role: 'shelter' },
        ],
      },
    },
  });
  return thread.id;
}

// shelters tem trigger de histórico; apagar os usuários derruba em cascata
// abrigo, voluntário, vaga, conversas e mensagens.
export async function cleanupChatPeople(
  prisma: PrismaService,
  people: ChatPeople,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`DELETE FROM shelter_history WHERE shelter_id = ${people.shelterId}::uuid`;
    await tx.vacancy.deleteMany({ where: { shelterId: people.shelterId } });
    await tx.shelter.deleteMany({ where: { id: people.shelterId } });
    await tx.user.deleteMany({
      where: {
        id: {
          in: [
            people.shelterOwner.id,
            people.volunteerUser.id,
            people.outsider.id,
          ],
        },
      },
    });
  });
}

export const authCookie = (token: string): string => `mv_at=${token}`;
