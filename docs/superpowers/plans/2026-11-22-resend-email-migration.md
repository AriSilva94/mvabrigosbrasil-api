# Migração de e-mail para Resend + verificação de e-mail — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o envio por SMTP (Hostinger) pelo Resend e adicionar os e-mails de verificação de cadastro e de aviso de senha alterada, com login bloqueado até confirmar o e-mail de contas novas.

**Architecture:** `MailService` passa a usar o SDK `resend` (cliente `null` sem `RESEND_API_KEY`, mantendo o log de dev). Tokens de verificação seguem o padrão do reset de senha: token opaco, só o sha256 no Redis. `emailVerified` (já existe em `users`) vira a trava do login. Webhook do Resend só registra falhas de entrega em log.

**Tech Stack:** NestJS 11, Prisma 7, Redis (ioredis), `resend` (SDK), zod, Jest; frontend Next.js (Tailwind, sem inline style).

**Spec:** decisões da conversa de 2026-11-22 (sem documento de spec separado):
- Remetente `MV Abrigos <no-reply@mail.mvabrigosbrasil.com.br>`; domínio `mail.mvabrigosbrasil.com.br` já verificado no Resend (`sa-east-1`, tracking desligado).
- Cadastro novo nasce `emailVerified=false`, sem sessão, e **não loga** até confirmar. Usuários existentes continuam verificados. `teamOnly` nasce verificado.
- Link de verificação válido por 24 h; `POST /auth/resend-verification` com limite de tentativas.
- Login de conta não verificada → 403 `{ error: 'E-mail não verificado.', code: 'EMAIL_NOT_VERIFIED' }`, só depois de a senha conferir.
- Itens do plano de e-mails: 1 (SDK), 2 (domínio, feito), 12 (webhook), 6 (aviso de senha alterada), 4 (boas-vindas = o próprio e-mail de verificação), 5 (verificação).

## Global Constraints

- Plano free: **100 e-mails/dia e 3.000/mês**, rate limit 10 req/s. A cota é da conta inteira (dev e produção juntos).
- `forgot-password` e `resend-verification` respondem sempre `{ ok: true }` e **nunca esperam o envio** (sem `await`), para não revelar quais e-mails existem pelo tempo de resposta.
- `MailService` nunca lança: falha de envio é logada, nunca derruba o fluxo. O SDK do Resend **não lança** em erro de API (devolve `{ data, error }`); o erro precisa ser checado.
- Nunca logar token em produção; em dev sem `RESEND_API_KEY`, logar o link (comportamento atual).
- Mensagens ao usuário em pt-BR; identificadores em inglês; sem comentários que repitam o código; sem inline style no frontend.
- E-mail novo reaproveita `renderEmailLayout` (logo e ícone como anexo inline por CID, como hoje).
- Prefixos Redis novos: `emailverify:{sha256}` (token → userId, TTL 24 h), `emailverify_user:{userId}` (hash vigente do usuário), `emailverify_cooldown:{userId}` (60 s).

## Review Focus

1. Login com senha **errada** de conta não verificada deve dar o 401 genérico, nunca o 403 (senão revela que o e-mail existe).
2. Duas requisições simultâneas com o mesmo link de verificação: só uma consome (`GETDEL`).
3. Reenvio em sequência: o link anterior deixa de valer; cooldown de 60 s impede estourar a cota de 100/dia.
4. Usuário que redefine a senha por e-mail prova posse do e-mail: conta não verificada passa a verificada.
5. `RESEND_API_KEY` ausente ou Resend retornando `error`: cadastro e reset continuam respondendo normalmente.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `src/mail/mail.module.ts` (mod.) | Provider `RESEND_CLIENT` (`Resend \| null`) |
| `src/mail/mail.service.ts` (mod.) | `send` privado + `sendPasswordReset`, `sendEmailVerification`, `sendPasswordChanged` |
| `src/mail/email-verification.template.ts` (novo) | HTML/texto do e-mail de verificação |
| `src/mail/password-changed.template.ts` (novo) | HTML/texto do aviso de senha alterada |
| `src/auth/email-verification.service.ts` (novo) | Emitir, consumir e reenviar token de verificação (Redis) |
| `src/auth/auth.service.ts` (mod.) | register/login/reset/change integrados |
| `src/auth/auth.controller.ts` (mod.) | `verify-email`, `resend-verification` |
| `src/auth/dto/verify-email.dto.ts`, `resend-verification.dto.ts` (novos) | Schemas zod |
| `src/webhooks/resend-webhook.controller.ts` + `webhooks.module.ts` (novos) | Recebe eventos do Resend |
| `src/config/env.validation.ts` (mod.) | Remove `SMTP_*`; adiciona `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` |
| `src/main.ts` (mod.) | `rawBody: true` |
| `prisma/migrations/<ts>_grandfather_email_verified/migration.sql` (novo) | Marca contas existentes como verificadas |

