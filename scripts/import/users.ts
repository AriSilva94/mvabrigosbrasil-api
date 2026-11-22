import type { Client } from 'pg';

const REGISTER_TYPES = ['abrigo', 'voluntario', 'gerente', 'admin'] as const;

export type RegisterType = (typeof REGISTER_TYPES)[number];

function isRegisterType(value: string): value is RegisterType {
  return (REGISTER_TYPES as readonly string[]).includes(value);
}

export function normalizeRegisterType(raw: unknown): RegisterType | null {
  if (typeof raw !== 'string') return null;

  const normalized = raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

  return isRegisterType(normalized) ? normalized : null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asValidUuidOrNull(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value : null;
}

export interface AuthUserRow {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: Date | string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  full_name: string | null;
  phone: string | null;
  wp_user_id: number | null;
  origin: string | null;
  is_team_only: boolean | null;
}

export interface UserInsert {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerified: boolean;
  fullName: string | null;
  phone: string | null;
  role: RegisterType | null;
  wpUserId: number | null;
  origin: string;
  isTeamOnly: boolean;
  teamDisabled: boolean;
  creatorProfileId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEFAULT_ORIGIN = 'supabase_native';

export function mapAuthUserToUser(row: AuthUserRow): UserInsert {
  const meta = row.raw_user_meta_data ?? {};

  const role = normalizeRegisterType(meta.registerType);
  const isTeamOnly = meta.teamOnly === true || row.is_team_only === true;
  const teamDisabled = meta.teamDisabled === true;
  const creatorProfileId = asValidUuidOrNull(meta.creator_profile_id);

  return {
    id: row.id,
    email: row.email.trim().toLowerCase(),
    passwordHash: row.encrypted_password ?? null,
    emailVerified: true,
    fullName: row.full_name ?? null,
    phone: row.phone ?? null,
    role,
    wpUserId: row.wp_user_id ?? null,
    origin: row.origin ?? DEFAULT_ORIGIN,
    isTeamOnly,
    teamDisabled,
    creatorProfileId,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export const SELECT_JOINED_USERS = `
  SELECT
    u.id,
    u.email,
    u.encrypted_password,
    u.email_confirmed_at,
    u.raw_user_meta_data,
    u.created_at,
    u.updated_at,
    u.deleted_at,
    p.full_name,
    p.phone,
    p.wp_user_id,
    p.origin,
    p.is_team_only
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE u.deleted_at IS NULL
  ORDER BY u.created_at
`;

const BATCH_SIZE = 200;

export const INSERT_COLUMNS = [
  'id',
  'email',
  'password_hash',
  'email_verified',
  'full_name',
  'phone',
  'role',
  'wp_user_id',
  'origin',
  'is_team_only',
  'team_disabled',
  'creator_profile_id',
  'created_at',
  'updated_at',
] as const;

export function toParamRow(u: UserInsert): unknown[] {
  return [
    u.id,
    u.email,
    u.passwordHash,
    u.emailVerified,
    u.fullName,
    u.phone,
    u.role,
    u.wpUserId,
    u.origin,
    u.isTeamOnly,
    u.teamDisabled,
    u.creatorProfileId,
    u.createdAt,
    u.updatedAt,
  ];
}

async function insertBatch(
  target: Client,
  batch: UserInsert[],
): Promise<number> {
  if (batch.length === 0) return 0;

  const columnCount = INSERT_COLUMNS.length;
  const valuesSql = batch
    .map((_, rowIdx) => {
      const placeholders = INSERT_COLUMNS.map(
        (_col, colIdx) => `$${rowIdx * columnCount + colIdx + 1}`,
      ).join(', ');
      return `(${placeholders})`;
    })
    .join(', ');

  const params = batch.flatMap(toParamRow);

  const sql = `
    INSERT INTO users (${INSERT_COLUMNS.join(', ')})
    VALUES ${valuesSql}
    ON CONFLICT (id) DO NOTHING
  `;

  const result = await target.query(sql, params);
  return result.rowCount ?? 0;
}

export interface ImportUsersResult {
  inserted: number;
  skipped: number;
}

export async function importUsers(
  mirror: Client,
  target: Client,
): Promise<ImportUsersResult> {
  const { rows } = await mirror.query<AuthUserRow>(SELECT_JOINED_USERS);
  const mapped = rows.map(mapAuthUserToUser);

  const withoutCreator = mapped.filter((u) => u.creatorProfileId === null);
  const withCreator = mapped.filter((u) => u.creatorProfileId !== null);

  let inserted = 0;

  for (const pass of [withoutCreator, withCreator]) {
    for (let i = 0; i < pass.length; i += BATCH_SIZE) {
      const batch = pass.slice(i, i + BATCH_SIZE);
      inserted += await insertBatch(target, batch);
    }
  }

  return { inserted, skipped: mapped.length - inserted };
}
