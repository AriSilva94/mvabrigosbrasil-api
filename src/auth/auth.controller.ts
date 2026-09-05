import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { MeResult, PostLoginRedirectResult } from './auth.service';
import { loginSchema } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import { setAuthCookies } from './cookies/cookies';
import { Public } from './decorators/public';
import { TokenService, Claims } from './jwt/token.service';
import type { Env } from '../config/env.validation';

type LoginResponse = { ok: true; migrated: boolean; postType: string | null };
type RegisterResponse = { ok: true; userId: string };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly tokenService: TokenService,
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

  @Public()
  @Post('register')
  @HttpCode(201)
  async register(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegisterResponse> {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'E-mail e senha são obrigatórios.',
      });
    }

    const actor = await this.currentClaims(req);
    const result = await this.authService.register(parsed.data, actor);

    // Só emite sessão (cookies) para o registro normal (`!teamOnly`). Quando
    // `teamOnly === true`, o criador (actor) permanece logado como ele
    // mesmo — nenhuma sessão nova é aberta para o usuário de equipe.
    if (!result.teamOnly) {
      setAuthCookies(
        res,
        { at: result.at as string, rt: `${result.sid}.${result.rt}` },
        this.config,
      );
    }

    return { ok: true, userId: result.userId };
  }

  // NÃO marcado `@Public()`: exige sessão. `JwtAuthGuard` ainda não está
  // registrado globalmente (Task 11), então a leitura do cookie `mv_at` é
  // feita diretamente aqui via `TokenService.verify` — quando o guard global
  // existir, `@CurrentUser()` populará `req.user` da mesma forma e este
  // método pode passar a usá-lo no lugar de `currentClaims`.
  @Get('me')
  async me(@Req() req: Request): Promise<MeResult> {
    const claims = await this.currentClaims(req);
    return this.authService.me(claims);
  }

  @Get('post-login-redirect')
  async postLoginRedirect(
    @Req() req: Request,
  ): Promise<PostLoginRedirectResult> {
    const claims = await this.currentClaims(req);
    return this.authService.postLoginRedirect(claims);
  }

  private async currentClaims(req: Request): Promise<Claims | null> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.mv_at;
    if (!token) {
      return null;
    }
    return this.tokenService.verify(token);
  }
}