---

### Task 1: Trocar o transporte por Resend

**Files:**
- Modify: `package.json` (remover `nodemailer` e `@types/nodemailer`; instalar `resend`), `src/config/env.validation.ts`, `.env.example`, `src/mail/mail.module.ts`, `src/mail/mail.service.ts`
- Test: `src/mail/mail.service.spec.ts`

**Interfaces:**
- Produces: `export const RESEND_CLIENT = 'RESEND_CLIENT'`; `MailService` com construtor `(client: ResendLike | null, config: ConfigService<Env, true>)` onde `ResendLike = { emails: { send(payload: { from; to; subject; html; text; attachments? }): Promise<{ data: unknown; error: { message: string } | null }> } }`. `sendPasswordReset(email, link): Promise<void>` mantém a assinatura. Método privado `deliver(to: string, content: EmailContent, logContext: string): Promise<void>` usado pelos demais.

- [ ] **Step 1: Reescrever os testes de `mail.service.spec.ts`** trocando `MailTransport/sendMail` por `ResendLike/emails.send`. Casos: (a) envia com `from = MAIL_FROM`, `to`, `html` contendo `href="${link}"`, `text` com o link e 2 anexos com `contentId`; (b) cliente `null` em `NODE_ENV=test` loga o link; (c) cliente `null` em `production` só avisa e **não** contém o token; (d) `emails.send` rejeitando não lança; (e) **`emails.send` resolvendo `{ data: null, error: { message: 'x' } }` não lança e chama `Logger.error`**.
- [ ] **Step 2: Rodar** `npx jest src/mail` → falha (`RESEND_CLIENT` inexistente).
- [ ] **Step 3: Implementar.** `env.validation.ts`: remover `SMTP_*`, adicionar `RESEND_API_KEY: z.preprocess(v => v === '' ? undefined : v, z.string().optional())` e `RESEND_WEBHOOK_SECRET` igual. `MailModule`: factory devolve `new Resend(key)` ou `null`. `MailService.deliver`: mapear `attachments` para `{ filename, content, contentId: cid, contentType }` (campo do SDK para imagem inline), checar `error` do retorno, nunca lançar. Padrão do `MAIL_FROM` passa a `MV Abrigos <no-reply@mail.mvabrigosbrasil.com.br>`. Atualizar `.env.example` (remover `SMTP_*`, incluir `RESEND_API_KEY=` e `RESEND_WEBHOOK_SECRET=`).
- [ ] **Step 4: Rodar** `npx jest src/mail` → PASS; `npm run lint` e `npx tsc --noEmit -p tsconfig.json` sem erros.
- [ ] **Step 5: Commit** `feat(mail): envia e-mails pelo Resend em vez de SMTP`

---

### Task 2: Templates de verificação e de senha alterada

**Files:**
- Create: `src/mail/email-verification.template.ts`, `src/mail/password-changed.template.ts`
- Modify: `src/mail/mail.service.ts`
- Test: `src/mail/mail.service.spec.ts`

