import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Claims } from '../auth/jwt/token.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildDisplay,
  buildPopulationSummary,
  type DynamicsDisplay,
} from './calc';
import type { DynamicsSubmit } from './schemas/dynamics.schema';
import { CacheInvalidationService } from '../redis/cache-invalidation.service';

const shelterSelect = {
  id: true,
  name: true,
  shelterType: true,
  temporaryAgreement: true,
  initialDogs: true,
  initialCats: true,
  initialDogsLt: true,
  initialCatsLt: true,
} as const;

export type DynamicsShelter = {
  id: string;
  name: string;
  shelterType: string | null;
  temporaryAgreement: boolean | null;
  initialDogs: number | null;
  initialCats: number | null;
  initialDogsLt: number | null;
  initialCatsLt: number | null;
};

export type PopulationUserSummary = {
  displayName: string | null;
  totalAnimals: number | null;
  shelterTypeLabel: string | null;
  hasTemporaryAgreement: boolean;
  dogsCount: number | null;
  catsCount: number | null;
  totalAnimalsLt: number | null;
  dogsCountLt: number | null;
  catsCountLt: number | null;
};

const SHELTER_TYPE_LABELS: Record<string, string> = {
  public: 'Público',
  private: 'Privado',
  mixed: 'Misto',
  temporary: 'LT/PI',
};

function parseTemporaryAgreementValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;

  const normalizedValue = value.trim().toLowerCase();
  if (normalizedValue === 'true' || normalizedValue === 'sim') return true;
  if (normalizedValue === 'false' || normalizedValue === 'nao') return false;
  return null;
}

@Injectable()
export class DynamicsService {
  private readonly logger = new Logger(DynamicsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidation: CacheInvalidationService,
  ) {}

  async resolveShelter(
    claims: Claims,
    wpPostId?: number | null,
  ): Promise<DynamicsShelter | null> {
    if (wpPostId !== null && wpPostId !== undefined) {
      if (claims.role !== 'gerente') return null;

      const user = await this.prisma.user.findUnique({
        where: { id: claims.sub },
        select: { wpUserId: true },
      });
      if (user?.wpUserId === null || user?.wpUserId === undefined) {
        return null;
      }

      const membership = await this.prisma.teamMembership.findFirst({
        where: {
          memberWpUserId: BigInt(user.wpUserId),
          abrigoPostId: BigInt(wpPostId),
          role: 'manager',
          status: 'active',
        },
        select: { id: true },
      });
      if (!membership) return null;

      return this.prisma.shelter.findUnique({
        where: { wpPostId },
        select: shelterSelect,
      });
    }

    const ownedShelter = await this.prisma.shelter.findUnique({
      where: { profileId: claims.sub },
      select: shelterSelect,
    });
    if (ownedShelter) return ownedShelter;

    if (claims.isTeamOnly && claims.creatorProfileId) {
      return this.prisma.shelter.findUnique({
        where: { profileId: claims.creatorProfileId },
        select: shelterSelect,
      });
    }

    return null;
  }

  private async fetchDynamicsDisplays(
    shelter: DynamicsShelter,
  ): Promise<DynamicsDisplay[]> {
    let records: Awaited<
      ReturnType<PrismaService['shelterDynamics']['findMany']>
    > = [];
    try {
      records = await this.prisma.shelterDynamics.findMany({
        where: { shelterId: shelter.id },
      });
    } catch (error) {
      this.logger.error(
        'Erro ao buscar registros de dinâmica populacional',
        error instanceof Error ? error.stack : String(error),
      );
    }
    const population = buildPopulationSummary(shelter);

    return [
      buildDisplay(
        records,
        'dinamica',
        population.shelterPopulationInitial,
        population.shelterPopulationInitial,
        population.shelterPopulationInitialDogs,
        population.shelterPopulationInitialCats,
      ),
      buildDisplay(
        records,
        'dinamica_lar',
        population.ltPopulationInitial,
        population.ltPopulationInitial,
        population.ltPopulationInitialDogs,
        population.ltPopulationInitialCats,
      ),
    ];
  }

  async getDynamics(claims: Claims, wpPostId?: number | null) {
    const shelter = await this.resolveShelter(claims, wpPostId);
    if (!shelter) return { sections: [] };

    return { sections: await this.fetchDynamicsDisplays(shelter) };
  }

