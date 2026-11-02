const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_PREFIX_REGEX = /^[0-9a-f]{8}$/i;
const ID_SUFFIX_REGEX = /^[0-9a-f]{8}$/i;

function slugifyTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function slugifyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function getIdSuffix(id: string): string {
  return id.replace(/-/g, '').slice(0, 8) || 'novo';
}

function ensureSlugHasIdSuffix(slug: string, id: string): string {
  const idSuffix = getIdSuffix(id);
  const cleanedSlug = slug.replace(/-+$/, '');
  const parts = cleanedSlug.split('-');
  const lastSegment = parts.at(-1) ?? '';

  if (lastSegment.toLowerCase() === idSuffix.toLowerCase()) {
    return cleanedSlug;
  }

  if (ID_SUFFIX_REGEX.test(lastSegment)) {
    parts.pop();
    return `${parts.join('-')}-${idSuffix}`;
  }

  return `${cleanedSlug}-${idSuffix}`;
}

export function buildVacancySlug(title: string, id: string): string {
  const base = slugifyTitle(title || 'vaga');
  const idPrefix = id.replace(/-/g, '').slice(0, 8) || 'nova';
  return `${base}-${idPrefix}`;
}

export function extractVacancyIdFromSlug(slug: string): string | null {
  if (!slug) return null;
  if (UUID_REGEX.test(slug)) return slug;
  const segments = slug.split('-');
  const maybeId = segments.at(-1) ?? '';
  if (UUID_PREFIX_REGEX.test(maybeId)) return maybeId;
  return null;
}

export function stripIdSuffix(slug: string): string {
  const parts = slug.split('-');
  if (parts.length <= 1) return slug;

  const lastSegment = parts.at(-1) ?? '';
  if (!ID_SUFFIX_REGEX.test(lastSegment)) return slug;

  parts.pop();
  return parts.join('-');
}

export function generateVolunteerSlug(name: string, id: string): string {
  const base = slugifyName(name || 'voluntario');
  return ensureSlugHasIdSuffix(base, id);
}

export function resolveSlug(
  slugFromDb: string | null | undefined,
  name: string,
  id: string,
): string {
  const base =
    typeof slugFromDb === 'string'
      ? slugFromDb
      : slugifyName(name || 'voluntario');
  return ensureSlugHasIdSuffix(base, id);
}