**Interfaces:**
- Consumes: `renderEmailLayout`, `EmailContent`, `KEY_BADGE_CID`, `logoAttachment`, `keyBadgeAttachment`.
- Produces: `emailVerificationEmail(link: string, validityHours: number, siteUrl: string): EmailContent`; `passwordChangedEmail(resetUrl: string, siteUrl: string): EmailContent`; `MailService.sendEmailVerification(email: string, link: string): Promise<void>` (validade fixa 24 h); `MailService.sendPasswordChanged(email: string): Promise<void>` (link do botão = `${siteUrl}/recuperar-senha`).

- [ ] **Step 1: Testes:** `emailVerificationEmail` contém assunto `Confirme seu e-mail - MV Abrigos Brasil`, `24 horas` no HTML e no texto, escapa link malicioso (mesmo caso do reset). `passwordChangedEmail` tem assunto `Sua senha foi alterada - MV Abrigos Brasil`, botão `Não fui eu` apontando para `/recuperar-senha`. `sendEmailVerification`/`sendPasswordChanged` chamam `emails.send` com o assunto correto.
- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar** os dois templates com `renderEmailLayout` (CTA verificação: `Confirmar meu e-mail`; nota: expira em 24 horas, uso único, ignorar se não pediu). Métodos novos chamam `deliver`.
- [ ] **Step 4: Rodar** `npx jest src/mail` → PASS.
- [ ] **Step 5: Commit** `feat(mail): e-mails de verificação e de senha alterada`

---

### Task 3: Serviço de verificação de e-mail + migration de contas existentes

**Files:**
- Create: `src/auth/email-verification.service.ts`, `prisma/migrations/<timestamp>_grandfather_email_verified/migration.sql`
- Modify: `src/auth/auth.module.ts` (provider)
- Test: `src/auth/email-verification.service.spec.ts`

**Interfaces:**
- Consumes: `RedisService.client`, `MailService.sendEmailVerification`, `PrismaService`, `ConfigService APP_URL`.
- Produces: `EmailVerificationService`:
  - `issue(userId: string, email: string): Promise<void>` — gera token (32 bytes base64url), grava `emailverify:{sha256}`→userId (24 h), grava `emailverify_user:{userId}`→hash e apaga o `emailverify:` do hash anterior; monta `${APP_URL}/confirmar-email?token=…`; chama `void mailService.sendEmailVerification` (sem await).
  - `confirm(token: string): Promise<boolean>` — `GETDEL emailverify:{sha256}`; se existir, `user.update({ emailVerified: true })`, apaga `emailverify_user:{userId}`, retorna `true`; senão `false`.
  - `resend(email: string): Promise<void>` — busca usuário; só emite se existe, `emailVerified=false` e `SET emailverify_cooldown:{userId} 1 NX EX 60` for aceito.

- [ ] **Step 1: Testes** (Redis fake como no `password-reset.integration.spec.ts`): `issue` grava o hash e **nunca o token puro**; `confirm` marca `emailVerified` e um segundo `confirm` com o mesmo token retorna `false`; `confirm` com token inventado retorna `false`; `issue` duas vezes invalida o link do primeiro; `resend` dentro de 60 s não emite de novo; `resend` de e-mail inexistente e de conta já verificada não envia nada e não lança.
- [ ] **Step 2: Rodar** `npx jest src/auth/email-verification` → falha.
- [ ] **Step 3: Implementar** o serviço e registrá-lo em `AuthModule`. Migration SQL: `UPDATE users SET email_verified = true WHERE email_verified = false;` (marca as contas anteriores a esta entrega como verificadas, conforme decisão de produto).
- [ ] **Step 4: Rodar** testes → PASS; `npx prisma migrate deploy` em banco local aplica sem erro.
- [ ] **Step 5: Commit** `feat(auth): emissão e confirmação de token de verificação de e-mail`

---

### Task 4: Fluxo de cadastro, login e endpoints

