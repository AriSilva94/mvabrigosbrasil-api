import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import {
  generateWordpressHash,
  isMd5Hash,
  verifyWordpressPassword,
} from './wordpress-password';

// Reproduz wp_hash_password() do WP >= 6.8
function buildWpHash(password: string): string {
  const escaped = password
    .replace(/\\(.)/g, '$1')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const prepared = Buffer.from(
    crypto.createHmac('sha384', 'wp-sha384').update(escaped).digest(),
  ).toString('base64');
  return `$wp${bcrypt.hashSync(prepared, 10).replace('$2a$', '$2y$')}`;
}

describe('verifyWordpressPassword', () => {
  it.each(['a&b', 'a"b', 'a<b', 'a>b', 'a\\b', "a'b", 'ação🐾'])(
    'accepts the official WordPress HMAC input for %s',
    async (password) => {
      const prepared = crypto
        .createHmac('sha384', 'wp-sha384')
        .update(password)
        .digest('base64');
      const hash = `$wp${bcrypt.hashSync(prepared, 4).replace(/^\$2[ab]\$/, '$2y$')}`;
      expect(await verifyWordpressPassword(password, hash)).toBe(true);
      expect(await verifyWordpressPassword(`${password}wrong`, hash)).toBe(
        false,
      );
    },
  );

  it('md5 legacy', async () => {
    const hash = '5d41402abc4b2a76b9719d911017c592'; // md5("hello")
    expect(await verifyWordpressPassword('hello', hash)).toBe(true);
    expect(await verifyWordpressPassword('HELLO', hash)).toBe(false);
  });

  it('phpass $P$ round-trip', async () => {
    const hash = generateWordpressHash('s3cret');
    expect(/^\$[PH]\$/.test(hash)).toBe(true);
    expect(await verifyWordpressPassword('s3cret', hash)).toBe(true);
    expect(await verifyWordpressPassword('nope', hash)).toBe(false);
  });

  it('$wp bcrypt+hmac (WP 6.8)', async () => {
    const hash = buildWpHash('My$trongPass1');
    expect(await verifyWordpressPassword('My$trongPass1', hash)).toBe(true);
    expect(await verifyWordpressPassword('other', hash)).toBe(false);
  });

  it('$wp with html-special chars and backslash', async () => {
    const pwd = 'a&b"c<d>e\\f';
    expect(await verifyWordpressPassword(pwd, buildWpHash(pwd))).toBe(true);
  });

  it('trims password and hash', async () => {
    const hash = generateWordpressHash('abc');
    expect(await verifyWordpressPassword('  abc  ', `  ${hash}  `)).toBe(true);
  });

  it('rejects empty/unknown', async () => {
    expect(await verifyWordpressPassword('x', null)).toBe(false);
    expect(await verifyWordpressPassword('x', '')).toBe(false);
    expect(await verifyWordpressPassword('', 'anything')).toBe(false);
    expect(await verifyWordpressPassword('x', 'not-a-known-format')).toBe(
      false,
    );
  });
});

describe('isMd5Hash', () => {
  it('32 hex only', () => {
    expect(isMd5Hash('5d41402abc4b2a76b9719d911017c592')).toBe(true);
    expect(isMd5Hash('5D41402ABC4B2A76B9719D911017C592')).toBe(true);
    expect(isMd5Hash('short')).toBe(false);
  });
});
