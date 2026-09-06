import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import { hasChanges } from '../common/utils/diff';
import { generateVolunteerSlug, stripIdSuffix } from '../common/utils/slug';
import type { Prisma, Volunteer } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  mapDbToFormData,
  mapPublicVolunteerCard,
  mapPublicVolunteerProfile,
  mapVolunteerProfileToDb,
  mapVolunteerToComparable,
} from './mappers';
import type { VolunteerProfileInput } from './schemas/volunteer-profile.schema';

@Injectable()
export class VolunteersService {
  private readonly logger = new Logger(VolunteersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMe(claims: Claims) {
    let volunteer: Volunteer | null;
    try {
      volunteer = await this.prisma.volunteer.findFirst({
        where: { ownerProfileId: claims.sub },
      });
    } catch (error) {
      this.logger.error('volunteers GET me: erro ao consultar cadastro', error);
      throw new InternalServerErrorException({
        error: 'Erro ao consultar cadastro',
      });
    }

    if (!volunteer) return { volunteer: null };

    try {
      return { volunteer: mapDbToFormData(volunteer) };
    } catch (error) {
      this.logger.error('volunteers GET me: erro inesperado', error);
      throw new InternalServerErrorException({
        error: 'Erro ao carregar cadastro',
      });
    }
  }

  async saveMe(claims: Claims, input: VolunteerProfileInput) {
    let user: { id: string } | null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { id: true },
      });
    } catch (error) {
      this.logger.error('volunteers POST me: erro ao validar usuário', error);
      throw new InternalServerErrorException({
        error: 'Erro ao validar usuário',
      });
    }

    if (!user) {
      throw new ConflictException({
        error:
          'Perfil do usuário não encontrado. Refaça o login ou contate o suporte.',
      });
    }

    let existing: Volunteer | null;
    try {
      existing = await this.prisma.volunteer.findFirst({
        where: { ownerProfileId: claims.sub },
      });
    } catch (error) {
      this.logger.error(
        'volunteers POST me: erro ao consultar cadastro existente',
        error,
      );
      throw new InternalServerErrorException({
        error: 'Erro ao consultar cadastro',
      });
    }

    const data = mapVolunteerProfileToDb(claims.sub, input);
    if (
      existing?.slug &&
      !hasChanges(mapVolunteerToComparable(existing), data)
    ) {
      return { ok: true, volunteer: mapDbToFormData(existing) };
    }

    let saved: Volunteer;
    try {
      if (existing) {
        saved = await this.prisma.volunteer.update({
          where: { id: existing.id },
          data: existing.slug
            ? data
            : {
                ...data,
                slug: generateVolunteerSlug(data.name, existing.id),
              },
        });
      } else {
        saved = await this.prisma.$transaction(async (tx) => {
          const created = await tx.volunteer.create({ data });
          return tx.volunteer.update({
            where: { id: created.id },
            data: { slug: generateVolunteerSlug(created.name, created.id) },
          });
        });
      }
    } catch (error) {
      this.logger.error('volunteers POST me: erro ao salvar cadastro', error);
      throw new InternalServerErrorException({
        error: 'Erro ao salvar cadastro',
      });
    }

    return { ok: true, volunteer: mapDbToFormData(saved) };
  }

  async listPublic() {
    try {
      const volunteers = await this.prisma.volunteer.findMany({
        where: { acceptTerms: true, isPublic: true },
        orderBy: { createdAt: 'desc' },
      });
      return { volunteers: volunteers.map(mapPublicVolunteerCard) };
    } catch (error) {
      this.logger.error('volunteers GET: erro ao buscar voluntários', error);
      return { volunteers: [] };
    }
  }

  async getPublic(slug: string) {
    const lookupSlug = slug?.trim();
    if (!lookupSlug) {
      throw new NotFoundException({ error: 'Voluntário não encontrado' });
    }

    const baseSlug = stripIdSuffix(lookupSlug);
    let queryFailed = false;
    let row: PublicVolunteer | null = null;

    try {
      row = await this.findPublicBySlug(lookupSlug);
    } catch (error) {
      queryFailed = true;
      this.logger.error(
        'volunteers GET slug: erro na consulta por slug exato',
        error,
      );
    }

    if (!row && baseSlug && baseSlug !== lookupSlug) {
      try {
        row = await this.findPublicBySlug(baseSlug);
      } catch (error) {
        queryFailed = true;
        this.logger.error(
          'volunteers GET slug: erro na consulta por slug base',
          error,
        );
      }
    }

    if (queryFailed || !row) {
      throw new NotFoundException({ error: 'Voluntário não encontrado' });
    }

    return mapPublicVolunteerProfile(row);
  }

  private findPublicBySlug(slug: string): Promise<PublicVolunteer | null> {
    return this.prisma.volunteer.findFirst({
      where: { slug, acceptTerms: true, isPublic: true },
      include: { owner: { select: { email: true } } },
    });
  }
}

type PublicVolunteer = Prisma.VolunteerGetPayload<{
  include: { owner: { select: { email: true } } };
}>;
