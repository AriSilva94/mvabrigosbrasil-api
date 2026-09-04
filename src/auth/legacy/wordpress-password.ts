import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import wordpressHash from 'wordpress-hash-node';

export function generateWordpressHash(password: string): string {
  try {
    return wordpressHash.HashPassword(password) ?? '';
  } catch (error) {
    console.error('Erro ao gerar hash WordPress', error);
    return '';
  }
}

export function isMd5Hash(hash: string): boolean {
  const trimmed = hash.trim();
  return trimmed.length === 32 && /^[a-f0-9]+$/i.test(trimmed);
}

function prepareWordpressPassword(pwd: string): string {
  const withoutSlashes = pwd.replace(/\\(.)/g, '$1');
  const escaped = withoutSlashes
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const hmac = crypto
    .createHmac('sha384', 'wp-sha384')
    .update(escaped)
    .digest();
  return Buffer.from(hmac).toString('base64');
}

export async function verifyWordpressPassword(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash || !password) return false;

  const trimmedHash = hash.trim();
  const trimmedPassword = password.trim();

  try {
    if (trimmedHash.startsWith('$wp')) {
      const normalizedHash = trimmedHash.replace(/^\$wp/, '');
      const compatHash = normalizedHash.startsWith('$2y$')
        ? normalizedHash.replace('$2y$', '$2a$')
        : normalizedHash;
      return bcrypt.compare(
        prepareWordpressPassword(trimmedPassword),
        compatHash,
      );
    }

    if (trimmedHash.startsWith('$P') || trimmedHash.startsWith('$H')) {
      return Boolean(wordpressHash.CheckPassword(trimmedPassword, trimmedHash));
    }

    if (isMd5Hash(trimmedHash)) {
      const md5Hash = crypto
        .createHash('md5')
        .update(trimmedPassword)
        .digest('hex');
      return md5Hash === trimmedHash.toLowerCase();
    }

    return false;
  } catch (error) {
    console.error('Erro ao validar senha do WordPress', error);
    return false;
  }
}
