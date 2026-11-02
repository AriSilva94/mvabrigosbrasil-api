# Ensaio local da migração em Docker

O arquivo `compose.local.yml` executa imagens de produção do NextJS e NestJS, PostgreSQL 16, Redis 7 e um gateway Nginx. O gateway simula o roteamento por caminho do Traefik/Dokploy: `/api/v1/*` vai para o NestJS, e os demais caminhos vão para o NextJS.

O nome do projeto Compose é `mvabrigos-local`. Seus volumes são separados dos volumes antigos e dos demais projetos. As portas publicadas ficam restritas a `127.0.0.1`.

| Serviço | Acesso local |
| --- | --- |
| Site e API no mesmo domínio | http://localhost:3000 |
| Saúde da API pelo gateway | http://localhost:3000/api/v1/health |
| API direta para diagnóstico/build | http://localhost:3001/api/v1/health |
| PostgreSQL | localhost:5433 |
| Redis | localhost:6380 |
| Mirror durante a carga | localhost:5434 |

## Ambiente

Executar os comandos a partir de `mvabrigosbrasil-api`. Copiar `.env.docker.local.example` para `.env.docker.local`, informar o diretório que contém `schema.sql` e `data.sql` e gerar um segredo JWT com pelo menos 32 caracteres. O mesmo segredo é injetado nos dois serviços; ele não é passado como build arg nem copiado para as imagens. O arquivo `.env.docker.local` é ignorado pelo Git.

O ambiente local desativa analytics e o envio de e-mails reais. A API não recebe `SMTP_HOST` neste Compose, e por isso só registra o link de recuperação no log. Recuperação com entrega real de e-mail exige a configuração específica do ambiente antes do deploy.

## Primeira carga

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml --profile migration up -d postgres redis mirror
docker compose --env-file .env.docker.local -f compose.local.yml --profile migration build api migrator tools
docker compose --env-file .env.docker.local -f compose.local.yml run --rm --no-deps migrator
```

Restaurar o backup no mirror vazio, usando os arquivos montados como somente leitura em `/backup`. O bootstrap está montado em `/bootstrap.sql`. O restore do Supabase pode registrar erros para extensões, roles, Storage e tabelas de Auth fora do escopo do NestJS. Conferir os erros e comparar as contagens das tabelas necessárias diretamente com o dump antes da carga. Não considerar sucesso apenas pelo exit code do `psql` com `ON_ERROR_STOP=0`.

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml --profile migration exec -T mirror sh -c 'psql -U mirror -d supabase_mirror -v ON_ERROR_STOP=1 -f /bootstrap.sql > /tmp/restore-bootstrap.log 2>&1 && psql -U mirror -d supabase_mirror -v ON_ERROR_STOP=0 -f /backup/schema.sql > /tmp/restore-schema.log 2>&1 && psql -U mirror -d supabase_mirror -v ON_ERROR_STOP=0 -f /backup/data.sql > /tmp/restore-data.log 2>&1'
```

Os logs ficam dentro do container e podem conter dados do dump em mensagens de erro. Não versioná-los nem publicá-los. Aguardar o healthcheck do mirror antes de executar o restore.

O mirror usa volume nomeado para sobreviver a recriações do container entre as etapas. Para usar outro snapshot, preparar um mirror vazio; não sobrepor restores.

Com o mirror validado e a API parada:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml --profile migration run --rm --no-deps tools npm run import:sync -- --dry-run
docker compose --env-file .env.docker.local -f compose.local.yml --profile migration run --rm --no-deps tools npm run import:sync -- --apply --maintenance
docker compose --env-file .env.docker.local -f compose.local.yml --profile migration run --rm --no-deps tools npm run import:sync -- --dry-run
```

A última prévia deve exibir zero inclusões, alterações e exclusões em todas as 15 tabelas. O procedimento detalhado de snapshot autoritativo e rollback está em [IMPORT.md](IMPORT.md).

## Subir o site

O front pré-renderiza dados públicos durante o build, portanto a API deve estar saudável antes de construir sua imagem:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml up -d api
docker compose --env-file .env.docker.local -f compose.local.yml build web
docker compose --env-file .env.docker.local -f compose.local.yml up -d web gateway
docker compose --env-file .env.docker.local -f compose.local.yml ps
```

`INTERNAL_API_BUILD_URL` aponta para `host.docker.internal:3001` somente no estágio de build. Essa URL precisa estar acessível pelo builder. O runtime utiliza `http://api:3001` na rede Docker; as requisições do navegador usam o mesmo domínio local. O argumento de build não é um endpoint público do navegador.

Se recriar o container `web` sem recriar o gateway, recarregar o Nginx para resolver o novo IP:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml exec gateway nginx -s reload
```

O chat usa WebSocket (Socket.IO) em `/api/v1/socket.io`, na mesma origem do site. O gateway encaminha o upgrade (`Upgrade`/`Connection`) e repete os cabeçalhos `X-Forwarded-*` dentro do `location /api/v1/`, porque um `proxy_set_header` no `location` deixa de herdar os do `server` e a API passaria a tratar o navegador como chamada interna, sem rate limit. Em `npm run dev` o mesmo caminho passa pelos rewrites do Next. Nos dois casos o `AUTH_JWT_SECRET` do front precisa ser igual ao da API em uso; com valores diferentes o login entra em loop de redirect (`.env.local` do front casa com o `.env` da API, não com o `.env.docker.local`).

Para iniciar novamente sem rebuild ou nova carga:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml up -d
```

Para parar preservando os dados:

```powershell
docker compose --env-file .env.docker.local -f compose.local.yml --profile migration stop
```

Não usar `down -v` se quiser manter o banco carregado. O mirror pode permanecer parado depois da validação; ele não é dependência do runtime.

## Diferenças para Dokploy

- Localmente: HTTP, `COOKIE_SECURE=false` e credenciais de banco/Redis destinadas apenas ao ensaio local.
- No Dokploy: HTTPS e `COOKIE_SECURE=true`, segredos próprios por ambiente, PostgreSQL/Redis sem portas públicas, backups e domínio real.
- O Nginx local representa o roteamento do Traefik; o ambiente local não executa o próprio Dokploy.
- O build do frontend não consulta a API; as páginas que precisam de dados aguardam a requisição do usuário. INTERNAL_API_URL continua obrigatório no runtime e no build para o roteamento.
- A API executa migrations no entrypoint antes de iniciar. O target migrator permanece disponível para operações explícitas. As ferramentas de importação continuam em uma imagem separada.
- Frontend, API e ferramentas utilizam Node 24 em Debian bookworm-slim. Consulte DEPLOY-DOKPLOY.md para os controles de CI/CD.

O backup utilizado no ensaio de 18/10/2026 é o snapshot local de **04/09/2026**. Para a migração definitiva, extrair um snapshot atualizado durante a janela de manutenção.