**Files:**
- Modify: `src/auth/auth.service.ts` (`register`, `login`, `resetPassword`, `changePassword`), `src/auth/auth.controller.ts`
- Create: `src/auth/dto/verify-email.dto.ts` (`{ token: string }`), `src/auth/dto/resend-verification.dto.ts` (`{ email: string }`)
- Test: `src/auth/auth.service.spec.ts`, `src/auth/auth.controller.spec.ts`, `test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `EmailVerificationService.issue/confirm/resend`, `MailService.sendPasswordChanged`.
- Produces: `RegisterResult` ganha `verificationRequired: boolean`; `register` retorna `{ userId, teamOnly: false, verificationRequired: true }` **sem** `at/rt/sid` para cadastro normal; `teamOnly` continua `emailVerified: true`. Controller: `POST /auth/verify-email` (público; 200 `{ ok: true }` ou 400 `{ error: 'Link inválido ou expirado' }`), `POST /auth/resend-verification` (público, `@Throttle` 3/10 min, sempre `{ ok: true }`). `register` do controller não chama `setAuthCookies` quando não há sessão e responde `{ ok: true, userId, verificationRequired }`.
- `login` lança `ForbiddenException({ error: 'E-mail não verificado.', code: 'EMAIL_NOT_VERIFIED' })` quando a senha confere e `emailVerified === false`, **antes** de criar a sessão.

- [ ] **Step 1: Testes.** Unit: (a) `register` normal grava `emailVerified: false`, chama `issue`, não cria sessão; (b) `register` `teamOnly` grava `true` e não chama `issue`; (c) `login` com senha certa e não verificado → 403 com `code`; (d) **`login` com senha errada de conta não verificada → 401 `INVALID_CREDENTIALS`**; (e) `resetPassword` bem-sucedido deixa `emailVerified=true` e chama `sendPasswordChanged`; (f) `changePassword` chama `sendPasswordChanged`; (g) envio de aviso que rejeita não derruba o reset. E2E: cadastrar → login 403 → `verify-email` com o token do Redis → login 200; token reutilizado → 400.
- [ ] **Step 2: Rodar** `npx jest src/auth` → falha.
- [ ] **Step 3: Implementar.** Em `login`, a checagem fica logo após `authenticatedUser` ser definido (usuário vindo do legado já tem `emailVerified: true` em `legacy-migration.service.ts:61`). Em `resetPassword`/`setNewPassword`/`resetLegacyPassword`, incluir `emailVerified: true` na atualização do usuário. `sendPasswordChanged` com `void`, buscando o e-mail do usuário pelo `userId` já conhecido.
- [ ] **Step 4: Rodar** `npx jest src/auth && npm run test:e2e -- auth` → PASS.
- [ ] **Step 5: Commit** `feat(auth): login bloqueado até confirmar o e-mail em cadastros novos`

---

### Task 5: Webhook do Resend

**Files:**
- Create: `src/webhooks/webhooks.module.ts`, `src/webhooks/resend-webhook.controller.ts`
- Modify: `src/app.module.ts` (importar módulo), `src/main.ts` (`NestFactory.create(AppModule, { rawBody: true })`)
- Test: `src/webhooks/resend-webhook.controller.spec.ts`

**Interfaces:**
- Consumes: `Resend` (`resend.webhooks.verify`), `RESEND_WEBHOOK_SECRET`.
- Produces: `POST /api/v1/webhooks/resend` — `@Public()`, `@SkipThrottle()`; usa `req.rawBody`. Sem `RESEND_WEBHOOK_SECRET` → 404. Assinatura inválida → 400. Eventos `email.bounced`, `email.complained`, `email.delivery_delayed` → `Logger.warn` com tipo e `email_id` (**sem** endereço do destinatário); demais eventos → 200 sem log. Resposta `{ ok: true }`.

- [ ] **Step 1: Testes:** assinatura inválida → 400; sem secret → 404; `email.bounced` válido → 200 e `warn` chamado sem conter o e-mail do destinatário; evento `email.delivered` → 200 sem `warn`.
- [ ] **Step 2: Rodar** → falha.
- [ ] **Step 3: Implementar** controller e módulo; manter a verificação pelo SDK em vez de HMAC manual.
- [ ] **Step 4: Rodar** `npx jest src/webhooks` e `npm run test:e2e` → PASS; confirmar que as rotas existentes seguem funcionando com `rawBody: true`.
- [ ] **Step 5: Commit** `feat(webhooks): recebe eventos de entrega do Resend`

---

### Task 6: Frontend (`mvabrigosbrasil`)

**Files:**
- Modify: `src/hooks/useRegister.ts`, `src/hooks/useRegisterForm.ts` (após cadastro normal: `router.push('/verificar-email?email=…')` em vez de resolver redirect pós-login), `src/components/auth/LoginForm.tsx` (tratar 403 `EMAIL_NOT_VERIFIED`: mensagem e botão "Reenviar e-mail de confirmação"), `src/proxy.ts` (rotas públicas), `src/lib/api/errors.ts` se `ApiError` ainda não expõe `code`
- Create: `src/app/(auth)/verificar-email/page.tsx` ("Confira sua caixa de entrada" + reenviar), `src/app/(auth)/confirmar-email/page.tsx` (lê `?token=`, chama `POST /auth/verify-email`, mostra sucesso com link para `/login` ou erro com link para reenviar)
- Test: `proxy.spec.ts` e specs dos componentes alterados

**Interfaces:**
- Consumes: `POST /auth/register` → `{ ok, userId, verificationRequired }`; `POST /auth/verify-email`; `POST /auth/resend-verification`; erro 403 com `code: 'EMAIL_NOT_VERIFIED'`.
- `TeamAccessForm` (cadastro `teamOnly`) não muda de comportamento.

- [ ] **Step 1: Testes:** `proxy.spec.ts` — `/verificar-email` e `/confirmar-email` acessíveis sem sessão; teste do hook/form de cadastro redirecionando para `/verificar-email`.
- [ ] **Step 2: Rodar** `npx vitest run` → falha.
- [ ] **Step 3: Implementar** as páginas com Tailwind e os componentes UI existentes (`Input`, `FormError`, `toast`); nada de `style={{}}`. Botão de reenvio desabilitado por 60 s após o clique, igual ao cooldown da API.
- [ ] **Step 4: Rodar** `npx vitest run`, `npm run lint`, `npx tsc --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(auth): telas de verificação de e-mail`

---

### Task 7: Documentação e checklist de deploy

**Files:**
- Modify: `docs/DEPLOY-DOKPLOY.md` (trocar linha de `SMTP_*` por `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `MAIL_FROM`), `docs/DOCKER-LOCAL.md` (trecho sobre `SMTP_HOST`), `README.md` se citar SMTP; frontend `docs/deployment/dokploy.md` (já cita Resend; conferir)

