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

## Documentação

O plano do projeto, as revisões e as notas de design estão em
[`docs/`](docs/README.md). O [`docs/PLAN.md`](docs/PLAN.md) descreve o que
existe hoje e o que ainda está no backlog.
