import { Injectable } from '@nestjs/common';
import { extractVacancyIdFromSlug } from '../common/utils/slug';
import type { Vacancy } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type IdRow = { id: string };

@Injectable()
export class VacancyResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveForShelter(
    identifier: string,
    shelterId: string,
  ): Promise<Vacancy | null> {
    const id = extractVacancyIdFromSlug(identifier);
    if (!id) return null;

    if (id.length > 8) {
      return this.prisma.vacancy.findFirst({ where: { id, shelterId } });
    }

    const matches = await this.prisma.$queryRaw<IdRow[]>`
      SELECT id
      FROM vacancies
      WHERE CAST(id AS text) LIKE ${`${id}%`}
        AND shelter_id = ${shelterId}::uuid
      LIMIT 2
    `;
    if (matches.length !== 1) return null;

    return this.prisma.vacancy.findFirst({
      where: { id: matches[0].id, shelterId },
    });
  }

  async resolvePublic(identifier: string): Promise<Vacancy | null> {
    return this.resolve(identifier, true);
  }

  async resolveAny(identifier: string): Promise<Vacancy | null> {
    return this.resolve(identifier, false);
  }

  private async resolve(
    identifier: string,
    publicOnly: boolean,
  ): Promise<Vacancy | null> {
    const id = extractVacancyIdFromSlug(identifier);
    if (!id) return null;
    const publicFilter = publicOnly
      ? { status: 'active', isPublished: true }
      : {};

    if (id.length > 8) {
      return this.prisma.vacancy.findFirst({
        where: { id, ...publicFilter },
      });
    }

    const matches = publicOnly
      ? await this.prisma.$queryRaw<IdRow[]>`
          SELECT id
          FROM vacancies
          WHERE CAST(id AS text) LIKE ${`${id}%`}
            AND status = 'active'
            AND is_published = true
          LIMIT 2
        `
      : await this.prisma.$queryRaw<IdRow[]>`
          SELECT id
          FROM vacancies
          WHERE CAST(id AS text) LIKE ${`${id}%`}
          LIMIT 2
        `;
    if (matches.length !== 1) return null;

    return this.prisma.vacancy.findFirst({
      where: { id: matches[0].id, ...publicFilter },
    });
  }
}
