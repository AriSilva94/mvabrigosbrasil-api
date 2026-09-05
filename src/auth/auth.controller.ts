import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { loginSchema } from './dto/login.dto';
import { setAuthCookies } from './cookies/cookies';
import { Public } from './decorators/public';
import type { Env } from '../config/env.validation';

type LoginResponse = { ok: true; migrated: boolean; postType: string | null };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'E-mail e senha são obrigatórios',
      });
    }

    const { email, password } = parsed.data;
    const result = await this.authService.login(email, password);

    // Convenção mv_rt = `${sid}.${rt}` (controller ruling R2, task 7): o
    // valor do cookie de refresh carrega o sid junto do refresh token
    // opaco, separados por ".", para que o endpoint de refresh (task 9)
    // recupere o sid sem depender de decodificar um access token já
    // expirado.
    setAuthCookies(
      res,
      { at: result.at, rt: `${result.sid}.${result.rt}` },
      this.config,
    );

    return { ok: true, migrated: result.migrated, postType: result.role };
  }
}