  async saveDynamics(claims: Claims, payload: DynamicsSubmit) {
    const shelter = await this.resolveShelter(claims);
    if (!shelter) {
      throw new NotFoundException({ error: 'shelter_not_found' });
    }

    const referencePeriod = `${payload.year}-${payload.month}`;
    const data = {
      shelterId: shelter.id,
      kind: payload.dynamicType === 'dinamica_lar' ? 'lar' : 'abrigo',
      dynamicType: payload.dynamicType,
      referencePeriod,
      referenceDate: new Date(`${referencePeriod}-01T00:00:00.000Z`),
      entradasDeAnimais: payload.entries,
      entradasDeGatos: payload.entriesCats,
      adocoesCaes: payload.adoptions,
      adocoesGatos: payload.adoptionsCats,
      devolucoesCaes: payload.returns,
      devolucoesGatos: payload.returnsCats,
      eutanasiasCaes: payload.euthanasias,
      eutanasiasGatos: payload.euthanasiasCats,
      mortesNaturaisCaes: payload.naturalDeaths,
      mortesNaturaisGatos: payload.naturalDeathsCats,
      doencasCaes: payload.diseases,
      doencasGatos: payload.diseasesCats,
      retornoDeCaes: payload.tutorReturn,
      retornoDeGatos: payload.tutorReturnCats,
      retornoLocalCaes: payload.originReturn,
      retornoLocalGatos: payload.originReturnCats,
    };

    try {
      await this.prisma.shelterDynamics.upsert({
        where: {
          shelterId_dynamicType_referencePeriod: {
            shelterId: shelter.id,
            dynamicType: payload.dynamicType,
            referencePeriod,
          },
        },
        create: data,
        update: data,
      });
    } catch (error) {
      this.logger.error(
        'Erro ao salvar registro de dinâmica populacional',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException({ error: 'save_failed' });
    }

    await this.cacheInvalidation.invalidatePublicData();

    return { sections: await this.fetchDynamicsDisplays(shelter) };
  }

  async deleteDynamics(claims: Claims, rowId: string) {
    const shelter = await this.resolveShelter(claims);
    if (!shelter) {
      throw new NotFoundException({ error: 'shelter_not_found' });
    }

    try {
      await this.prisma.shelterDynamics.deleteMany({
        where: { id: rowId, shelterId: shelter.id },
      });
    } catch (error) {
      this.logger.error(
        'Erro ao excluir registro de dinâmica populacional',
        error instanceof Error ? error.stack : String(error),
      );
      throw new InternalServerErrorException({ error: 'delete_failed' });
    }

    await this.cacheInvalidation.invalidatePublicData();

    return { sections: await this.fetchDynamicsDisplays(shelter) };
  }

  async getSummary(
    claims: Claims,
    wpPostId?: number | null,
  ): Promise<{ summary: PopulationUserSummary; shelterId: string | null }> {
    const profile = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { fullName: true, email: true },
    });
    const shelter = await this.resolveShelter(claims, wpPostId);

    const hasDogs = typeof shelter?.initialDogs === 'number';
    const hasCats = typeof shelter?.initialCats === 'number';
    const hasDogsLt = typeof shelter?.initialDogsLt === 'number';
    const hasCatsLt = typeof shelter?.initialCatsLt === 'number';
    const totalAnimals =
      hasDogs || hasCats
        ? (shelter?.initialDogs ?? 0) + (shelter?.initialCats ?? 0)
        : null;
    const totalAnimalsLt =
      hasDogsLt || hasCatsLt
        ? (shelter?.initialDogsLt ?? 0) + (shelter?.initialCatsLt ?? 0)
        : null;
    const displayName = wpPostId
      ? (shelter?.name ?? null)
      : profile?.fullName || profile?.email || claims.email || null;

    return {
      summary: {
        displayName,
        totalAnimals,
        shelterTypeLabel: shelter?.shelterType
          ? (SHELTER_TYPE_LABELS[shelter.shelterType] ?? null)
          : null,
        hasTemporaryAgreement:
          parseTemporaryAgreementValue(shelter?.temporaryAgreement) === true,
        dogsCount: hasDogs ? (shelter?.initialDogs ?? 0) : null,
        catsCount: hasCats ? (shelter?.initialCats ?? 0) : null,
        totalAnimalsLt,
        dogsCountLt: hasDogsLt ? (shelter?.initialDogsLt ?? 0) : null,
        catsCountLt: hasCatsLt ? (shelter?.initialCatsLt ?? 0) : null,
      },
      shelterId: shelter?.id ?? null,
    };
  }
}
