# Padronização Docker e CI/CD

Objetivo: adotar no MV Abrigos os controles de build e promoção usados na plataforma-hospedagem, sem alterar autenticação, dados ou publicar remotamente.

- [x] Padronizar os Dockerfiles em node:24-bookworm-slim, usuário node, atualização de pacotes, remoção do npm do runtime e healthchecks.
- [x] Manter os targets tools e migrator existentes; permitir inicialização da API no Dokploy com migrations antes do servidor, sem seed.
- [x] Incluir APP_REVISION e Cache-Control: no-store no health da API e criar /health no Next.js. Testar revisão e dependências indisponíveis.
- [x] Excluir consultas à API da pré-renderização do build usando connection(), preservando o cache explícito dos dados.
- [x] Preparar workflows separados por repositório: checks, auditoria, build, teste do container, Trivy, GHCR, webhook e confirmação da revisão. Actions fixadas em SHA, permissões mínimas, PR sem publicação, promoção serializada e bloqueio de branches não autorizadas.
- [x] Documentar variáveis e secrets por ambiente, aprovação de produção, roteamento no Traefik, backup de banco e limitações externas.
- [x] Executar lint, typecheck, testes, actionlint, builds, auditorias e Trivy. Recriar somente os serviços locais necessários e confirmar autenticação e dados existentes.

O usuário definiu somente dois ambientes: develop para homologação e main para produção, com GitHub Environments de mesmo nome. Segredos e domínios não serão inventados. PostgreSQL 16 e Redis 7 serão preservados por compatibilidade com o banco já carregado; a referência usa versões diferentes, sem exigir upgrade desses serviços nesta tarefa.
