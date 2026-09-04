import {
  mapAuthUserToUser,
  normalizeRegisterType,
  type AuthUserRow,
} from './users';

/**
 * All rows below are SYNTHETIC — shaped like real `auth.users` LEFT JOIN
 * `public.profiles` rows, but no real user data.
 */
function baseRow(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    email: 'synthetic@example.com',
    encrypted_password: '$2a$06$syntheticHashSyntheticHashSyntheticHash',
    email_confirmed_at: new Date('2024-01-01T00:00:00Z'),
    raw_user_meta_data: {},
    created_at: new Date('2024-01-01T00:00:00Z'),
    updated_at: new Date('2024-01-02T00:00:00Z'),
    deleted_at: null,
    full_name: 'Synthetic Person',
    phone: '+5511999990000',
    wp_user_id: null,
    origin: 'supabase_native',
    is_team_only: false,
    ...overrides,
  };
}

describe('normalizeRegisterType', () => {
  it('accepts the four known register types', () => {
    expect(normalizeRegisterType('abrigo')).toBe('abrigo');
    expect(normalizeRegisterType('voluntario')).toBe('voluntario');
    expect(normalizeRegisterType('gerente')).toBe('gerente');
    expect(normalizeRegisterType('admin')).toBe('admin');
  });

  it('strips accents and lowercases before matching', () => {
    expect(normalizeRegisterType('voluntário')).toBe('voluntario');
    expect(normalizeRegisterType('ABRIGO')).toBe('abrigo');
    expect(normalizeRegisterType('  Gerente  ')).toBe('gerente');
  });

  it('returns null for unknown or missing values', () => {
    expect(normalizeRegisterType('curador')).toBeNull();
    expect(normalizeRegisterType(undefined)).toBeNull();
    expect(normalizeRegisterType(null)).toBeNull();
    expect(normalizeRegisterType(123)).toBeNull();
  });
});

describe('mapAuthUserToUser', () => {
  it('happy path: abrigo role, not team-only, wp_user_id from profile', () => {
    const row = baseRow({
      wp_user_id: 42,
      raw_user_meta_data: { registerType: 'abrigo', teamOnly: false },
    });

    const result = mapAuthUserToUser(row);

    expect(result.role).toBe('abrigo');
    expect(result.isTeamOnly).toBe(false);
    expect(result.wpUserId).toBe(42);
  });

  it('gerente: a value that does not exist in the production enum, only in the JSON', () => {
    const row = baseRow({ raw_user_meta_data: { registerType: 'gerente' } });

    expect(mapAuthUserToUser(row).role).toBe('gerente');
  });

  it('accented registerType is normalized (voluntário -> voluntario)', () => {
    const row = baseRow({ raw_user_meta_data: { registerType: 'voluntário' } });

    expect(mapAuthUserToUser(row).role).toBe('voluntario');
  });

  it('no registerType in metadata: role is null, does not throw', () => {
    const row = baseRow({ raw_user_meta_data: {} });

    expect(() => mapAuthUserToUser(row)).not.toThrow();
    expect(mapAuthUserToUser(row).role).toBeNull();
  });

  it('team: teamOnly true and a creator_profile_id uuid are carried through', () => {
    const creatorId = '22222222-2222-2222-2222-222222222222';
    const row = baseRow({
      raw_user_meta_data: { teamOnly: true, creator_profile_id: creatorId },
    });

    const result = mapAuthUserToUser(row);

    expect(result.isTeamOnly).toBe(true);
    expect(result.creatorProfileId).toBe(creatorId);
  });

  it('disabled: teamDisabled true is carried through', () => {
    const row = baseRow({ raw_user_meta_data: { teamDisabled: true } });

    expect(mapAuthUserToUser(row).teamDisabled).toBe(true);
  });

  it('no creator_profile_id in metadata: creatorProfileId is null', () => {
    const row = baseRow({ raw_user_meta_data: { teamOnly: false } });

    expect(mapAuthUserToUser(row).creatorProfileId).toBeNull();
  });

  it('email is lowercased and trimmed', () => {
    const row = baseRow({ email: '  Foo@Bar.COM ' });

    expect(mapAuthUserToUser(row).email).toBe('foo@bar.com');
  });

  it('password hash is copied literally, never rehashed', () => {
    const literalHash = '$2a$06$abcdefghijklmnopqrstuv';
    const row = baseRow({ encrypted_password: literalHash });

    expect(mapAuthUserToUser(row).passwordHash).toBe(literalHash);
  });

  it('unconfirmed email: emailVerified is false', () => {
    const row = baseRow({ email_confirmed_at: null });

    expect(mapAuthUserToUser(row).emailVerified).toBe(false);
  });

  it('confirmed email: emailVerified is true', () => {
    const row = baseRow({
      email_confirmed_at: new Date('2024-01-01T00:00:00Z'),
    });

    expect(mapAuthUserToUser(row).emailVerified).toBe(true);
  });

  it('isTeamOnly is true when profiles.is_team_only is true even if the JSON omits teamOnly', () => {
    const row = baseRow({ is_team_only: true, raw_user_meta_data: {} });

    expect(mapAuthUserToUser(row).isTeamOnly).toBe(true);
  });

  it('carries fullName, phone and origin from the joined profile row', () => {
    const row = baseRow({
      full_name: 'Fulano da Silva',
      phone: '+5511988887777',
      origin: 'wordpress_migrated',
    });

    const result = mapAuthUserToUser(row);

    expect(result.fullName).toBe('Fulano da Silva');
    expect(result.phone).toBe('+5511988887777');
    expect(result.origin).toBe('wordpress_migrated');
  });

  it('falls back to supabase_native origin when the profile row is missing (no LEFT JOIN match)', () => {
    const row = baseRow({
      full_name: null,
      phone: null,
      origin: null,
      is_team_only: null,
    });

    expect(mapAuthUserToUser(row).origin).toBe('supabase_native');
  });
});
