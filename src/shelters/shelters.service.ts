import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { hasChanges } from '../common/utils/diff';
import type { UserRole } from '../generated/prisma/enums';
import type { Prisma } from '../generated/prisma/client';
import type { ShelterProfileInput } from './schemas/shelter-profile.schema';
import { unformatDigits } from './schemas/shelter-profile.schema';
import {
  dateOnly,
  mapDbToFormData,
  mapShelterProfileToDb,
  mapShelterToComparable,
  type ShelterProfileDbData,
  type ShelterProfileFormData,
} from './mappers';

export const REQUIRED_SHELTER_FIELDS = [
  'shelter_type',
  'name',
  'cep',
  'street',
  'number',
  'district',
  'state',
  'city',
  'foundation_date',
  'species',
  'referral_source',
  'authorized_name',
  'authorized_role',
  'authorized_email',
  'authorized_phone',
] as const;

export const REQUIRED_VOLUNTEER_FIELDS = [
  'name',
  'telefone',
  'profissao',
  'faixa_etaria',
  'genero',
  'escolaridade',
  'estado',
  'cidade',
  'disponibilidade',
  'periodo',
  'experiencia',
  'atuacao',
  'descricao',
  'referral_source',
] as const;

type ShelterField = (typeof REQUIRED_SHELTER_FIELDS)[number] | 'document';
type VolunteerField = (typeof REQUIRED_VOLUNTEER_FIELDS)[number];
type RegisterType = UserRole | null;

export type ValidateProfileResult = {
  isValid: boolean;
  requiresProfileUpdate: boolean;
  missingFields: Array<ShelterField | VolunteerField>;
  registerType: RegisterType;
  profileExists: boolean;
};

type ValidationRecord = Record<string, unknown>;
const MAX_HISTORY_LIMIT = 100;

export function isFieldEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (typeof value === 'number' && isNaN(value)) return true;
  return false;
}

export function validateShelterFields(data: ValidationRecord): ShelterField[] {
  const missingFields: ShelterField[] = [];

  for (const field of REQUIRED_SHELTER_FIELDS) {
    if (isFieldEmpty(data[field])) {
      missingFields.push(field);
    }
  }

  const hasCnpj = !isFieldEmpty(data.cnpj);
  const hasCpf = !isFieldEmpty(data.cpf);
  const isTemporary = data.shelter_type === 'temporary';

  if (isTemporary && !hasCpf) {
    missingFields.push('document');
  } else if (!isTemporary && !hasCnpj) {
    missingFields.push('document');
  }

  return missingFields;
}

export function validateVolunteerFields(
  data: ValidationRecord,
): VolunteerField[] {
  const missingFields: VolunteerField[] = [];

  for (const field of REQUIRED_VOLUNTEER_FIELDS) {
    if (isFieldEmpty(data[field])) {
      missingFields.push(field);
    }
  }

  return missingFields;
}

function shelterToValidationRecord(row: Record<string, unknown>) {
  return {
    shelter_type: row.shelterType,
    name: row.name,
    cep: row.cep,
    street: row.street,
    number: row.number,
    district: row.district,
    state: row.state,
    city: row.city,
    foundation_date: row.foundationDate,
    species: row.species,
    referral_source: row.referralSource,
    authorized_name: row.authorizedName,
    authorized_role: row.authorizedRole,
    authorized_email: row.authorizedEmail,
    authorized_phone: row.authorizedPhone,
    cnpj: row.cnpj,
    cpf: row.cpf,
  };
}

function volunteerToValidationRecord(row: Record<string, unknown>) {
  return {
    name: row.name,
    telefone: row.telefone,
    profissao: row.profissao,
    faixa_etaria: row.faixaEtaria,
    genero: row.genero,
    escolaridade: row.escolaridade,
    estado: row.estado,
    cidade: row.cidade,
    disponibilidade: row.disponibilidade,
    periodo: row.periodo,
    experiencia: row.experiencia,
    atuacao: row.atuacao,
    descricao: row.descricao,
    referral_source: row.referralSource,
  };
}

