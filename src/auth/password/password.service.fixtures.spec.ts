import { PasswordService } from './password.service';
import fixtures from './__fixtures__/legacy-hashes.json';

describe('PasswordService (legacy hash fixtures)', () => {
  const service = new PasswordService({ get: () => 10 } as never);

  it.each(fixtures)(
    'verifies $format hash correctly',
    async ({ hash, password, format }) => {
      const result = await service.verify(password, hash);
      expect(result.valid).toBe(true);
      expect(result.needsRehash).toBe(format !== 'gotrue');
    },
  );

  it.each(fixtures)(
    'rejects wrong password for $format hash',
    async ({ hash }) => {
      const result = await service.verify('WRONG_PASSWORD', hash);
      expect(result.valid).toBe(false);
    },
  );
});
