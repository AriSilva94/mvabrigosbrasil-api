import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import type { MeResult, PostLoginRedirectResult } from './auth.service';
import { loginSchema } from './dto/login.dto';
import { registerSchema } from './dto/register.dto';
import { forgotPasswordSchema } from './dto/forgot.dto';
import { resetPasswordSchema } from './dto/reset.dto';
import { changePasswordSchema } from './dto/change.dto';
import { setAuthCookies, clearAuthCookies } from './cookies/cookies';
import { Public } from './decorators/public';
import { TokenService, Claims } from './jwt/token.service';
import type { Env } from '../config/env.validation';

type LoginResponse = { ok: true; migrated: boolean; postType: string | null };
type RegisterResponse = { ok: true; userId: string };
type OkResponse = { ok: true };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly tokenService: TokenService,
  ) {}

  // Task 11: 10 tentativas/min por IP. `@nestjs/throttler` v6 rastreia por
  // IP por padrão; um limite adicional por e-mail (5/min) exigiria uma
  // chave/getTracker customizados por corpo da requisição, o que não é
  // trivial com os "named throttlers" da v6 — feito só por IP, com o
  // desvio registrado no relatório da Task 11.
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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

  // Task 11: 5 tentativas/10min por IP.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post('register')
  @HttpCode(200)
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

  // NÃO marcado `@Public()`: exige sessão — `JwtAuthGuard` (global desde a
  // Task 11) já barra a requisição com 401 antes de chegar aqui se o
  // `mv_at` faltar/for inválido, e também popula `req.user` via
  // `@CurrentUser()`. `currentClaims` é mantido por não quebrar o
  // comportamento existente (mesmo resultado, lido diretamente do cookie).
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

  // Doc 03 §7, §10 / doc 05 §3.1. `mv_rt` = `${sid}.${rt}` (convenção da
  // task 7, ver `login`/`register` acima) — o sid é lido daqui, e não do
  // `mv_at` (que pode já estar expirado quando o refresh é necessário).
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OkResponse> {
    const parsed = this.parseRefreshCookie(req);
    if (!parsed) {
      clearAuthCookies(res, this.config);
      throw new UnauthorizedException({ error: 'Sessão expirada' });
    }

    try {
      const result = await this.authService.refresh(parsed.sid, parsed.rt);
      setAuthCookies(
        res,
        { at: result.at, rt: `${result.sid}.${result.rt}` },
        this.config,
      );
      return { ok: true };
    } catch (err) {
      // Cobre tanto o reuso/roubo fora da janela curta de concorrência
      // (SessionService.rotate já destruiu a sessão) quanto qualquer outra
      // falha ao renovar: o cliente não deve manter cookies de sessão morta.
      clearAuthCookies(res, this.config);
      throw err;
    }
  }

  // Doc 03 §7: logout apenas limpa a sessão, sem pré-condição de auth.
  // `@Public()` é essencial aqui — logout é exatamente a ação que um
  // usuário toma quando o `mv_at` já expirou, então o `JwtAuthGuard` (Task
  // 11, global) não pode barrar a requisição antes do handler rodar.
  // Idempotente: com ou sem cookie `mv_rt`, com ou sem sessão ainda válida,
  // sempre limpa os cookies e responde 200 (Task 9).
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OkResponse> {
    const parsed = this.parseRefreshCookie(req);
    await this.authService.logout(parsed?.sid ?? null);
    clearAuthCookies(res, this.config);
    return { ok: true };
  }

  // Doc 03 §10 / doc 05 §3.1. Sempre 200 `{ok:true}` — nunca revela se o
  // e-mail existe (nem por status, nem por corpo, nem por timing observável
  // no shape da resposta). Um body malformado (sem `email` string) é tratado
  // como e-mail vazio, que também resolve `{ok:true}` sem efeitos colaterais.
  // Task 11: 3 tentativas/10min por IP.
  @Public()
  @Throttle({ default: { limit: 3, ttl: 600_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() body: unknown): Promise<OkResponse> {
    const parsed = forgotPasswordSchema.safeParse(body);
    const email = parsed.success ? parsed.data.email : '';
    return this.authService.forgotPassword(email);
  }

  // Doc 03 §10 / doc 05 §3.1.
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: unknown): Promise<OkResponse> {
    const parsed = resetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Link inválido ou expirado' });
    }
    return this.authService.resetPassword(
      parsed.data.token,
      parsed.data.password,
    );
  }

  // Doc 03 §10 / doc 05 §3.1. NÃO marcado `@Public()` — exige sessão
  // (`JwtAuthGuard` global, ver comentário em `me` acima), lida do cookie
  // `mv_at` da mesma forma que `me`/`postLoginRedirect`.
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<OkResponse> {
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: 'Senha atual e nova senha são obrigatórias.',
      });
    }
    const claims = await this.currentClaims(req);
    return this.authService.changePassword(
      claims,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
  }

  private async currentClaims(req: Request): Promise<Claims | null> {
    const cookies = req.cookies as Record<string, string> | undefined;
    const token = cookies?.mv_at;
    if (!token) {
      return null;
    }
    return this.tokenService.verify(token);
  }

  // Divide o valor do cookie `mv_rt` (`${sid}.${rt}`) no PRIMEIRO "." — o rt
  // opaco (base64url) não contém ".", mas usamos indexOf em vez de split
  // para não quebrar caso algum dia contenha. Retorna null se o cookie
  // estiver ausente ou não tiver o formato esperado (sid e rt não-vazios).
  private parseRefreshCookie(req: Request): { sid: string; rt: string } | null {
    const cookies = req.cookies as Record<string, string> | undefined;
    const raw = cookies?.mv_rt;
    if (!raw) {
      return null;
    }

    const dotIndex = raw.indexOf('.');
    if (dotIndex <= 0 || dotIndex === raw.length - 1) {
      return null;
    }

    const sid = raw.slice(0, dotIndex);
    const rt = raw.slice(dotIndex + 1);
    return { sid, rt };
  }
}
