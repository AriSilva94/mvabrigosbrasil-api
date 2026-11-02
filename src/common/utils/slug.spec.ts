import {
  buildVacancySlug,
  extractVacancyIdFromSlug,
  generateVolunteerSlug,
  resolveSlug,
  stripIdSuffix,
} from './slug';

describe('slug utils', () => {
  const uuid = '123e4567-e89b-12d3-a456-426614174000';

  describe('buildVacancySlug', () => {
    it('normalizes accents and appends the 8-character uuid suffix', () => {
      expect(buildVacancySlug('Cuidador de Cães São João', uuid)).toBe(
        'cuidador-de-caes-sao-joao-123e4567',
      );
    });
  });

  describe('extractVacancyIdFromSlug', () => {
    it('returns the full uuid when the slug is a uuid', () => {
      expect(extractVacancyIdFromSlug(uuid)).toBe(uuid);
    });

    it('returns the 8-character id prefix when the slug ends with one', () => {
      expect(extractVacancyIdFromSlug('cuidador-de-caes-123e4567')).toBe(
        '123e4567',
      );
    });

    it('returns null when the slug does not contain a uuid or id prefix', () => {
      expect(extractVacancyIdFromSlug('cuidador-de-caes')).toBeNull();
      expect(extractVacancyIdFromSlug('')).toBeNull();
    });
  });

  describe('volunteer slugs', () => {
    it('normalizes accents and appends the 8-character uuid suffix', () => {
      expect(generateVolunteerSlug('João da Conceição', uuid)).toBe(
        'joao-da-conceicao-123e4567',
      );
    });

    it('resolves a database slug by preserving text and ensuring the id suffix', () => {
      expect(resolveSlug('maria-silva-deadbeef', 'Maria Silva', uuid)).toBe(
        'maria-silva-123e4567',
      );
      expect(resolveSlug(null, 'Maria Silva', uuid)).toBe(
        'maria-silva-123e4567',
      );
    });

    it('strips an 8-character id suffix only when present', () => {
      expect(stripIdSuffix('joao-da-conceicao-123e4567')).toBe(
        'joao-da-conceicao',
      );
      expect(stripIdSuffix('joao-da-conceicao')).toBe('joao-da-conceicao');
    });
  });
});
