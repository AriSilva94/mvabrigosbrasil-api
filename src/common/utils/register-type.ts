import { UserRole } from '../../generated/prisma/enums';

// Espelha `normalizeRegisterType`/`isRegisterType` de
// `src/constants/registerTypes.ts` no front (mesmos literais de `UserRole`),
// usado para normalizar `wp_posts_raw.post_type` antes de mapear para `role`.
const VALID_ROLES = new Set<string>(Object.values(UserRole));

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

export function isRegisterType(value?: string | null): value is UserRole {
  return typeof value === 'string' && VALID_ROLES.has(value);
}

export function normalizeRegisterType(raw?: unknown): UserRole | null {
  if (typeof raw !== 'string') return null;

  const normalized = raw
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .trim()
    .toLowerCase();

  return isRegisterType(normalized) ? normalized : null;
}
