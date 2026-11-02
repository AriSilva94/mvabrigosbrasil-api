import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { VacancyResolver } from '../vacancies/vacancy-resolver';
import { ChatEventsService } from '../chat/chat-events.service';
import { ChatThreadsService } from '../chat/chat-threads.service';

const volunteerSelect = {
  id: true,
  name: true,
  cidade: true,
  estado: true,
  telefone: true,
  profissao: true,
  experiencia: true,
  slug: true,
} as const;

type ApplicationWithVolunteer = Prisma.VacancyApplicationGetPayload<{
  include: { volunteer: { select: typeof volunteerSelect } };
}>;

function hasErrorCode(error: unknown, expected: string): boolean {
  const seen = new Set<object>();
  let current: unknown = error;

  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const record = current as Record<string, unknown>;
    if (record.code === expected) return true;
    current = record.cause ?? record.originalError;
  }

  return false;
}

function mapApplication(row: {
  id: string;
  vacancyId: string;
  volunteerId: string;
  status: string;
  appliedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    vacancy_id: row.vacancyId,
    volunteer_id: row.volunteerId,
    status: row.status,
    applied_at: row.appliedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function mapApplicationWithVolunteer(
  row: ApplicationWithVolunteer,
  threadId: string | null,
) {
  return {
    id: row.id,
    status: row.status,
    applied_at: row.appliedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    volunteers: row.volunteer,
    thread_id: threadId,
  };
}

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: VacancyResolver,
    private readonly chatThreads: ChatThreadsService,
    private readonly chatEvents: ChatEventsService,
  ) {}

  async apply(claims: Claims, identifier: string) {
    let volunteer: { id: string } | null;
    try {
      volunteer = await this.prisma.volunteer.findFirst({
        where: { ownerProfileId: claims.sub },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error('Erro ao buscar perfil de voluntário', error);
      throw new NotFoundException({
        error: 'Perfil de voluntário não encontrado',
      });
    }
    if (!volunteer) {
      throw new NotFoundException({
        error: 'Perfil de voluntário não encontrado',
      });
    }

    let vacancy: Awaited<ReturnType<VacancyResolver['resolveAny']>>;
    try {
      vacancy = await this.resolver.resolveAny(identifier);
    } catch (error) {
      this.logger.error('Erro ao buscar vaga para candidatura', error);
      throw new NotFoundException({ error: 'Vaga não encontrada' });
    }
    if (!vacancy) {
      throw new NotFoundException({ error: 'Vaga não encontrada' });
    }
    if (vacancy.status !== 'active' || !vacancy.isPublished) {
      throw new BadRequestException({
        error: 'Vaga não está disponível para candidaturas',
      });
    }

    const shelter = vacancy.shelterId
      ? await this.prisma.shelter.findUnique({
          where: { id: vacancy.shelterId },
          select: { id: true, profileId: true },
        })
      : null;
    if (!shelter?.profileId) {
      throw new NotFoundException({ error: 'Abrigo não encontrado' });
    }
    const shelterProfileId = shelter.profileId;

    try {
      const { application, threadId, systemMessage } =
        await this.prisma.$transaction(async (tx) => {
          const created = await tx.vacancyApplication.create({
            data: {
              vacancyId: vacancy.id,
              volunteerId: volunteer.id,
              status: 'pending',
            },
          });
          const thread = await this.chatThreads.createForApplication(tx, {
            vacancyId: vacancy.id,
            vacancyTitle: vacancy.title,
            shelterId: shelter.id,
            shelterProfileId,
            volunteerId: volunteer.id,
            volunteerProfileId: claims.sub,
            applicationId: created.id,
          });
          return { application: created, ...thread };
        });

      if (systemMessage) {
        this.chatEvents.messageCreated(systemMessage, [
          claims.sub,
          shelterProfileId,
        ]);
        await this.chatEvents
          .introduce(claims.sub, shelterProfileId)
          .catch((error: unknown) =>
            this.logger.error('Erro ao compartilhar presença', error),
          );
      }
      return {
        application: mapApplication(application),
        thread_id: threadId,
        success: true,
      };
    } catch (error) {
      if (hasErrorCode(error, 'P2002') || hasErrorCode(error, '23505')) {
        throw new ConflictException({
          error: 'Você já se candidatou a esta vaga',
        });
      }
      this.logger.error('Erro ao criar candidatura', error);
      throw new InternalServerErrorException({
        error: 'Erro ao criar candidatura',
      });
    }
  }

  async list(claims: Claims, identifier: string) {
    const shelter = await this.prisma.shelter.findUnique({
      where: { profileId: claims.sub },
      select: { id: true },
    });
    if (!shelter) {
      throw new NotFoundException({ error: 'Abrigo não encontrado' });
    }

    const vacancy = await this.resolver.resolveForShelter(
      identifier,
      shelter.id,
    );
    if (!vacancy) {
      throw new NotFoundException({
        error: 'Vaga não encontrada ou sem permissão',
      });
    }

    try {
      const [applications, threads] = await Promise.all([
        this.prisma.vacancyApplication.findMany({
          where: { vacancyId: vacancy.id },
          orderBy: { appliedAt: 'desc' },
          include: { volunteer: { select: volunteerSelect } },
        }),
        this.chatThreads.threadIdsByVolunteer(vacancy.id),
      ]);
      return {
        applications: applications.map((row) =>
          mapApplicationWithVolunteer(
            row,
            threads.get(row.volunteerId) ?? null,
          ),
        ),
      };
    } catch (error) {
      this.logger.error('Erro ao buscar candidaturas', error);
      throw new InternalServerErrorException({
        error: 'Erro ao buscar candidaturas',
      });
    }
  }
}
