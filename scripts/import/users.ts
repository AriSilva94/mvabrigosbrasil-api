import type { Client } from 'pg';

/**
 * Register types recognized by the app. Mirrors, key for key, the frontend's
 * `src/constants/registerTypes.ts` (mvabrigosbrasil repo) so that whatever the
 * old signup flow wrote into `raw_user_meta_data.registerType` is normalized
 * the exact same way here. Kept as a plain string union (not the generated
 * Prisma enum type) so this module has zero compile-time dependency on the
 * generated client.
 */
const REGISTER_TYPES = ['abrigo', 'voluntario', 'gerente', 'admin'] as const;

export type RegisterType = (typeof REGISTER_TYPES)[number];

function isRegisterType(value: string): value is RegisterType {
  return (REGISTER_TYPES as readonly string[]).includes(value);
}

/**
 * Replicates the frontend's `normalizeRegisterType` (mvabrigosbrasil,
 * src/constants/registerTypes.ts): strip diacritics, trim, lowercase, accept
 * only the four known register types, otherwise null. Never throws.
 */
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

/**
 * Shape of one row produced by:
 *
 *   SELECT u.*, p.full_name, p.phone, p.wp_user_id, p.origin, p.is_team_only
 *   FROM auth.users u
 *   LEFT JOIN public.profiles p ON p.id = u.id
 *
 * The profile-only columns are nullable because of the LEFT JOIN (a user can
 * exist in `auth.users` with no matching `profiles` row).
 */
export interface AuthUserRow {
  id: string;
  email: string;
  encrypted_password: string | null;
  email_confirmed_at: Date | string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
  // From the LEFT JOIN on public.profiles:
  full_name: string | null;
  phone: string | null;
  wp_user_id: number | null;
  origin: string | null;
  is_team_only: boolean | null;
}

/**
 * The row shape ready to insert into the target `users` table (camelCase,
 * matching the Prisma `User` model from Task 2).
 */
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

/**
 * Pure mapping function: `auth.users` (+ `profiles` via LEFT JOIN) + the JSON
 * in `raw_user_meta_data` -> the target `users` row. No I/O, no throwing.
 */
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
    emailVerified: row.email_confirmed_at != null,
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

const SELECT_JOINED_USERS = `
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

const INSERT_COLUMNS = [
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

function toParamRow(u: UserInsert): unknown[] {
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

async function insertBatch(target: Client, batch: UserInsert[]): Promise<number> {
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

/**
 * Imports every non-deleted `auth.users` row (LEFT JOINed with
 * `public.profiles`) into the target `users` table.
 *
 * Two passes, because `creator_profile_id` is a self-referencing FK on
 * `users`: first every row whose `creatorProfileId` is null, then the rest
 * (their creators are guaranteed to already exist after pass 1).
 *
 * Insertion is batched (200 rows/statement) with `ON CONFLICT (id) DO
 * NOTHING`, so the whole import is safely re-runnable.
 */
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
