import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import {
  buildVacancySlug,
  extractVacancyIdFromSlug,
} from '../common/utils/slug';
import type { Vacancy, Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { mapPublicVacancyCard, mapVacancyRow } from './mappers';
import type { VacancyFormInput } from './schemas/vacancy.schema';
import { ChatThreadsService } from '../chat/chat-threads.service';
import { VacancyResolver } from './vacancy-resolver';

const sourceVacancy = (row: Vacancy) => ({
  ...mapVacancyRow(row),
  source: 'supabase' as const,
});

@Injectable()
export class VacanciesService {
  private readonly logger = new Logger(VacanciesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: VacancyResolver,
    private readonly chatThreads: ChatThreadsService,
  ) {}

  async list(claims: Claims) {
    const shelter = await this.findShelter(claims.sub, 'Erro ao buscar abrigo');
    if (!shelter) return { vacancies: [] };

    try {
      const rows = await this.prisma.vacancy.findMany({
        where: { shelterId: shelter.id },
        orderBy: { createdAt: 'desc' },
      });
      return { vacancies: rows.map(sourceVacancy) };
    } catch (error) {
      this.logger.error('Erro ao carregar vagas', error);
      throw new InternalServerErrorException({
        error: 'Erro ao carregar vagas',
      });
    }
  }

  async create(claims: Claims, input: VacancyFormInput) {
    const shelter = await this.findShelter(claims.sub, 'Erro ao buscar abrigo');
    if (!shelter) {
      throw new NotFoundException({
        error: 'Abrigo não encontrado para o usuário.',
      });
    }

    let inserted: Vacancy;
    try {
      inserted = await this.prisma.vacancy.create({
        data: this.createData(shelter, input),
      });
    } catch (error) {
      this.logger.error('Erro ao salvar vaga', error);
      throw new InternalServerErrorException({ error: 'Erro ao salvar vaga' });
    }

    const slug = buildVacancySlug(input.post_title, inserted.id);
    let saved = inserted;
    try {
      saved = await this.prisma.vacancy.update({
        where: { id: inserted.id },
        data: { slug },
      });
    } catch (error) {
      this.logger.error('Erro ao atualizar slug da vaga', error);
    }

    return { vacancy: sourceVacancy(saved) };
  }

  async get(claims: Claims, identifier: string) {
    const shelter = await this.requiredShelter(claims.sub);
    let vacancy: Vacancy | null;
    try {
      vacancy = await this.resolver.resolveForShelter(identifier, shelter.id);
    } catch (error) {
      this.logger.error('Erro ao carregar vaga', error);
      throw new InternalServerErrorException({
        error: 'Erro ao carregar vaga',
      });
    }
    if (!vacancy) {
      throw new NotFoundException({ error: 'Vaga não encontrada' });
    }
    return { vacancy: sourceVacancy(vacancy) };
  }

  async update(claims: Claims, identifier: string, input: VacancyFormInput) {
    const shelter = await this.requiredShelter(claims.sub);
    const resolvableId = extractVacancyIdFromSlug(identifier);

    if (!resolvableId) {
      try {
        const created = await this.prisma.vacancy.create({
          data: this.createData(shelter, input),
        });
        if (!created) {
          throw new NotFoundException({ error: 'Vaga não encontrada' });
        }
        return { vacancy: sourceVacancy(created) };
      } catch (error) {
        if (error instanceof NotFoundException) throw error;
        this.logger.error('Erro ao salvar vaga', error);
        throw new InternalServerErrorException({
          error: 'Erro ao salvar vaga',
        });
      }
    }

    try {
      const existing = await this.resolver.resolveForShelter(
        identifier,
        shelter.id,
      );
      if (!existing) {
        throw new NotFoundException({ error: 'Vaga não encontrada' });
      }
      const updated = await this.prisma.vacancy.update({
        where: { id: existing.id, shelterId: shelter.id },
        data: this.updateData(input),
      });
      return { vacancy: sourceVacancy(updated) };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error('Erro ao atualizar vaga', error);
      throw new InternalServerErrorException({
        error: 'Erro ao atualizar vaga',
      });
    }
  }

  async remove(claims: Claims, identifier: string) {
    const shelter = await this.requiredShelter(claims.sub);
    if (!extractVacancyIdFromSlug(identifier)) {
      throw new NotFoundException({ error: 'Vaga não encontrada' });
    }

    let vacancy: Vacancy | null;
    try {
      vacancy = await this.resolver.resolveForShelter(identifier, shelter.id);
    } catch (error) {
      this.logger.error('Erro ao buscar vaga', error);
      throw new InternalServerErrorException({ error: 'Erro ao buscar vaga' });
    }
    if (!vacancy) {
      throw new NotFoundException({
        error: 'Vaga não encontrada ou sem permissão',
      });
    }

    try {
      await this.prisma.vacancy.deleteMany({
        where: { id: vacancy.id, shelterId: shelter.id },
      });
    } catch (error) {
      this.logger.error('Erro ao deletar vaga', error);
      throw new InternalServerErrorException({
        error: 'Erro ao deletar vaga',
      });
    }
    return { success: true, message: 'Vaga deletada com sucesso' };
  }

  async getMyStatus(claims: Claims | undefined, identifier: string) {
    const empty = {
      isOwner: false,
      hasApplied: false,
      threadId: null,
      shelterProfileId: null,
    };
    if (!claims) return empty;

    try {
      const shelter = await this.prisma.shelter.findUnique({
        where: { profileId: claims.sub },
        select: { id: true },
      });
      if (shelter) {
        const ownVacancy = await this.resolver.resolveForShelter(
          identifier,
          shelter.id,
        );
        if (ownVacancy) return { ...empty, isOwner: true };
      }

      const vacancy = await this.resolver.resolvePublic(identifier);
      if (!vacancy) return empty;
      const volunteer = await this.prisma.volunteer.findFirst({
        where: { ownerProfileId: claims.sub },
        select: { id: true },
      });
      if (!volunteer) return empty;
      const application = await this.prisma.vacancyApplication.findFirst({
        where: { vacancyId: vacancy.id, volunteerId: volunteer.id },
        select: { id: true },
      });
      if (!application) return empty;
      const thread = await this.chatThreads.findForApplicant(
        vacancy.id,
        claims.sub,
      );
      return {
        isOwner: false,
        hasApplied: true,
        threadId: thread?.id ?? null,
        shelterProfileId: thread?.shelterProfileId ?? null,
      };
    } catch (error) {
      this.logger.error('Erro ao consultar status da vaga', error);
      return empty;
    }
  }

  async listPublic() {
    try {
      const rows = await this.prisma.vacancy.findMany({
        where: { status: 'active', isPublished: true },
        orderBy: { createdAt: 'desc' },
      });
      return { vacancies: rows.map(mapPublicVacancyCard) };
    } catch (error) {
      this.logger.error('Erro ao buscar vagas públicas', error);
      return { vacancies: [] };
    }
  }

  async getPublic(slug: string) {
    const normalized = slug?.trim();
    if (!normalized) {
      throw new NotFoundException({ error: 'Vaga não encontrada' });
    }

    let row: Vacancy | null = null;
    try {
      row = await this.prisma.vacancy.findFirst({
        where: {
          slug: normalized,
          status: 'active',
          isPublished: true,
        },
      });
    } catch (error) {
      this.logger.error('Erro ao buscar vaga pública por slug', error);
    }

    if (!row) {
      try {
        row = await this.resolver.resolvePublic(normalized);
      } catch (error) {
        this.logger.error('Erro ao buscar vaga pública por id', error);
      }
    }
    if (!row) {
      throw new NotFoundException({ error: 'Vaga não encontrada' });
    }
    return sourceVacancy(row);
  }

  private async findShelter(profileId: string, errorMessage: string) {
    try {
      return await this.prisma.shelter.findUnique({
        where: { profileId },
        select: { id: true, city: true, state: true },
      });
    } catch (error) {
      this.logger.error(errorMessage, error);
      throw new InternalServerErrorException({ error: errorMessage });
    }
  }

  private async requiredShelter(profileId: string) {
    const shelter = await this.findShelter(profileId, 'Erro ao buscar abrigo');
    if (!shelter) {
      throw new NotFoundException({ error: 'Abrigo não encontrado' });
    }
    return shelter;
  }

  private createData(
    shelter: { id: string; city: string | null; state: string | null },
    input: VacancyFormInput,
  ): Prisma.VacancyUncheckedCreateInput {
    return {
      shelterId: shelter.id,
      title: input.post_title,
      description: input.post_content,
      cidade: shelter.city,
      estado: shelter.state,
      areaAtuacao: input.post_area_atuacao,
      cargaHoraria: input.post_carga,
      periodo: input.post_periodo,
      quantidade: input.post_quantidade,
      isPublished: input.post_is_published,
      habilidadesEFuncoes: input.post_habilidades_e_funcoes,
      perfilDosVoluntarios: input.post_perfil_dos_voluntarios,
      tipoDemanda: input.post_tipo_demanda,
      status: 'active',
    };
  }

  private updateData(input: VacancyFormInput): Prisma.VacancyUpdateInput {
    return {
      title: input.post_title,
      description: input.post_content,
      areaAtuacao: input.post_area_atuacao,
      cargaHoraria: input.post_carga,
      periodo: input.post_periodo,
      quantidade: input.post_quantidade,
      isPublished: input.post_is_published,
      habilidadesEFuncoes: input.post_habilidades_e_funcoes,
      perfilDosVoluntarios: input.post_perfil_dos_voluntarios,
      tipoDemanda: input.post_tipo_demanda,
    };
  }
}
