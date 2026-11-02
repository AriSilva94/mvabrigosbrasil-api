# Validação Docker e CI/CD — 18/10/2026

Referência: plataforma-hospedagem, somente leitura. Alterações aplicadas apenas ao MV Abrigos.

## Resultado

- Frontend e API em node:24-bookworm-slim; runtime Node v24.22.0, UID 1000, npm/npx ausentes.
- Builds das imagens web, API, tools e migrator concluídos.
- Frontend: lint sem erros (3 avisos preexistentes), typecheck aprovado, 194 testes aprovados.
- API: lint e typecheck aprovados; 447 testes unitários, 55 de importação e 64 E2E aprovados.
- actionlint 1.7.7: ambos os workflows sem erros.
- Trivy 0.75.0: zero achados HIGH/CRITICAL com correção disponível nas duas imagens finais. Relatórios completos locais em .tmp/security-validation/*-trivy.json.
- npm audit da API passou com audit-level=high; permanecem avisos moderados em ferramentas de teste. Auditoria do front sem bloqueadores, com a mesma exceção única de braces da referência, documentada em DEPLOY-DOKPLOY.md.
- Health do Next e API: HTTP 200, status ok, revision local e Cache-Control no-store. PostgreSQL e Redis up.
- Navegador: página inicial, login, banco de dados, programa de voluntários e privacidade HTTP 200, zero pageErrors. OpenGraph HTTP 200 com image/png.
- Verificação diretamente no runtime da API: bcrypt, WordPress oficial com caracteres especiais, phpass e MD5 aprovados, inclusive rejeição de senha incorreta.
- Dados preservados: 446 usuários, 337 abrigos, 277 voluntários. Nenhum usuário de teste criado nesta etapa.
- Revisão independente somente leitura: nenhum bloqueador estático encontrado.

## Limites

Não foram publicados pacotes no GHCR nem acionados webhooks. A execução real no GitHub e no Dokploy depende de configurar os dois Environments, variáveis, secrets, proteção de branches, aprovação de main e serviços Docker Registry. O Nginx permanece apenas no ensaio local. Credenciais e banco da referência não foram utilizados.

As imagens locais usam revision=local; o workflow fornece o SHA real no build e confere o digest antes do webhook e a revisão após o deploy. Essa promoção remota não foi executada no ensaio.
