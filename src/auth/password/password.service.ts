import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import type { Env } from '../../config/env.validation';
import { verifyWordpressPassword } from '../legacy/wordpress-password';

export type PasswordVerifyResult = { valid: boolean; needsRehash: boolean };

const PLAIN_BCRYPT = /^\$2[aby]\$\d{2}\$/;

@Injectable()
export class PasswordService {
  private readonly cost: number;

  constructor(config: ConfigService<Env, true>) {
    this.cost = config.get('BCRYPT_COST', { infer: true });
  }

  normalize(plain: string): string {
    return plain.trim();
  }

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(this.normalize(plain), this.cost);
  }

  async verify(
    plain: string,
    storedHash: string | null | undefined,
  ): Promise<PasswordVerifyResult> {
    const pwd = this.normalize(plain ?? '');
    const hash = (storedHash ?? '').trim();
    if (!pwd || !hash) return { valid: false, needsRehash: false };

    if (PLAIN_BCRYPT.test(hash)) {
      const compat = hash.startsWith('$2y$')
        ? hash.replace('$2y$', '$2a$')
        : hash;
      const valid = await bcrypt.compare(pwd, compat).catch(() => false);
      return { valid, needsRehash: false };
    }

    const valid = await verifyWordpressPassword(pwd, hash).catch(() => false);
    return { valid, needsRehash: valid };
  }
}
