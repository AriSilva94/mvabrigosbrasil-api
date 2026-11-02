# Deploy com GitHub Actions e Dokploy

## Ambientes

Há somente dois ambientes, em cada repositório:

| Branch | GitHub Environment | Tag GHCR | Destino |
| --- | --- | --- | --- |
| develop | development | dev | Homologação |
| main | production | latest | Produção |

Cada imagem também recebe sha-<SHA completo>. O workflow pode ser acionado por push, Pull Request ou workflow_dispatch. Execuções manuais em outras branches são recusadas. PRs executam verificações e build/scan local, sem publicar nem acessar webhooks.

## Etapas de segurança

1. npm ci com lockfile, lint, typecheck, testes e build.
2. Auditoria de dependências bloqueando vulnerabilidades altas e críticas.
3. Build em node:24-bookworm-slim, com atualização dos pacotes Debian e estágios separados. Runtime com usuário node e sem npm/npx.
4. Trivy bloqueia vulnerabilidades HIGH/CRITICAL com correção disponível, conforme a referência. PRs verificam também usuário, ausência de npm e health da imagem. A API verifica carregamento do Prisma Client e migrations.
5. Publicação no GHCR com GITHUB_TOKEN e packages:write apenas no job de publicação. As Actions externas estão fixadas por SHA completo.
6. Deploy depende de checks, publicação e scan. O job compara os digests da tag do ambiente e da tag SHA antes de acionar o webhook.
7. Smoke test exige status ok e revision igual ao SHA publicado. Execuções de promoção por branch são serializadas sem cancelamento.

O npm de build está fixado em 11.6.2 em Docker e CI. O lockfile da API foi regenerado em Linux para incluir as dependências opcionais exigidas por npm ci nesse ambiente. O npm é removido da imagem final.

No frontend, scripts/audit.mjs mantém a mesma exceção específica da referência: GHSA-vfj7-8cjw-p6xm (braces, ferramenta de lint, sem versão corrigida disponível). Nenhuma outra vulnerabilidade alta/crítica é aceita pelo script. A exceção não se aplica ao Trivy. A auditoria pode manter avisos moderados; não significa ausência de vulnerabilidades.

## Configuração no GitHub

Em ambos os repositórios, criar os Environments development (branch develop) e production (branch main), limitados à respectiva branch.

Em cada Environment:

- Secret DOKPLOY_WEBHOOK_URL: webhook exclusivo do serviço e ambiente.
- Variable HEALTHCHECK_URL: origem pública do serviço, sem caminho ou barra final. No frontend é consultado /health; no backend, /api/v1/health.

Em main, configurar aprovação obrigatória antes de liberar o job de deploy. Esse controle exige configuração no GitHub; o YAML sozinho não cria reviewers. Se o plano não permitir reviewers, manter a produção por disparo manual e revisar as permissões de execução antes de ativar seu webhook. Não habilitar deploy automático de produção sem o controle escolhido.

Proteger develop e main com PRs e checks obrigatórios, bloqueando push direto e bypass. Configurar o status checks e o job verify-image como obrigatórios. Regras de proteção também são configurações externas ao repositório.

Somente no frontend, criar repository variables (não secrets):

- INTERNAL_API_URL_DEVELOP e INTERNAL_API_URL_MAIN: origem da API acessível ao Next.js no ambiente correspondente.
- NEXT_PUBLIC_SITE_URL_DEVELOP e NEXT_PUBLIC_SITE_URL_MAIN: origem pública do site.

Essas URLs não devem conter credenciais. O build de publicação falha se a configuração da branch estiver ausente. O build não consulta a API: os dados de páginas públicas são carregados nas requisições. O cache explícito de 900 segundos do banco de dados permanece.

## Configuração no Dokploy

Criar um serviço Docker Registry para o frontend e outro para o backend em cada ambiente. Usar as imagens ghcr.io/arisilva94/mvabrigosbrasil e ghcr.io/arisilva94/mvabrigosbrasil-api, com dev ou latest conforme a tabela. Autorizar leitura das imagens privadas com credencial de menor escopo possível. Desativar gatilhos de deploy que contornem o workflow e seu scan.

Configurar no runtime do frontend:

- INTERNAL_API_URL, coerente com o valor usado no build da mesma imagem.
- AUTH_JWT_SECRET, igual ao backend do mesmo ambiente, para validar a sessão no servidor.
- NEXT_PUBLIC_SITE_URL, coerente com o domínio público.

Configurar no runtime da API:

- DATABASE_URL e REDIS_URL de serviços exclusivos daquele ambiente.
- AUTH_JWT_SECRET, APP_URL e COOKIE_SECURE=true com HTTPS.
- RESEND_API_KEY e MAIL_FROM quando o envio de e-mail estiver habilitado.

APP_REVISION é incorporado pelo build; não sobrescrever no Dokploy. Os endpoints de health retornam Cache-Control: no-store. A API mantém as verificações reais de PostgreSQL e Redis.

A imagem da API executa prisma migrate deploy antes de iniciar o NestJS e encerra se a migration falhar. Não executa seed. O target migrator continua disponível para operações explícitas; não é necessário configurá-lo como serviço permanente no Dokploy.

## Rede e dados

Manter a API na mesma origem do navegador: no Traefik, /api/v1 deve ir para o NestJS (porta 3001) e os demais caminhos para o Next.js (porta 3000). Essa organização preserva o alcance dos cookies de autenticação. O Nginx do compose local apenas simula esse roteamento e não precisa ser publicado no Dokploy.

PostgreSQL 16 e Redis 7 são mantidos nesta etapa. Não expor suas portas publicamente, usar credenciais próprias por ambiente e backup recuperável antes de migrations. Rollback de imagem não desfaz automaticamente migrations no banco. A carga do Supabase e a sincronização final continuam sendo procedimentos separados, descritos em IMPORT.md.

Não copiar os domínios, segredos, cookies entre subdomínios ou integrações comerciais da plataforma-hospedagem. Os controles adicionais de IP real via Cloudflare da referência exigem uma análise própria do caminho de rede e não foram ativados nesta etapa.

## Validação local

Usar compose.local.yml conforme DOCKER-LOCAL.md. Não publicar imagens nem acionar webhooks durante a validação local. Confirmar health, revisão, login e leitura dos dados. As configurações de GitHub e Dokploy precisam ser concluídas antes do primeiro deploy real.