- [ ] **Step 1:** Atualizar os textos acima; remover menções a Hostinger/SMTP.
- [ ] **Step 2:** Rodar `grep -rniE "smtp|nodemailer|hostinger" src docs .env.example package.json` → sem resultados.
- [ ] **Step 3: Commit** `docs: Resend no lugar de SMTP`

**Checklist de deploy (fora do código):**
1. Deploy de **API e frontend juntos** (o cadastro novo deixa de devolver sessão; frontend antigo quebraria).
2. Dokploy: manter `RESEND_API_KEY` e `MAIL_FROM` (já ajustados em dev); apagar `SMTP_*` depois do deploy.
3. Criar o webhook no Resend (MCP `create-webhook`) apontando para `https://<api-dev>/api/v1/webhooks/resend` e copiar o signing secret para `RESEND_WEBHOOK_SECRET`.
4. Rodar uma vez: cadastro novo → e-mail de verificação → login; esqueci a senha; troca de senha. Conferir no Resend (`list-emails`) a entrega.
5. Antes do deploy em produção: `SELECT count(*) FROM users WHERE email_verified = false;` deve ser 0 depois da migration.

## Self-review

- Cobertura: itens 1, 2, 4, 5, 6, 12 mapeados (Tasks 1, 2–4, 5, 7; item 2 já concluído).
- Nomes consistentes: `EmailVerificationService.issue/confirm/resend`, `sendEmailVerification`, `sendPasswordChanged`, `RESEND_CLIENT`, código `EMAIL_NOT_VERIFIED`.
- Fora do escopo (declarado): reset em lote de contas sem senha (item 7) e notificações de candidatura (item 8).
