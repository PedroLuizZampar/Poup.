# Poup.

App web de finanças pessoais, instalável como PWA. Importa as movimentações do
banco via Open Finance (Pluggy), categoriza as despesas — com palpite do próprio
histórico — e mostra para onde o dinheiro foi.

## Stack

- **Web** — React + TypeScript + Vite + Tailwind, instalável como PWA
- **API** — Node.js + Express + TypeScript + Prisma
- **Banco** — PostgreSQL (Neon)
- **Open Finance** — Pluggy, com as credenciais por usuário cifradas no banco
- **Auth** — email e senha, JWT de sessão, senha com bcrypt

Monorepo com npm workspaces: `apps/api`, `apps/web` e `packages/shared` (os
tipos que as duas pontas dividem).

## Rodando localmente

```bash
npm install
```

Copie `apps/api/.env.example` para `apps/api/.env` e preencha `DATABASE_URL`,
`JWT_SECRET` e `APP_ENCRYPTION_KEY` (esta última é uma chave de 32 bytes em
base64 — `openssl rand -base64 32`). As credenciais da Pluggy não vão no `.env`:
cada usuário informa as suas no cadastro, e elas ficam cifradas no banco.

Aplique as migrações e gere o client do Prisma:

```bash
npm run prisma:migrate --workspace=apps/api
```

E suba as duas pontas de uma vez — API em `:4000`, web em `:5173`:

```bash
npm run dev
```

## Outros comandos

```bash
npm run build
```

```bash
npm test --workspace=apps/api
```

Em produção a origem é única: o Express serve o build do `apps/web` e monta a
API em `/api`. HTTPS é requisito do service worker, não preferência.

## Deploy na Vercel

O repositório já traz o `vercel.json` e a função em `api/[...path].ts`, que é o
Express inteiro rodando como serverless. O build do web vai para a CDN e a API
atende em `/api` no **mesmo domínio** — origem única é requisito do service
worker, não conveniência.

### Configuração do projeto

Duas opções do painel precisam estar certas, e a primeira é a que mais custa
descobrir errada:

- **Root Directory: a raiz do repositório** (vazio), e não `apps/api`. A Vercel
  detecta o Express e sugere `apps/api`, mas ali o `npm install` roda dentro do
  workspace, onde `@poup/shared` é uma dependência que só existe pelo workspace
  da raiz — o npm vai procurá-la no registro público, não acha, e o build morre
  no install. Da raiz também é o único lugar de onde a Vercel enxerga este
  `vercel.json` e a pasta `api/`.
- **Framework Preset: Other.** O preset "Express" pressupõe outra disposição de
  arquivos; aqui quem manda é o `vercel.json`.

O resto (build, diretório de saída, região, rotas, cache) o `vercel.json`
resolve.

### Variáveis de ambiente

Em Settings → Environment Variables. Todas precisam valer também em **Build**,
porque o `prisma migrate deploy` roda durante o build:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | O endpoint **pooler** do Neon, com `&pgbouncer=true&connection_limit=1` |
| `JWT_SECRET` | O mesmo do seu `.env`, ou um novo (trocar desloga todo mundo) |
| `APP_ENCRYPTION_KEY` | **O mesmo do seu `.env`** — é ela que decifra as credenciais da Pluggy já gravadas no banco |

`PLUGGY_BASE_URL`, `JWT_EXPIRES_IN` e `PORT` têm padrão e podem ficar de fora.

### Por que o `vercel.json` está do jeito que está

- **`regions: ["gru1"]`** — o Neon está em `sa-east-1`, e o padrão da Vercel é
  Washington. Sem isto cada ida ao banco atravessa o continente: a latência medida
  daqui é de ~50ms, e de fora do país passa de 120ms. Num pedido que faz dezenas
  de consultas, é a diferença entre rápido e sofrível. (O *build* continua
  rodando em `iad1` — isto vale para a função, que é o que atende requisição.)
- **`maxDuration: 60`** — o teto do plano Hobby. O primeiro sync de uma conexão
  traz só o mês corrente justamente para caber com folga.
- **`rewrites: /api/(.*) -> /api`** — a API é uma função só, em `api/index.ts`,
  e é este rewrite que leva `/api/*` inteiro até ela. O arquivo já se chamou
  `[...path].ts`, contando com o catch-all da Vercel, e ali a plataforma tratava
  a rota como **um segmento só**: `/api/health` chegava no Express e
  `/api/auth/login` voltava `NOT_FOUND` sem nunca tocar nele — o login em
  produção morria em 404. Com o rewrite explícito o roteamento não depende de
  como o nome do arquivo é interpretado.
- **A URL original sobrevive ao rewrite.** O Express recebe `/api/auth/login`, e
  não o destino `/api` — por isso o prefixo `/api` continua valendo dentro da
  aplicação. Verificado em produção: `/health`, reescrito para `/api`, é
  atendido pelo `app.get("/health")` e não pela rota gêmea de dentro do
  `apiRouter`, que teria devolvido os headers de CORS.
- **`installCommand: npm install --no-package-lock`** — o `package-lock.json`
  é gerado no Windows, e o npm só registra nele os binários da plataforma em que
  rodou: o lock tem `@rollup/rollup-win32-x64-msvc` e nenhum `linux`. No Linux o
  npm então pula o binário que falta em vez de resolvê-lo
  ([npm/cli#4828](https://github.com/npm/cli/issues/4828)), e o `vite build`
  morre com "Cannot find module @rollup/rollup-linux-x64-gnu". Declarar os
  pacotes de Linux à mão não resolve: há duas versões de esbuild na árvore (uma
  aninhada dentro do vite, que é a que o build usa) e só se pode declarar uma.
  Ignorar o lock faz a Vercel resolver na própria plataforma. O preço é que o
  build de lá não é reprodutível ao pacote — resolve dentro das faixas do
  `package.json`. Localmente o lock continua valendo normalmente.
- **`buildCommand: npm run build:vercel`** — roda `prisma generate` e
  `prisma migrate deploy` antes do build do web. O `generate` não é opcional: a
  Vercel cacheia o `node_modules` entre builds e o client do Prisma ficaria velho.
- **O nome do script não pode ser `vercel-build`.** `vercel-build` é nome mágico:
  além do `buildCommand`, o builder da função (`api/**/*.ts`) também o executa,
  depois de um `npm install` próprio — e esse install reresolve a árvore e derruba
  de novo o binário Linux do rollup, matando o `vite build` na segunda passada,
  mesmo com o `--no-package-lock` acima. Daí a divisão: `build:vercel` é o
  pipeline completo, chamado uma única vez pelo `buildCommand`; `vercel-build`
  ficou só com o `prisma generate`, que é o que a função precisa refazer caso o
  install do builder tenha reinstalado o `@prisma/client` por cima do gerado.

O `binaryTargets` no `schema.prisma` inclui `rhel-openssl-3.0.x`, que é o runtime
das funções — sem ele o client sobe sem conseguir falar com o banco.

### O que muda em relação a um servidor de processo

- **Cold start.** Prisma e Express sobem na primeira requisição depois de ocioso:
  algo entre 1 e 3 segundos. Num host que mantém o processo vivo, não existe.
- **Nada de trabalho em segundo plano.** Não há timer nem cron no código hoje, e
  não pode passar a haver: a função só vive durante a requisição.
- **O sync é manual e tem teto.** Ver o item 10 do [PLAN.md](docs/PLAN.md).

## Documentação

O plano do projeto, as revisões e as notas de design estão em
[`docs/`](docs/README.md). O [`docs/PLAN.md`](docs/PLAN.md) descreve o que
existe hoje e o que ainda está no backlog.