function comparePayload(data: ShelterProfileDbData): Record<string, unknown> {
  return {
    ...data,
    foundationDate: dateOnly(data.foundationDate),
  };
}

function preserveLtPopulation(
  data: ShelterProfileDbData,
  existing: {
    initialDogsLt?: number | null;
    initialCatsLt?: number | null;
  } | null,
  parsed: ShelterProfileInput,
): ShelterProfileDbData {
  if (
    !existing ||
    (parsed.shelterType !== 'temporary' && parsed.temporaryAgreement === true)
  ) {
    return data;
  }

  return {
    ...data,
    initialDogsLt: existing.initialDogsLt ?? null,
    initialCatsLt: existing.initialCatsLt ?? null,
  };
}

function normalizePagination(limit: number, offset: number) {
  if (
    !Number.isInteger(limit) ||
    !Number.isInteger(offset) ||
    limit < 1 ||
    offset < 0
  ) {
    throw new BadRequestException('Parâmetros de paginação inválidos');
  }

  return {
    limit: Math.min(limit, MAX_HISTORY_LIMIT),
    offset,
  };
}

function parseAddressNumber(number: string): number {
  const parsed = parseInt(number, 10);
  if (!Number.isInteger(parsed)) {
    throw new BadRequestException('Número inválido');
  }

  return parsed;
}

