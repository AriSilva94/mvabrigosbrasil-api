import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import type { Env } from '../../config/env.validation';
import { verifyWordpressPassword } from '../legacy/wordpress-password';

export type PasswordVerifyResult = { valid: boolean; needsRehash: boolean };

const PLAIN_BCRYPT = /^\$2[aby]\$\d{2}\$/;
// O phpass do WordPress é síncrono e custa ~9 ms por KB de senha: sem teto,
// uma senha de 100 KB travava o event loop por quase 1 s por tentativa.
export const MAX_VERIFIABLE_LENGTH = 256;

@Injectable()
export class PasswordService {
  private readonly cost: number;
  private dummyHash?: Promise<string>;

  constructor(config: ConfigService<Env, true>) {
    this.cost = config.get('BCRYPT_COST', { infer: true });
  }

  normalize(plain: string): string {
    return plain.trim();
  }

  async hash(plain: string): Promise<string> {
    return bcrypt.hash(this.normalize(plain), this.cost);
  }

  // Login sem nenhum hash para conferir respondia ~10x mais rápido, o que
  // revelava pelo tempo se o e-mail tem conta.
  async burnVerification(plain: string): Promise<void> {
    this.dummyHash ??= bcrypt.hash('dummy-password', this.cost);
    await bcrypt.compare(plain, await this.dummyHash);
  }

  async verify(
    plain: string,
    storedHash: string | null | undefined,
  ): Promise<PasswordVerifyResult> {
    const pwd = this.normalize(plain ?? '');
    const hash = (storedHash ?? '').trim();
    if (!pwd || !hash || pwd.length > MAX_VERIFIABLE_LENGTH) {
      return { valid: false, needsRehash: false };
    }

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
