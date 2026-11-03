import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { PasswordService } from './password.service';
import { generateWordpressHash } from '../legacy/wordpress-password';

describe('PasswordService', () => {
  const service = new PasswordService({ get: () => 4 } as never); // cost 4 = rápido em teste

  it('hashes with bcrypt and verifies without rehash', async () => {
    const hash = await service.hash('correct horse');
    expect(/^\$2[ab]\$04\$/.test(hash)).toBe(true);
    expect(await service.verify('correct horse', hash)).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('rejects passwords over 256 chars without hashing them (phpass is synchronous)', async () => {
    const hash = generateWordpressHash('a'.repeat(257));
    const started = Date.now();

    expect(await service.verify('a'.repeat(257), hash)).toEqual({
      valid: false,
      needsRehash: false,
    });
    expect(Date.now() - started).toBeLessThan(5);
  });

  it('burnVerification spends a real bcrypt comparison', async () => {
    const compare = jest.spyOn(bcrypt, 'compare');

    await service.burnVerification('anything');

    expect(compare).toHaveBeenCalledWith('anything', expect.any(String));
    compare.mockRestore();
  });

  it('rejects wrong password', async () => {
    const hash = await service.hash('right');
    expect(await service.verify('wrong', hash)).toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  it('accepts GoTrue $2a$10$ hash without rehash', async () => {
    const hash = bcrypt.hashSync('supa-pass', 10);
    expect(await service.verify('supa-pass', hash)).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('accepts $2y$ (php bcrypt) without rehash', async () => {
    const hash = bcrypt.hashSync('php-pass', 10).replace('$2a$', '$2y$');
    expect(await service.verify('php-pass', hash)).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('accepts phpass and flags rehash', async () => {
    expect(await service.verify('old', generateWordpressHash('old'))).toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('accepts md5 and flags rehash', async () => {
    const md5 = crypto.createHash('md5').update('old-pass').digest('hex');
    expect(await service.verify('old-pass', md5)).toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  it('trims plain before hash and verify', async () => {
    const hash = await service.hash('  spaced  ');
    expect(await service.verify('spaced', hash)).toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  it('invalid for empty/unknown', async () => {
    expect(await service.verify('x', null)).toEqual({
      valid: false,
      needsRehash: false,
    });
    expect(await service.verify('x', 'garbage')).toEqual({
      valid: false,
      needsRehash: false,
    });
    expect(await service.verify('', await service.hash('a'))).toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});