@Injectable()
export class SheltersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async validateProfile(profileId: string): Promise<ValidateProfileResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: profileId },
    });
    const registerType = user
      ? await this.usersService.resolveRole(user)
      : null;
    const isTeamOnly = Boolean(user?.isTeamOnly);

    if (!user) {
      return {
        isValid: true,
        requiresProfileUpdate: false,
        missingFields: [],
        registerType,
        profileExists: false,
      };
    }

    if (
      registerType === 'admin' ||
      registerType === 'gerente' ||
      isTeamOnly ||
      !registerType
    ) {
      return {
        isValid: true,
        requiresProfileUpdate: false,
        missingFields: [],
        registerType,
        profileExists: true,
      };
    }

    if (registerType === 'abrigo') {
      const shelter = await this.prisma.shelter.findUnique({
        where: { profileId },
      });

      if (!shelter) {
        return {
          isValid: false,
          requiresProfileUpdate: true,
          missingFields: [...REQUIRED_SHELTER_FIELDS],
          registerType,
          profileExists: false,
        };
      }

      const missingFields = validateShelterFields(
        shelterToValidationRecord(shelter),
      );
      const isValid = missingFields.length === 0;

      return {
        isValid,
        requiresProfileUpdate: !isValid,
        missingFields,
        registerType,
        profileExists: true,
      };
    }

    if (registerType === 'voluntario') {
      const volunteer = await this.prisma.volunteer.findFirst({
        where: { ownerProfileId: profileId },
      });

      if (!volunteer) {
        return {
          isValid: false,
          requiresProfileUpdate: true,
          missingFields: [...REQUIRED_VOLUNTEER_FIELDS],
          registerType,
          profileExists: false,
        };
      }

      const missingFields = validateVolunteerFields(
        volunteerToValidationRecord(volunteer),
      );
      const isValid = missingFields.length === 0;

      return {
        isValid,
        requiresProfileUpdate: !isValid,
        missingFields,
        registerType,
        profileExists: true,
      };
    }

    return {
      isValid: true,
      requiresProfileUpdate: false,
      missingFields: [],
      registerType,
      profileExists: false,
    };
  }

  async getMyShelter(
    profileId: string,
  ): Promise<{ shelter: ShelterProfileFormData | null }> {
    const shelter = await this.prisma.shelter.findUnique({
      where: { profileId },
    });
    return { shelter: shelter ? mapDbToFormData(shelter) : null };
  }

  async upsertMyShelter(
    profileId: string,
    parsed: ShelterProfileInput,
  ): Promise<{ ok: true; shelter: ShelterProfileFormData }> {
    const user = await this.prisma.user.findUnique({
      where: { id: profileId },
      select: { id: true },
    });

    if (!user) {
      throw new ConflictException(
        'Perfil do usuário não encontrado. Refaça o login ou contate o suporte.',
      );
    }

    const existingShelter = await this.prisma.shelter.findUnique({
      where: { profileId },
    });
    const payload = preserveLtPopulation(
      mapShelterProfileToDb(profileId, parsed),
      existingShelter,
      parsed,
    );

    if (
      existingShelter &&
      !hasChanges(
        mapShelterToComparable(existingShelter),
        comparePayload(payload),
      )
    ) {
      return {
        ok: true,
        shelter: mapDbToFormData(existingShelter),
      };
    }

    let shelter: Parameters<typeof mapDbToFormData>[0];
    try {
      shelter = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${profileId}, true)`;

        return tx.shelter.upsert({
          where: { profileId },
          create: payload,
          update: payload,
        });
      });
    } catch {
      throw new InternalServerErrorException('Erro ao salvar cadastro');
    }

    return { ok: true, shelter: mapDbToFormData(shelter) };
  }

  async toggleMyShelterActive(
    profileId: string,
  ): Promise<{ ok: true; active: boolean; message: string }> {
    const shelter = await this.prisma.shelter.findUnique({
      where: { profileId },
      select: { active: true },
    });

    if (!shelter) {
      throw new NotFoundException('Cadastro não encontrado');
    }

    const active = !shelter.active;
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${profileId}, true)`;

      return tx.shelter.update({
        where: { profileId },
        data: { active },
        select: { active: true },
      });
    });

    return {
      ok: true,
      active: updated.active,
      message: updated.active
        ? 'Cadastro reativado com sucesso'
        : 'Cadastro inativado com sucesso',
    };
  }

  async getMyShelterHistory(profileId: string, limit = 50, offset = 0) {
    const pagination = normalizePagination(limit, offset);
    const shelter = await this.prisma.shelter.findUnique({
      where: { profileId },
      select: { id: true },
    });

    if (!shelter) {
      return { history: [] };
    }

    const [history, total] = await Promise.all([
      this.prisma.shelterHistory.findMany({
        where: { shelterId: shelter.id },
        orderBy: { changedAt: 'desc' },
        take: pagination.limit,
        skip: pagination.offset,
      }),
      this.prisma.shelterHistory.count({
        where: { shelterId: shelter.id },
      }),
    ]);

    return {
      history: history.map((row) => ({
        id: row.id,
        shelter_id: row.shelterId,
        profile_id: row.profileId,
        operation: row.operation,
        old_data: row.oldData,
        new_data: row.newData,
        changed_fields: row.changedFields,
        changed_at: row.changedAt.toISOString(),
        changed_by: row.changedBy,
      })),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  async checkAddress(
    profileId: string,
    cep: string | undefined,
    street?: string,
    number?: string,
  ) {
    if (!cep) {
      throw new BadRequestException('CEP é obrigatório');
    }

    const where: Prisma.ShelterWhereInput = {
      cep: unformatDigits(cep),
      active: true,
      profileId: { not: profileId },
    };

    if (street && number) {
      where.street = { equals: street.trim(), mode: 'insensitive' };
      where.number = parseAddressNumber(number);
    }

    const shelters = await this.prisma.shelter.findMany({
      where,
      select: {
        profileId: true,
        name: true,
        street: true,
        number: true,
        city: true,
        state: true,
      },
    });

    return {
      exists: shelters.length > 0,
      count: shelters.length,
      shelters: shelters.map((shelter) => ({
        name: shelter.name,
        street: shelter.street,
        number: shelter.number,
        city: shelter.city,
        state: shelter.state,
      })),
    };
  }

  async listSheltersForAdmin() {
    const shelters = await this.prisma.shelter.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, wpPostId: true },
    });

    return {
      shelters: shelters.map((shelter) => ({
        id: shelter.id,
        name: shelter.name,
        wp_post_id: shelter.wpPostId,
      })),
    };
  }
}
