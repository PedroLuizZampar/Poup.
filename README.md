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

No painel, ao importar o repositório, o `vercel.json` responde por quase tudo
(build, diretório de saída, região, rotas). O que precisa ser feito à mão são as
variáveis de ambiente, em Settings → Environment Variables:

| Variável | Valor |
| --- | --- |
| `DATABASE_URL` | O endpoint **pooler** do Neon, com `&pgbouncer=true&connection_limit=1` |
| `JWT_SECRET` | O mesmo do seu `.env`, ou um novo (trocar desloga todo mundo) |
| `APP_ENCRYPTION_KEY` | **O mesmo do seu `.env`** — é ela que decifra as credenciais da Pluggy já gravadas no banco |

`PLUGGY_BASE_URL`, `JWT_EXPIRES_IN` e `PORT` têm padrão e podem ficar de fora.

Três decisões que já estão no `vercel.json` e valem saber por quê:

- **`regions: ["gru1"]`** — o Neon está em `sa-east-1`, e o padrão da Vercel é
  Washington. Sem isto cada ida ao banco atravessa o continente: a latência medida
  daqui é de ~50ms, e de fora do país passa de 120ms. Num pedido que faz dezenas
  de consultas, é a diferença entre rápido e sofrível.
- **`maxDuration: 60`** — o teto do plano Hobby. O primeiro sync de uma conexão
  traz só o mês corrente justamente para caber com folga.
- **`buildCommand: npm run vercel-build`** — roda `prisma generate` e
  `prisma migrate deploy` antes do build do web. O `generate` não é opcional: a
  Vercel cacheia o `node_modules` entre builds e o client do Prisma ficaria velho.

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
