# Conta conjunta — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Duas pessoas passam a dividir um espaço financeiro — categorias, orçamentos e metas em comum, contas e transações somadas na leitura — a partir de um convite por e-mail que chega pelo sininho.

**Architecture:** Um `Household` por usuário desde o cadastro. `Category`, `Budget` e `Goal` trocam `userId` por `householdId`; `Item`, `Account`, `Transaction`, `CreditCardBill`, `CategorySuggestion` e `Notification` mantêm `userId` como dono. Um `Scope` resolvido por requisição (`{ userId, householdId, memberIds }`) substitui o parâmetro `userId` nos serviços, e a leitura somada vira `userId: { in: memberIds }`.

**Tech Stack:** Node + Express + TypeScript, Prisma 5 sobre PostgreSQL (Neon), Vitest com `prisma` mockado, React + Vite + Tailwind no `apps/web`, tipos partilhados em `packages/shared`.

**Spec:** [`docs/superpowers/specs/2026-08-27-conta-conjunta-design.md`](../specs/2026-08-27-conta-conjunta-design.md)

## Global Constraints

- **Português nos identificadores de domínio e nos comentários**, seguindo o código existente (`resolveAccountName`, `vencimentoDaFatura`, `camposDaTransacao`). Comentário explica **por que**, não o que.
- **Nenhuma migração apaga dado.** O banco de desenvolvimento é compartilhado e tem uma segunda conta real além da do desenvolvedor. Toda migração vale sobre todas as linhas, sem `WHERE` de usuário.
- **Migrações escritas à mão**, criadas com `npx prisma migrate dev --create-only --name <nome>` e depois editadas. O `prisma migrate dev` sozinho derruba e recria colunas, perdendo dado.
- **Testes mockam o `prisma`** com `vi.mock("../../prisma", ...)`, como em `apps/api/src/modules/budgets/exclusao.test.ts`. Não há banco de teste.
- **Nada de trabalho em segundo plano.** A função da Vercel só vive durante a requisição, e tem teto de 60 s.
- **Dinheiro é `Prisma.Decimal` no banco** e `number` nos DTOs. Somas de orçamento na fusão usam `Prisma.Decimal`, nunca `+` de ponto flutuante.
- Comandos: `npm test --workspace=apps/api` (Vitest), `npm run build --workspace=apps/api` (tsc), `npm test --workspace=apps/web`.

---

## Estrutura de arquivos

**Criados:**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/lib/scope.ts` | O tipo `Scope`, `resolveScope` e `ownerIds`. Uma responsabilidade: dizer quem sou e quem mais conta. |
| `apps/api/src/lib/scope.test.ts` | Testes de `ownerIds`, incluindo o 403 do `owner` estranho. |
| `apps/api/src/middleware/withScope.ts` | Middleware que resolve o `Scope` e o grava em `req.scope`. |
| `apps/api/src/modules/household/normalizeCategoryName.ts` | Normalização de nome de categoria para o casamento da fusão. |
| `apps/api/src/modules/household/normalizeCategoryName.test.ts` | Testes da normalização. |
| `apps/api/src/modules/household/merge.ts` | `mergeHouseholds` — a fusão no aceite. |
| `apps/api/src/modules/household/merge.test.ts` | Testes da fusão. |
| `apps/api/src/modules/household/split.ts` | `splitHousehold` — a dissolução na saída. |
| `apps/api/src/modules/household/split.test.ts` | Testes da dissolução. |
| `apps/api/src/modules/household/household.service.ts` | Estado, convite, aceite, recusa, cancelamento, saída. |
| `apps/api/src/modules/household/household.routes.ts` | As seis rotas de `/api/household`. |
| `apps/api/src/modules/household/convite.test.ts` | Testes das recusas de `inviteToHousehold`. |
| `apps/web/src/components/profile/ContaConjuntaSection.tsx` | A seção do perfil: convidar, responder, listar membros, sair. |
| `apps/web/src/components/ui/OwnerFilter.tsx` | O `Select` de pessoa com `UserAvatar`, reusado nas três telas. |

**Modificados** (os principais; cada tarefa nomeia os seus):

| Arquivo | Mudança |
|---|---|
| `apps/api/prisma/schema.prisma` | `Household`, `HouseholdInvite`, `HouseholdInviteStatus`; `householdId` em `User`/`Category`/`Budget`/`Goal`; `createdByUserId` em `Goal`. |
| `apps/api/src/modules/transactions/transactions.service.ts` | `resolveAccountName` no DTO; `ownerUserId` no DTO; leitura por `memberIds`. |
| `apps/api/src/modules/{categories,budgets,goals}/*.service.ts` | `userId` → `householdId`. |
| `apps/api/src/modules/{accounts,reports,bills,categorization,pluggy,notifications}/*` | `userId` → `scope`. |
| `packages/shared/src/index.ts` | `HouseholdMemberDTO`, `HouseholdInviteDTO`, `HouseholdStateDTO`; `ownerUserId` em `TransactionDTO`; `household` em `UserDTO`. |

---

## Fase 1 — a correção avulsa

### Task 1: Nome escolhido pelo usuário na transação

`goals.service` já usa `resolveAccountName`; `transactions.service` não, e monta o DTO com o nome cru do banco. Quem apelidou "Nubank" de "Cartão da casa" vê o apelido no filtro de contas e "Nubank" na grid.

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:66-110`
- Test: `apps/api/src/modules/transactions/nomeDaConta.test.ts` (criar)

**Interfaces:**
- Consumes: `resolveAccountName(account: { name: string; customName: string | null }): string` de `apps/api/src/modules/accounts/accounts.service.ts`
- Produces: `formatTransactionDTO` passa a exigir `customName: string | null` dentro de `tx.account`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/modules/transactions/nomeDaConta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { formatTransactionDTO } from "./transactions.service";

/**
 * O apelido da conta é a razão de `customName` existir: o sync reescreve `name`
 * a cada atualização, e quem renomeou "Nubank" para "Cartão da casa" precisa ver
 * o apelido em toda tela, não só nas que lembraram de resolvê-lo.
 */
function transacaoCom(account: { name: string; customName: string | null }) {
  return {
    id: "tx-1",
    description: "Mercado",
    amount: new Prisma.Decimal(10),
    type: "EXPENSE" as const,
    date: new Date("2026-08-01T00:00:00.000Z"),
    note: null,
    isRecurring: false,
    accountId: "acc-1",
    account: { ...account, creditCardDueDay: null },
    categoryId: null,
    category: null,
    installmentIndex: null,
    installmentTotal: null,
    billMonth: null,
    competenceDate: new Date("2026-08-01T00:00:00.000Z"),
    purchaseKey: null,
    compensationId: null,
  };
}

describe("nome da conta no DTO da transação", () => {
  it("usa o apelido quando existe", () => {
    const dto = formatTransactionDTO(
      transacaoCom({ name: "Nubank", customName: "Cartão da casa" })
    );
    expect(dto.accountName).toBe("Cartão da casa");
  });

  it("cai no nome do banco quando não há apelido", () => {
    const dto = formatTransactionDTO(transacaoCom({ name: "Nubank", customName: null }));
    expect(dto.accountName).toBe("Nubank");
  });

  it("ignora apelido que é só espaço em branco", () => {
    const dto = formatTransactionDTO(transacaoCom({ name: "Nubank", customName: "   " }));
    expect(dto.accountName).toBe("Nubank");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm test --workspace=apps/api -- nomeDaConta`
Expected: FAIL — o primeiro caso volta `"Nubank"` em vez de `"Cartão da casa"`, e o tipo do parâmetro nem aceita `customName`.

- [ ] **Step 3: Corrigir o serviço**

Em `apps/api/src/modules/transactions/transactions.service.ts`, importar a função:

```ts
import { resolveAccountName } from "../accounts/accounts.service";
```

Acrescentar `customName` ao `select` do `TX_INCLUDE`:

```ts
export const TX_INCLUDE = {
  account: { select: { name: true, customName: true, creditCardDueDay: true } },
  category: { select: { name: true } },
} as const;
```

No tipo do parâmetro de `formatTransactionDTO`:

```ts
  account: { name: string; customName: string | null; creditCardDueDay: number | null };
```

E na montagem do DTO, trocar `accountName: tx.account.name` por:

```ts
    accountName: resolveAccountName(tx.account),
```

- [ ] **Step 4: Rodar os testes e o build**

Run: `npm test --workspace=apps/api -- nomeDaConta`
Expected: PASS (3 testes)

Run: `npm test --workspace=apps/api`
Expected: PASS — nada mais quebrou.

Run: `npm run build --workspace=apps/api`
Expected: sem erro. Se algum chamador de `formatTransactionDTO` montar o objeto à mão sem `customName`, o tsc aponta o arquivo e a linha; acrescente `customName: true` ao `select` daquele ponto.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/transactions/transactions.service.ts apps/api/src/modules/transactions/nomeDaConta.test.ts
git commit -m "fix(api): a transacao passa a exibir o apelido da conta, nao o nome do banco"
```

---

## Fase 2 — schema, migração e escopo

Ao fim desta fase o app faz **exatamente** o que fazia antes: cada usuário sozinho no próprio espaço. É isso que prova que o refactor não quebrou nada.

### Task 2: Schema e migração

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260827120000_conta_conjunta/migration.sql`

**Interfaces:**
- Produces: modelos `Household` e `HouseholdInvite`; `User.householdId`; `Category.householdId`; `Budget.householdId`; `Goal.householdId` e `Goal.createdByUserId`. `Category.userId`, `Budget.userId` e `Goal.userId` deixam de existir.

- [ ] **Step 1: Editar o `schema.prisma`**

Acrescentar o enum, junto dos outros:

```prisma
enum HouseholdInviteStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
}
```

Acrescentar os dois modelos:

```prisma
/// O espaco em que categorias, orcamentos e metas vivem.
///
/// Todo usuario tem um desde o cadastro, mesmo sozinho: sem isso a fusao teria
/// de lidar com dois casos (tem espaco / nao tem) e toda leitura precisaria de
/// um fallback para `userId`.
model Household {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())

  members    User[]
  categories Category[]
  budgets    Budget[]
  goals      Goal[]
  invites    HouseholdInvite[]
}

/// Convite para entrar num espaco.
///
/// O e-mail e guardado ao lado do `inviteeId` para que o registro continue
/// legivel depois: quem convidou precisa ver para quem mandou, e nome e e-mail
/// do outro podem mudar.
model HouseholdInvite {
  id           String                @id @default(uuid())
  householdId  String
  inviterId    String
  inviteeId    String
  inviteeEmail String
  status       HouseholdInviteStatus @default(PENDING)
  createdAt    DateTime              @default(now())
  respondedAt  DateTime?

  household Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  inviter   User      @relation("InvitesSent", fields: [inviterId], references: [id], onDelete: Cascade)
  invitee   User      @relation("InvitesReceived", fields: [inviteeId], references: [id], onDelete: Cascade)

  @@index([inviteeId, status])
  @@index([householdId, status])
}
```

Em `User`, acrescentar o campo e as três relações novas:

```prisma
  householdId  String
  household        Household         @relation(fields: [householdId], references: [id])
  invitesSent      HouseholdInvite[] @relation("InvitesSent")
  invitesReceived  HouseholdInvite[] @relation("InvitesReceived")
```

E **remover** de `User` as relações `categories`, `budgets` e `goals` — elas passam a pendurar no `Household`.

Em `Category`: trocar `userId String` por `householdId String`, trocar a relação `user` por

```prisma
  household Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
```

e os índices por

```prisma
  @@unique([householdId, name])
  @@unique([householdId, systemKey])
```

Em `Budget`: mesma troca, com `@@unique([householdId, categoryId])`.

Em `Goal`: mesma troca, mais o dono da criação:

```prisma
  /// Quem criou a meta. E o que a dissolucao usa para decidir com quem ela
  /// fica: `accountId` nao serve, porque e anulavel de proposito e meta sem
  /// conta ficaria sem destino.
  createdByUserId String
```

com `@@index([householdId])` e `@@index([createdByUserId])`.

- [ ] **Step 2: Gerar a migração vazia**

```bash
npx prisma migrate dev --create-only --name conta_conjunta --workspace=apps/api
```

Se o `--workspace` não passar para o binário, rode de `apps/api`:

```bash
cd apps/api && npx prisma migrate dev --create-only --name conta_conjunta
```

- [ ] **Step 3: Substituir o SQL gerado**

Apagar tudo que o Prisma escreveu no `migration.sql` e pôr:

```sql
-- 1. Os modelos novos.
CREATE TYPE "HouseholdInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HouseholdInvite" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "inviteeId" TEXT NOT NULL,
    "inviteeEmail" TEXT NOT NULL,
    "status" "HouseholdInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    CONSTRAINT "HouseholdInvite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HouseholdInvite_inviteeId_status_idx" ON "HouseholdInvite"("inviteeId", "status");
CREATE INDEX "HouseholdInvite_householdId_status_idx" ON "HouseholdInvite"("householdId", "status");

-- Um convite pendente por par, garantido pelo banco e nao por um `findFirst`
-- que duas requisicoes simultaneas atravessam juntas.
CREATE UNIQUE INDEX "HouseholdInvite_pendente_por_par"
  ON "HouseholdInvite" ("householdId", "inviteeId")
  WHERE "status" = 'PENDING';

ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HouseholdInvite" ADD CONSTRAINT "HouseholdInvite_inviteeId_fkey" FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Um espaco por usuario que ja existe.
--
-- `AS MATERIALIZED` nao e enfeite: `gen_random_uuid()` e volatil, e sem a
-- materializacao explicita nada garante que o id inserido no Household seja o
-- mesmo gravado no User.
ALTER TABLE "User" ADD COLUMN "householdId" TEXT;

WITH novos AS MATERIALIZED (
  SELECT u."id" AS user_id, gen_random_uuid()::text AS household_id FROM "User" u
), inseridos AS (
  INSERT INTO "Household" ("id") SELECT household_id FROM novos
)
UPDATE "User" u SET "householdId" = n.household_id FROM novos n WHERE u."id" = n.user_id;

ALTER TABLE "User" ALTER COLUMN "householdId" SET NOT NULL;
CREATE INDEX "User_householdId_idx" ON "User"("householdId");
ALTER TABLE "User" ADD CONSTRAINT "User_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. Category: preenche, torna obrigatorio, e so entao derruba o userId.
ALTER TABLE "Category" ADD COLUMN "householdId" TEXT;
UPDATE "Category" c SET "householdId" = u."householdId" FROM "User" u WHERE u."id" = c."userId";
ALTER TABLE "Category" ALTER COLUMN "householdId" SET NOT NULL;

DROP INDEX "Category_userId_name_key";
DROP INDEX "Category_userId_systemKey_key";
ALTER TABLE "Category" DROP CONSTRAINT "Category_userId_fkey";
ALTER TABLE "Category" DROP COLUMN "userId";

ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Category_householdId_name_key" ON "Category"("householdId", "name");
CREATE UNIQUE INDEX "Category_householdId_systemKey_key" ON "Category"("householdId", "systemKey");

-- 4. Budget.
ALTER TABLE "Budget" ADD COLUMN "householdId" TEXT;
UPDATE "Budget" b SET "householdId" = u."householdId" FROM "User" u WHERE u."id" = b."userId";
ALTER TABLE "Budget" ALTER COLUMN "householdId" SET NOT NULL;

DROP INDEX "Budget_userId_categoryId_key";
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_userId_fkey";
ALTER TABLE "Budget" DROP COLUMN "userId";

ALTER TABLE "Budget" ADD CONSTRAINT "Budget_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Budget_householdId_categoryId_key" ON "Budget"("householdId", "categoryId");

-- 5. Goal, que alem do espaco ganha o dono da criacao.
ALTER TABLE "Goal" ADD COLUMN "householdId" TEXT;
ALTER TABLE "Goal" ADD COLUMN "createdByUserId" TEXT;
UPDATE "Goal" g SET "householdId" = u."householdId", "createdByUserId" = g."userId" FROM "User" u WHERE u."id" = g."userId";
ALTER TABLE "Goal" ALTER COLUMN "householdId" SET NOT NULL;
ALTER TABLE "Goal" ALTER COLUMN "createdByUserId" SET NOT NULL;

ALTER TABLE "Goal" DROP CONSTRAINT "Goal_userId_fkey";
ALTER TABLE "Goal" DROP COLUMN "userId";

ALTER TABLE "Goal" ADD CONSTRAINT "Goal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Goal_householdId_idx" ON "Goal"("householdId");
CREATE INDEX "Goal_createdByUserId_idx" ON "Goal"("createdByUserId");
```

- [ ] **Step 4: Aplicar e conferir**

```bash
cd apps/api && npx prisma migrate dev
```

Expected: aplica sem erro e regenera o client.

Conferir que nada ficou órfão — as três contagens têm de bater:

```bash
cd apps/api && npx prisma db execute --stdin <<'SQL'
SELECT
  (SELECT count(*) FROM "User")                          AS usuarios,
  (SELECT count(*) FROM "Household")                     AS espacos,
  (SELECT count(DISTINCT "householdId") FROM "Category") AS espacos_com_categoria;
SQL
```

Expected: `usuarios` = `espacos`. `espacos_com_categoria` ≤ `espacos` (um usuário sem categoria nenhuma é possível).

- [ ] **Step 5: Ver o compilador listar o trabalho**

Run: `npm run build --workspace=apps/api`
Expected: **FALHA, e é o esperado.** Cada `where: { userId }` em `categories.service`, `budgets.service`, `goals.service` e no `lib/systemCategories.ts`/`lib/defaultCategories.ts` vira erro. Salve a saída — é a lista de trabalho das Tasks 5 a 9.

```bash
npm run build --workspace=apps/api 2>&1 | grep "error TS" | sort -u > /tmp/conta-conjunta-pendencias.txt
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api)!: Household passa a ser o dono de categoria, orcamento e meta"
```

O código não compila neste commit, e é deliberado: o schema e o refactor que ele obriga são commits separados para que a migração seja legível sozinha. As Tasks 3 a 9 fecham o buraco; não abra PR no meio.

### Task 3: O `Scope` e o `ownerIds`

**Files:**
- Create: `apps/api/src/lib/scope.ts`
- Create: `apps/api/src/lib/scope.test.ts`

**Interfaces:**
- Consumes: `ForbiddenError`, `UserNotFoundError` de `apps/api/src/lib/errors.ts`; `prisma` de `apps/api/src/prisma.ts`
- Produces:
  - `interface Scope { userId: string; householdId: string; memberIds: string[] }`
  - `resolveScope(userId: string): Promise<Scope>`
  - `ownerIds(scope: Scope, owner?: string | null): string[]`

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/lib/scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ownerIds, type Scope } from "./scope";

const casal: Scope = {
  userId: "ana",
  householdId: "casa-1",
  memberIds: ["ana", "bento"],
};

describe("ownerIds", () => {
  it("sem filtro, soma o espaço inteiro", () => {
    expect(ownerIds(casal)).toEqual(["ana", "bento"]);
  });

  it("'all' é o mesmo que sem filtro", () => {
    expect(ownerIds(casal, "all")).toEqual(["ana", "bento"]);
  });

  it("string vazia é o mesmo que sem filtro", () => {
    expect(ownerIds(casal, "")).toEqual(["ana", "bento"]);
  });

  it("restringe a um membro", () => {
    expect(ownerIds(casal, "bento")).toEqual(["bento"]);
  });

  /**
   * O buraco que o filtro por pessoa abre. A rota está autenticada; o que
   * faltaria sem esta checagem é a autorização — e `?owner=<id qualquer>` leria
   * a vida financeira de um estranho.
   */
  it("recusa quem não é do espaço", () => {
    expect(() => ownerIds(casal, "estranho")).toThrowError(
      /não faz parte da sua conta conjunta/
    );
  });

  it("recusa mesmo quando o espaço tem um membro só", () => {
    const sozinha: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana"] };
    expect(() => ownerIds(sozinha, "bento")).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- scope`
Expected: FAIL — `Cannot find module './scope'`.

- [ ] **Step 3: Escrever o `scope.ts`**

```ts
import { prisma } from "../prisma";
import { ForbiddenError, UserNotFoundError } from "./errors";

/**
 * Quem sou eu, e quem mais conta nesta requisicao.
 *
 * Substitui o `userId: string` que os servicos recebiam. Nao e cosmetico: e o
 * que transforma "esqueci de somar o parceiro nesta consulta" de um bug
 * silencioso num erro do compilador.
 */
export interface Scope {
  /** Quem esta agindo. Dono do que for criado e sujeito das permissoes. */
  userId: string;
  /** O espaco em que categorias, orcamentos e metas vivem. */
  householdId: string;
  /** Todos os membros, em ordem de entrada. E o que a leitura somada usa. */
  memberIds: string[];
}

/**
 * Duas idas ao banco, as duas por indice. Nenhuma delas pode ir para o JWT:
 * entrar num espaco mudaria o escopo, e o token velho continuaria valendo com o
 * escopo antigo ate expirar.
 */
export async function resolveScope(userId: string): Promise<Scope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { householdId: true },
  });
  if (!user) throw new UserNotFoundError();

  const membros = await prisma.user.findMany({
    where: { householdId: user.householdId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    userId,
    householdId: user.householdId,
    memberIds: membros.map((m) => m.id),
  };
}

/**
 * O filtro "Todos / Fulano / Beltrano" das telas, resolvido em ids.
 *
 * A checagem de pertinencia nao e opcional — ver o teste que a guarda.
 */
export function ownerIds(scope: Scope, owner?: string | null): string[] {
  if (!owner || owner === "all") return scope.memberIds;
  if (!scope.memberIds.includes(owner)) {
    throw new ForbiddenError("Este usuário não faz parte da sua conta conjunta");
  }
  return [owner];
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- scope`
Expected: PASS (6 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/scope.ts apps/api/src/lib/scope.test.ts
git commit -m "feat(api): o escopo da requisicao passa a dizer quem mais conta"
```

### Task 4: O middleware `withScope`

**Files:**
- Create: `apps/api/src/middleware/withScope.ts`
- Modify: `apps/api/src/app.ts` (nas montagens de router)

**Interfaces:**
- Consumes: `resolveScope`, `Scope` da Task 3
- Produces: `req.scope: Scope` disponível em toda rota autenticada; `withScope` como `RequestHandler`

- [ ] **Step 1: Escrever o middleware**

Criar `apps/api/src/middleware/withScope.ts`:

```ts
import { NextFunction, Request, Response } from "express";
import { resolveScope, type Scope } from "../lib/scope";

declare global {
  namespace Express {
    interface Request {
      scope?: Scope;
    }
  }
}

/**
 * Monta sempre **depois** do `requireAuth`: sem `req.userId` nao ha o que
 * resolver. Falha aqui e falha da requisicao inteira, e nao um escopo vazio
 * que silenciosamente devolveria a lista errada.
 */
export async function withScope(req: Request, _res: Response, next: NextFunction) {
  try {
    req.scope = await resolveScope(req.userId!);
    next();
  } catch (err) {
    next(err);
  }
}
```

- [ ] **Step 2: Montar nos routers**

Em cada router que já faz `router.use(requireAuth)`, acrescentar a linha seguinte. Os arquivos são:

- `apps/api/src/modules/accounts/accounts.routes.ts`
- `apps/api/src/modules/categories/categories.routes.ts`
- `apps/api/src/modules/transactions/transactions.routes.ts`
- `apps/api/src/modules/reports/reports.routes.ts`
- `apps/api/src/modules/budgets/budgets.routes.ts`
- `apps/api/src/modules/goals/goals.routes.ts`
- `apps/api/src/modules/notifications/notifications.routes.ts`
- `apps/api/src/modules/categorization/suggestions.routes.ts`
- `apps/api/src/modules/pluggy/pluggy.routes.ts`

Em cada um:

```ts
import { withScope } from "../../middleware/withScope";

// ...
router.use(requireAuth);
router.use(withScope);
```

**Não** monte no `webhook.routes.ts`: quem chama é a Pluggy, sem sessão, e `req.userId` é `undefined` ali.

No `auth.routes.ts` monte apenas nas rotas que já exigem sessão (`/me`, `PATCH /me`, troca de senha), e nunca em `/login` e `/register`.

- [ ] **Step 3: Conferir que o tipo chegou**

Run: `npm run build --workspace=apps/api`
Expected: os erros de `Category.userId` continuam (Tasks 5-9), mas nenhum erro novo em `withScope.ts` nem nos routers.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/middleware/withScope.ts apps/api/src/modules/*/*.routes.ts
git commit -m "feat(api): withScope resolve o espaco uma vez por requisicao"
```

### Task 5: `categories.service` no espaço

**Files:**
- Modify: `apps/api/src/modules/categories/categories.service.ts`
- Modify: `apps/api/src/modules/categories/categories.routes.ts`
- Modify: `apps/api/src/lib/systemCategories.ts`
- Modify: `apps/api/src/lib/defaultCategories.ts`

**Interfaces:**
- Consumes: `Scope` da Task 3
- Produces:
  - `ensureSystemCategories(client, householdId: string): Promise<SystemCategoryIds>`
  - `createDefaultCategories(client, householdId: string): Promise<void>`
  - `listCategories(householdId: string)`, `getCategoryById(householdId, id)`, `createCategory(householdId, input)`, `updateCategory(householdId, id, input)`, `deleteCategory(householdId, id)`

Categoria é do espaço inteiro, então estes serviços recebem `householdId` e não `Scope`: pedir o escopo completo sugeriria que existe uma decisão de dono a tomar, e não existe.

- [ ] **Step 1: Trocar o parâmetro em `systemCategories.ts` e `defaultCategories.ts`**

Em `apps/api/src/lib/systemCategories.ts`, renomear o parâmetro e todos os usos:

```ts
export async function ensureSystemCategories(
  client: Pick<PrismaClient, "category">,
  householdId: string
): Promise<SystemCategoryIds> {
```

Dentro dela, `where: { userId, systemKey: def.systemKey }` vira `where: { householdId, systemKey: def.systemKey }`; `where: { userId_name: { userId, name: def.name } }` vira `where: { householdId_name: { householdId, name: def.name } }`; e o `data:` do `create` troca `userId` por `householdId`.

Em `apps/api/src/lib/defaultCategories.ts`, a mesma troca em `createDefaultCategories`.

- [ ] **Step 2: Trocar em `categories.service.ts`**

Toda função troca o primeiro parâmetro `userId: string` por `householdId: string`, e todo `where` troca `userId` por `householdId`. Os dois pontos que não são substituição cega:

```ts
export async function createCategory(householdId: string, input: CreateCategoryInput) {
  const trimmedName = input.name.trim();

  const existing = await prisma.category.findUnique({
    where: {
      householdId_name: {
        householdId,
        name: trimmedName,
      },
    },
  });

  if (existing) {
    throw new CategoryAlreadyExistsError(trimmedName);
  }
  // ... resto igual, com `householdId` no `data:`
}
```

```ts
export async function listCategories(householdId: string) {
  return prisma.category.findMany({
    where: { householdId },
    orderBy: { name: "asc" },
  });
}
```

- [ ] **Step 3: Passar o `householdId` nas rotas**

Em `apps/api/src/modules/categories/categories.routes.ts`, cada `req.userId!` vira `req.scope!.householdId`. Exemplo:

```ts
categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await listCategories(req.scope!.householdId);
    res.json({ categories });
  })
);
```

- [ ] **Step 4: Compilar**

Run: `npm run build --workspace=apps/api`
Expected: os erros de `categories.service`, `systemCategories` e `defaultCategories` somem. Sobram os de `budgets`, `goals` e dos chamadores de `ensureSystemCategories` (`reports.service`, `categorization.service`, `pluggy.service`) — esses caem nas Tasks 6 a 9.

- [ ] **Step 5: Rodar os testes**

Run: `npm test --workspace=apps/api`
Expected: os testes que mockam `prisma.category` podem falhar por causa do `where` novo. Ajuste as expectativas do mock — `householdId` no lugar de `userId` — sem afrouxar a asserção.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/categories apps/api/src/lib/systemCategories.ts apps/api/src/lib/defaultCategories.ts
git commit -m "refactor(api): categoria passa a pertencer ao espaco"
```

### Task 6: `budgets.service` no espaço

**Files:**
- Modify: `apps/api/src/modules/budgets/budgets.service.ts`
- Modify: `apps/api/src/modules/budgets/budgets.routes.ts`
- Modify: `apps/api/src/modules/budgets/exclusao.test.ts`

**Interfaces:**
- Consumes: `Scope` da Task 3
- Produces: `listBudgets(scope: Scope, monthStr?: string)`, `upsertBudget(scope, categoryId, monthlyLimit)`, `deleteBudget(scope, id)`

Orçamento é do espaço, mas o gasto que ele mede vem das transações — que têm dono. Por isso aqui é `Scope` e não `householdId`: a função precisa dos dois lados.

- [ ] **Step 1: Ajustar o teste primeiro**

Em `apps/api/src/modules/budgets/exclusao.test.ts`, as chamadas passam a receber um escopo. No topo do arquivo, depois dos mocks:

```ts
import type { Scope } from "../../lib/scope";

const escopo: Scope = { userId: "u-1", householdId: "casa-1", memberIds: ["u-1"] };
```

Trocar as chamadas `listBudgets("u-1")` por `listBudgets(escopo)` e `upsertBudget("u-1", ...)` por `upsertBudget(escopo, ...)`.

E acrescentar um teste que guarda a soma do casal:

```ts
describe("orçamento soma o gasto dos dois membros", () => {
  it("consulta transações de todo o espaço", async () => {
    budgetFindMany.mockResolvedValue([
      { id: "orc-1", categoryId: "cat-1", monthlyLimit: 500, category: categoria },
    ]);
    const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

    await listBudgets(casal);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["ana", "bento"] } }),
      })
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- budgets`
Expected: FAIL — a assinatura ainda é `(userId: string, ...)`.

- [ ] **Step 3: Reescrever o serviço**

```ts
import type { Scope } from "../../lib/scope";

export async function listBudgets(scope: Scope, monthStr?: string): Promise<BudgetDTO[]> {
  const [year, month] = parseMonth(monthStr);
  const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const startOfNextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));

  const budgets = await prisma.budget.findMany({
    where: { householdId: scope.householdId },
    include: {
      category: { select: { id: true, name: true, icon: true, colorKey: true } },
    },
    orderBy: { category: { name: "asc" } },
  });

  const categoryIds = budgets.map((b) => b.categoryId);

  const transactions = await prisma.transaction.findMany({
    where: {
      // O orcamento e do casal: o teto mede o gasto dos dois somado, ou seria
      // um teto que so um dos dois consegue estourar.
      userId: { in: scope.memberIds },
      type: "EXPENSE",
      categoryId: { in: categoryIds },
      compensationId: null,
      competenceDate: { gte: startOfMonth, lt: startOfNextMonth },
    },
    select: { categoryId: true, amount: true },
  });

  // ... o resto do corpo fica igual
}
```

Em `upsertBudget`, a checagem de categoria e o `upsert`:

```ts
export async function upsertBudget(
  scope: Scope,
  categoryId: string,
  monthlyLimit: number
): Promise<BudgetDTO> {
  const category = await prisma.category.findFirst({
    where: { id: categoryId, householdId: scope.householdId },
  });
  if (!category) throw new CategoryNotFoundError();
  if (category.systemKey) throw new SystemCategoryError();

  const budget = await prisma.budget.upsert({
    where: {
      householdId_categoryId: { householdId: scope.householdId, categoryId },
    },
    update: { monthlyLimit: new Prisma.Decimal(monthlyLimit) },
    create: {
      householdId: scope.householdId,
      categoryId,
      monthlyLimit: new Prisma.Decimal(monthlyLimit),
    },
    include: {
      category: { select: { id: true, name: true, icon: true, colorKey: true } },
    },
  });
  // ...
```

e o `aggregate` logo abaixo troca `userId` por `userId: { in: scope.memberIds }`.

Em `deleteBudget`:

```ts
export async function deleteBudget(scope: Scope, id: string): Promise<{ success: true }> {
  const existing = await prisma.budget.findFirst({
    where: { id, householdId: scope.householdId },
  });
  if (!existing) throw new BudgetNotFoundError();
  await prisma.budget.delete({ where: { id } });
  return { success: true };
}
```

- [ ] **Step 4: Passar o escopo nas rotas**

Em `budgets.routes.ts`, cada `req.userId!` vira `req.scope!`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- budgets`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/budgets
git commit -m "refactor(api): orcamento e do espaco, e mede o gasto dos dois"
```

### Task 7: `goals.service` no espaço

**Files:**
- Modify: `apps/api/src/modules/goals/goals.service.ts`
- Modify: `apps/api/src/modules/goals/goals.routes.ts`

**Interfaces:**
- Consumes: `Scope` da Task 3
- Produces: `listGoals(scope)`, `getGoalById(scope, id)`, `createGoal(scope, input)`, `updateGoal(scope, id, input)`, `deleteGoal(scope, id)`. `GoalWithAccount` ganha `createdByUserId: string`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `apps/api/src/modules/goals/escopo.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

const goalFindMany = vi.fn();
const goalCreate = vi.fn();
const accountFindFirst = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    goal: { findMany: goalFindMany, create: goalCreate },
    account: { findFirst: accountFindFirst },
  },
}));

const { listGoals, createGoal } = await import("./goals.service");

const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

beforeEach(() => {
  goalFindMany.mockReset().mockResolvedValue([]);
  accountFindFirst.mockReset().mockResolvedValue({ id: "acc-1" });
  goalCreate.mockReset().mockResolvedValue({
    id: "meta-1",
    name: "Viagem",
    accountId: "acc-1",
    targetAmount: 1000,
    targetDate: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    account: { name: "Conta", customName: null, balance: 0 },
  });
});

describe("meta em espaço conjunto", () => {
  it("lista as metas do espaço, não as de um usuário", async () => {
    await listGoals(casal);
    expect(goalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "casa-1" } })
    );
  });

  it("grava quem criou, para a dissolução saber com quem ela fica", async () => {
    await createGoal(casal, { name: "Viagem", accountId: "acc-1", targetAmount: 1000 });
    expect(goalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ householdId: "casa-1", createdByUserId: "ana" }),
      })
    );
  });

  it("aceita conta de qualquer membro do espaço", async () => {
    await createGoal(casal, { name: "Viagem", accountId: "acc-1", targetAmount: 1000 });
    expect(accountFindFirst).toHaveBeenCalledWith({
      where: { id: "acc-1", userId: { in: ["ana", "bento"] } },
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- goals`
Expected: FAIL

- [ ] **Step 3: Reescrever o serviço**

`assertAccountBelongsToUser` vira `assertAccountNoEspaco` — a conta pode ser do parceiro, e amarrar a meta à conta dele é exatamente o caso de uso:

```ts
async function assertAccountNoEspaco(scope: Scope, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: { in: scope.memberIds } },
  });
  if (!account) throw new AccountNotFoundError();
}
```

`listGoals` / `getGoalById` / `deleteGoal` filtram por `householdId: scope.householdId`; `updateGoal` idem, chamando `assertAccountNoEspaco(scope, input.accountId)`. `createGoal`:

```ts
export async function createGoal(scope: Scope, input: CreateGoalInput): Promise<GoalDTO> {
  await assertAccountNoEspaco(scope, input.accountId);

  const created = await prisma.goal.create({
    data: {
      householdId: scope.householdId,
      createdByUserId: scope.userId,
      accountId: input.accountId,
      name: input.name.trim(),
      targetAmount: new Prisma.Decimal(input.targetAmount),
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
    },
    include: goalInclude,
  });

  return formatGoalDTO(created);
}
```

- [ ] **Step 4: Passar o escopo nas rotas**

Em `goals.routes.ts`, cada `req.userId!` vira `req.scope!`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- goals`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/goals
git commit -m "refactor(api): meta e do espaco e guarda quem a criou"
```

### Task 8: Contas, transações, relatórios e faturas somam o espaço

**Files:**
- Modify: `apps/api/src/modules/accounts/accounts.service.ts`, `accounts.routes.ts`
- Modify: `apps/api/src/modules/transactions/transactions.service.ts`, `transactions.routes.ts`, `compensacao.service.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`, `reports.routes.ts`
- Modify: `apps/api/src/modules/bills/bills.service.ts`
- Modify: `apps/api/src/modules/reports/exclusao.test.ts`, `apps/api/src/modules/transactions/compensacao.test.ts`

**Interfaces:**
- Consumes: `Scope`, `ownerIds` da Task 3; `ensureSystemCategories(client, householdId)` da Task 5
- Produces: todos os serviços de leitura recebem `(scope: Scope, ...)`; os que a UI filtra por pessoa recebem também `owner?: string`

- [ ] **Step 1: A regra, para aplicar sem pensar duas vezes**

Em cada serviço destes arquivos:

| Antes | Depois | Por quê |
|---|---|---|
| `where: { userId }` numa **leitura** | `where: { userId: { in: ownerIds(scope, owner) } }` | é a leitura somada |
| `where: { userId }` numa **leitura sem filtro de pessoa** (fatura, compensação) | `where: { userId: { in: scope.memberIds } }` | não há seletor nessa tela |
| `where: { id, userId }` (buscar antes de editar) | `where: { id, userId: { in: scope.memberIds } }` | qualquer membro edita transação e conta |
| `data: { userId }` numa **criação** | `data: { userId: scope.userId }` | quem cria é o dono |
| `ensureSystemCategories(prisma, userId)` | `ensureSystemCategories(prisma, scope.householdId)` | categoria é do espaço |

A exceção que **não** segue a regra está na Task 9: sincronizar e desconectar conexão da Pluggy continuam restritos ao dono.

- [ ] **Step 2: Escrever o teste que guarda a soma**

Criar `apps/api/src/modules/transactions/escopo.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

const txFindMany = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: { transaction: { findMany: txFindMany } },
}));

const { listTransactions } = await import("./transactions.service");

const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

beforeEach(() => {
  txFindMany.mockReset().mockResolvedValue([]);
});

describe("lista de transações em espaço conjunto", () => {
  it("sem filtro, soma os dois", async () => {
    await listTransactions(casal, {});
    expect(txFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["ana", "bento"] } }),
      })
    );
  });

  it("com owner, restringe a um", async () => {
    await listTransactions(casal, { owner: "bento" });
    expect(txFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["bento"] } }),
      })
    );
  });

  it("recusa owner de fora do espaço", async () => {
    await expect(listTransactions(casal, { owner: "estranho" })).rejects.toThrow();
  });
});
```

Ajuste o nome e a assinatura de `listTransactions` ao que o arquivo já tem — leia `transactions.service.ts` antes de escrever o teste, e use os nomes reais.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- escopo`
Expected: FAIL

- [ ] **Step 4: Aplicar a regra do Step 1 nos quatro serviços**

Percorra `/tmp/conta-conjunta-pendencias.txt` e aplique. Nas rotas, `req.userId!` vira `req.scope!`, e as que aceitam o filtro por pessoa lêem a query:

```ts
const owner = typeof req.query.owner === "string" ? req.query.owner : undefined;
const transactions = await listTransactions(req.scope!, { ...filtros, owner });
```

Os filtros de query que já existem em `transactions.routes.ts` continuam iguais; `owner` é mais um.

- [ ] **Step 5: Ajustar os testes existentes**

`reports/exclusao.test.ts` e `transactions/compensacao.test.ts` chamam os serviços com `"user-1"`. Troque por um `Scope` de um membro só:

```ts
const escopo: Scope = { userId: "user-1", householdId: "casa-1", memberIds: ["user-1"] };
```

e ajuste as asserções de `where` de `userId: "user-1"` para `userId: { in: ["user-1"] }`. **Não** afrouxe a asserção para `expect.anything()` — é ela que provou a exclusão de linha compensada, e continua tendo de provar.

- [ ] **Step 6: Rodar tudo**

Run: `npm test --workspace=apps/api`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/accounts apps/api/src/modules/transactions apps/api/src/modules/reports apps/api/src/modules/bills
git commit -m "refactor(api): conta, transacao, relatorio e fatura somam o espaco"
```

### Task 9: Categorização, Pluggy, notificações e cadastro

**Files:**
- Modify: `apps/api/src/modules/categorization/categorization.service.ts`, `similar.service.ts`, `suggestions.service.ts`, `suggestions.routes.ts`
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`, `pluggy.routes.ts`
- Modify: `apps/api/src/modules/notifications/notifications.service.ts`, `notifications.routes.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/categorization/reopen.test.ts`

**Interfaces:**
- Consumes: `Scope`, `resolveScope` da Task 3
- Produces: `register` cria o `Household` do usuário novo; `generateAutomaticAlerts(scope)` grava uma notificação por membro

- [ ] **Step 1: O cadastro cria o espaço**

Em `apps/api/src/modules/auth/auth.service.ts`, dentro de `register`, o usuário e o espaço nascem juntos. Antes:

```ts
  await createDefaultCategories(prisma, user.id);
```

Depois — a criação do usuário passa a criar o espaço junto, num `$transaction`, porque um usuário sem espaço não consegue ler nada e não pode existir nem por um instante:

```ts
  const user = await prisma.$transaction(async (tx) => {
    const household = await tx.household.create({ data: {} });
    const criado = await tx.user.create({
      data: {
        // ... os campos que ja estavam aqui
        householdId: household.id,
      },
    });
    await createDefaultCategories(tx, household.id);
    return criado;
  });
```

Remova o `await createDefaultCategories(prisma, user.id)` que ficou solto. O tipo do primeiro parâmetro de `createDefaultCategories` já é `Pick<PrismaClient, "category">`, que o cliente de transação satisfaz — se o tsc reclamar, alargue para `Prisma.TransactionClient`.

- [ ] **Step 2: O palpite aprende do casal**

Em `similar.service.ts` e `categorization.service.ts`, as consultas de histórico trocam `userId` por `userId: { in: scope.memberIds }`, e `ensureSystemCategories(prisma, userId)` vira `ensureSystemCategories(prisma, scope.householdId)`.

Quem entra hoje passa a se beneficiar do que o parceiro já categorizou — "Zé da Esquina" não precisa ser ensinado duas vezes.

`CategorySuggestion` continua nascendo com `userId: scope.userId` (a fila é de quem sincronizou), mas resolver uma sugestão aceita qualquer membro: `where: { id, userId: { in: scope.memberIds } }`.

- [ ] **Step 3: Pluggy — a exceção**

Em `pluggy.service.ts`, **leituras** de item e conta somam o espaço (`userId: { in: scope.memberIds }`), para que os dois vejam as conexões do casal na tela.

Mas sincronizar e desconectar continuam do dono. Escreva a checagem explícita, e não por descuido:

```ts
/**
 * Sincronizar roda com as credenciais Pluggy cifradas **do dono** da conexao, e
 * um erro de login e problema dele para resolver. Ver o item da conexao na tela
 * e coisa do espaco; mexer nela, nao.
 */
const item = await prisma.item.findFirst({ where: { id: itemId, userId: scope.userId } });
if (!item) throw new ItemNotFoundError();
```

- [ ] **Step 4: Notificações**

Em `notifications.service.ts`:

`listNotifications`, `markAsRead`, `markAllAsRead` e `deleteNotification` continuam por `userId: scope.userId` — notificação é algo que **uma pessoa** leu ou não leu, e compartilhar a linha faria a leitura de um apagar o aviso do outro.

`generateAutomaticAlerts` passa a receber `Scope`, a ler o orçamento do casal e a gravar **uma linha por membro**:

```ts
export async function generateAutomaticAlerts(scope: Scope): Promise<number> {
  let createdCount = 0;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const budgets = await listBudgets(scope);
  for (const b of budgets) {
    if (b.status !== "exceeded" && b.status !== "warning") continue;

    const excedido = b.status === "exceeded";
    const title = excedido
      ? `Orçamento estourado: ${b.categoryName}`
      : `Atenção ao orçamento: ${b.categoryName}`;
    const body = excedido
      ? `Você ultrapassou o limite definido para ${b.categoryName}. Total gasto: R$ ${b.spent.toFixed(2)} de R$ ${b.monthlyLimit.toFixed(2)} (${b.percentage}%).`
      : `Você atingiu ${b.percentage}% do limite de R$ ${b.monthlyLimit.toFixed(2)} em ${b.categoryName}.`;
    const severity = excedido ? NotificationSeverity.ERROR : NotificationSeverity.WARNING;

    // Estourar o teto de mercado e noticia para os dois, e a linha e por pessoa
    // porque "lido" e por pessoa. A deduplicacao de sete dias segue por
    // (userId, titulo), que continua correto com uma linha para cada.
    for (const memberId of scope.memberIds) {
      const existing = await prisma.notification.findFirst({
        where: { userId: memberId, title, createdAt: { gte: sevenDaysAgo } },
      });
      if (existing) continue;

      await prisma.notification.create({
        data: { userId: memberId, title, body, severity },
      });
      createdCount++;
    }
  }

  return createdCount;
}
```

Em `createReviewNotification`, a notificação continua indo só para quem rodou o sync — foi a ação dele que trouxe as linhas —, mas a contagem do título passa a ser a do espaço, porque a fila que a tela abre também é:

```ts
export async function createReviewNotification(
  scope: Scope,
  result: ProcessResult
): Promise<void> {
  if (result.suggested + result.withoutGuess === 0) return;

  // A contagem e do espaco: o titulo promete um numero, e a tela de revisao que
  // ele abre mostra a fila do casal. Contar so as minhas mentiria no titulo.
  const pendentes = await prisma.categorySuggestion.count({
    where: { userId: { in: scope.memberIds }, status: "PENDING" },
  });
  if (pendentes === 0) return;

  // ... o resto do corpo igual, gravando com `userId: scope.userId`
}
```

- [ ] **Step 4b: Ajustar `reopen.test.ts`**

Troque as chamadas com `"user-1"` por um `Scope` de um membro, como no Step 5 da Task 8.

- [ ] **Step 5: Compilar limpo**

Run: `npm run build --workspace=apps/api`
Expected: **PASS.** Zero erro. Se sobrar algum, é um site que ainda usa `userId` onde o espaço manda — conserte antes de seguir.

Run: `npm test --workspace=apps/api`
Expected: PASS

- [ ] **Step 6: Provar que nada mudou para quem está sozinho**

```bash
npm run dev
```

Com um usuário só, conferir na mão: Dashboard carrega os saldos, Transações lista o mês, Relatórios soma, Planejamento mostra orçamentos e metas, e o sininho abre. Nenhuma dessas telas pode ter mudado de comportamento — é o critério de aceite desta fase inteira.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "refactor(api): categorizacao, pluggy e notificacoes no espaco; cadastro cria o Household"
```

---

## Fase 3 — o convite

### Task 10: DTOs do espaço

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `HouseholdMemberDTO`, `HouseholdInviteDTO`, `HouseholdStateDTO`; `UserDTO.household`

- [ ] **Step 1: Acrescentar os tipos**

```ts
export type HouseholdInviteStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED";

export interface HouseholdMemberDTO {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface HouseholdInviteDTO {
  id: string;
  status: HouseholdInviteStatus;
  /** Quem convidou. */
  inviter: HouseholdMemberDTO;
  /** Para quem foi. `name` e `avatarUrl` são nulos quando quem lê é o convidado. */
  inviteeEmail: string;
  createdAt: string;
}

export interface HouseholdStateDTO {
  id: string;
  members: HouseholdMemberDTO[];
  /** Convites que **eu** recebi e ainda não respondi. */
  invitesReceived: HouseholdInviteDTO[];
  /** Convites que o meu espaço enviou e ainda não foram respondidos. */
  invitesSent: HouseholdInviteDTO[];
}
```

E em `UserDTO`:

```ts
export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /**
   * O espaço vem junto do usuário para que o `App` o tenha desde o login, e
   * nenhuma tela precise de uma requisição própria só para saber se deve
   * desenhar o filtro por pessoa.
   */
  household: HouseholdStateDTO;
}
```

- [ ] **Step 2: Compilar o shared**

Run: `npm run build:shared`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): DTOs do espaco conjunto"
```

### Task 11: Convidar, recusar, cancelar

O aceite ainda **não** funde — ele entra na Task 14. Aqui a máquina de convites fica completa e testável sozinha.

**Files:**
- Create: `apps/api/src/modules/household/household.service.ts`
- Create: `apps/api/src/modules/household/household.routes.ts`
- Create: `apps/api/src/modules/household/convite.test.ts`
- Modify: `apps/api/src/lib/errors.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts` (`toUserDTO`)

**Interfaces:**
- Consumes: `Scope` (Task 3), `HouseholdStateDTO` (Task 10)
- Produces:
  - `getHouseholdState(scope: Scope): Promise<HouseholdStateDTO>`
  - `inviteToHousehold(scope: Scope, email: string): Promise<HouseholdInviteDTO>`
  - `declineInvite(scope: Scope, inviteId: string): Promise<{ success: true }>`
  - `cancelInvite(scope: Scope, inviteId: string): Promise<{ success: true }>`

- [ ] **Step 1: Escrever os testes das recusas**

Criar `apps/api/src/modules/household/convite.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

const userFindFirst = vi.fn();
const userCount = vi.fn();
const inviteCreate = vi.fn();
const notificationCreate = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    user: { findFirst: userFindFirst, count: userCount },
    householdInvite: { create: inviteCreate },
    notification: { create: notificationCreate },
  },
}));

const { inviteToHousehold } = await import("./household.service");

const ana: Scope = { userId: "ana", householdId: "casa-ana", memberIds: ["ana"] };

beforeEach(() => {
  userFindFirst.mockReset();
  userCount.mockReset().mockResolvedValue(1);
  inviteCreate.mockReset().mockResolvedValue({
    id: "conv-1",
    status: "PENDING",
    inviteeEmail: "bento@exemplo.com",
    createdAt: new Date("2026-08-27T00:00:00.000Z"),
    inviter: { id: "ana", name: "Ana", avatarUrl: null },
  });
  notificationCreate.mockReset().mockResolvedValue({});
});

describe("convite para a conta conjunta", () => {
  it("recusa e-mail sem conta no Poup", async () => {
    userFindFirst.mockResolvedValue(null);
    await expect(inviteToHousehold(ana, "ninguem@exemplo.com")).rejects.toThrow(
      /não encontramos ninguém com este e-mail/i
    );
  });

  it("recusa convidar a si mesmo", async () => {
    userFindFirst.mockResolvedValue({ id: "ana", householdId: "casa-ana" });
    await expect(inviteToHousehold(ana, "ana@exemplo.com")).rejects.toThrow(
      /a si mesmo/i
    );
  });

  it("recusa quem já está numa conta conjunta", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    userCount.mockResolvedValue(2);
    await expect(inviteToHousehold(ana, "bento@exemplo.com")).rejects.toThrow(
      /já faz parte de uma conta conjunta/i
    );
  });

  it("compara o e-mail sem diferenciar maiúsculas", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    await inviteToHousehold(ana, "  BENTO@Exemplo.com  ");
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: "bento@exemplo.com", mode: "insensitive" } },
      })
    );
  });

  it("avisa o convidado pelo sininho, com link para o perfil", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    await inviteToHousehold(ana, "bento@exemplo.com");
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "bento", link: "/perfil#conjunta" }),
      })
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- convite`
Expected: FAIL — `Cannot find module './household.service'`.

- [ ] **Step 3: Acrescentar os erros**

Em `apps/api/src/lib/errors.ts`, junto das outras classes:

```ts
export class ConviteInvalidoError extends UnprocessableError {
  constructor(message: string) {
    super(message, { field: "email" });
  }
}

export class ConviteNaoEncontradoError extends NotFoundError {
  constructor() {
    super("Convite não encontrado");
  }
}
```

- [ ] **Step 4: Escrever o serviço**

Criar `apps/api/src/modules/household/household.service.ts`:

```ts
import { prisma } from "../../prisma";
import type { HouseholdInviteDTO, HouseholdStateDTO } from "@poup/shared";
import type { Scope } from "../../lib/scope";
import { ConviteInvalidoError, ConviteNaoEncontradoError } from "../../lib/errors";

const LINK_CONJUNTA = "/perfil#conjunta";

const membroSelect = { id: true, name: true, avatarUrl: true } as const;

const conviteInclude = { inviter: { select: membroSelect } } as const;

function formatInviteDTO(invite: {
  id: string;
  status: string;
  inviteeEmail: string;
  createdAt: Date;
  inviter: { id: string; name: string; avatarUrl: string | null };
}): HouseholdInviteDTO {
  return {
    id: invite.id,
    status: invite.status as HouseholdInviteDTO["status"],
    inviter: invite.inviter,
    inviteeEmail: invite.inviteeEmail,
    createdAt: invite.createdAt.toISOString(),
  };
}

export async function getHouseholdState(scope: Scope): Promise<HouseholdStateDTO> {
  const [members, invitesReceived, invitesSent] = await Promise.all([
    prisma.user.findMany({
      where: { householdId: scope.householdId },
      select: membroSelect,
      orderBy: { createdAt: "asc" },
    }),
    prisma.householdInvite.findMany({
      where: { inviteeId: scope.userId, status: "PENDING" },
      include: conviteInclude,
      orderBy: { createdAt: "desc" },
    }),
    prisma.householdInvite.findMany({
      where: { householdId: scope.householdId, status: "PENDING" },
      include: conviteInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    id: scope.householdId,
    members,
    invitesReceived: invitesReceived.map(formatInviteDTO),
    invitesSent: invitesSent.map(formatInviteDTO),
  };
}

/**
 * Nao ha e-mail nem push no projeto, e esta feature nao introduz nenhum dos
 * dois: o convite alcanca apenas quem ja tem conta no Poup, e chega pelo
 * sininho.
 */
export async function inviteToHousehold(
  scope: Scope,
  email: string
): Promise<HouseholdInviteDTO> {
  const alvo = email.trim().toLowerCase();

  const convidado = await prisma.user.findFirst({
    where: { email: { equals: alvo, mode: "insensitive" } },
    select: { id: true, householdId: true },
  });
  if (!convidado) {
    throw new ConviteInvalidoError("Não encontramos ninguém com este e-mail no Poup");
  }
  if (convidado.id === scope.userId) {
    throw new ConviteInvalidoError("Não dá para convidar a si mesmo");
  }
  if (convidado.householdId === scope.householdId) {
    throw new ConviteInvalidoError("Esta pessoa já está na sua conta conjunta");
  }

  // Quem ja divide um espaco com outra pessoa precisa sair de la primeiro: a
  // fusao move o espaco inteiro, e mover um espaco povoado levaria junto quem
  // nao foi convidado.
  const membrosDoConvidado = await prisma.user.count({
    where: { householdId: convidado.householdId },
  });
  if (membrosDoConvidado > 1) {
    throw new ConviteInvalidoError("Esta pessoa já faz parte de uma conta conjunta");
  }

  const invite = await prisma.householdInvite.create({
    data: {
      householdId: scope.householdId,
      inviterId: scope.userId,
      inviteeId: convidado.id,
      inviteeEmail: alvo,
    },
    include: conviteInclude,
  });

  await prisma.notification.create({
    data: {
      userId: convidado.id,
      title: "Convite para conta conjunta",
      body: `${invite.inviter.name} quer dividir a visão financeira com você. Toque para ver o convite.`,
      link: LINK_CONJUNTA,
    },
  });

  return formatInviteDTO(invite);
}

export async function declineInvite(scope: Scope, inviteId: string) {
  const invite = await prisma.householdInvite.findFirst({
    where: { id: inviteId, inviteeId: scope.userId, status: "PENDING" },
    include: conviteInclude,
  });
  if (!invite) throw new ConviteNaoEncontradoError();

  await prisma.householdInvite.update({
    where: { id: inviteId },
    data: { status: "DECLINED", respondedAt: new Date() },
  });

  await prisma.notification.create({
    data: {
      userId: invite.inviterId,
      title: "Convite recusado",
      body: `${invite.inviteeEmail} não aceitou o convite para a conta conjunta.`,
      link: LINK_CONJUNTA,
    },
  });

  return { success: true } as const;
}

/** Cancelar e do lado de quem enviou — qualquer membro do espaco que enviou. */
export async function cancelInvite(scope: Scope, inviteId: string) {
  const invite = await prisma.householdInvite.findFirst({
    where: { id: inviteId, householdId: scope.householdId, status: "PENDING" },
  });
  if (!invite) throw new ConviteNaoEncontradoError();

  await prisma.householdInvite.update({
    where: { id: inviteId },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });

  return { success: true } as const;
}
```

O `mode: "insensitive"` do Prisma vale para Postgres e é o que faz o teste do Step 1 passar.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- convite`
Expected: PASS (5 testes)

- [ ] **Step 6: As rotas**

Criar `apps/api/src/modules/household/household.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { withScope } from "../../middleware/withScope";
import { asyncHandler } from "../../middleware/errorHandler";
import {
  getHouseholdState,
  inviteToHousehold,
  declineInvite,
  cancelInvite,
} from "./household.service";

export const householdRouter = Router();

householdRouter.use(requireAuth);
householdRouter.use(withScope);

const inviteSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido"),
});

householdRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ household: await getHouseholdState(req.scope!) });
  })
);

householdRouter.post(
  "/invites",
  asyncHandler(async (req, res) => {
    const { email } = inviteSchema.parse(req.body);
    const invite = await inviteToHousehold(req.scope!, email);
    res.status(201).json({ invite });
  })
);

householdRouter.post(
  "/invites/:id/decline",
  asyncHandler(async (req, res) => {
    res.json(await declineInvite(req.scope!, req.params.id));
  })
);

householdRouter.delete(
  "/invites/:id",
  asyncHandler(async (req, res) => {
    res.json(await cancelInvite(req.scope!, req.params.id));
  })
);
```

`POST /invites/:id/accept` e `POST /leave` entram na Task 14.

Em `apps/api/src/app.ts`, importar e montar junto dos outros:

```ts
apiRouter.use("/household", householdRouter);
```

Confira como as outras rotas validam com `zod` neste projeto antes de escrever a sua — siga o padrão que estiver lá.

- [ ] **Step 7: `fetchMe` devolve o espaço**

Em `auth.service.ts`, `toUserDTO` passa a receber o estado do espaço. Como ele hoje recebe só o registro do usuário, o caminho mais simples é `getUserById` e `login` chamarem `getHouseholdState` depois de resolver o escopo:

```ts
export async function getUserById(userId: string): Promise<UserDTO | null> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  const scope = await resolveScope(userId);
  return { ...toUserDTO(user), household: await getHouseholdState(scope) };
}
```

Faça o mesmo em `login`, `register` e `updateProfile` — todo caminho que devolve `UserDTO` precisa do campo, e o tsc aponta os que faltarem.

- [ ] **Step 8: Compilar e testar**

Run: `npm run build --workspace=apps/api && npm test --workspace=apps/api`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/household apps/api/src/lib/errors.ts apps/api/src/app.ts apps/api/src/modules/auth
git commit -m "feat(api): convite para conta conjunta, entregue pelo sininho"
```

### Task 12: A seção do perfil

**Files:**
- Create: `apps/web/src/components/profile/ContaConjuntaSection.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `HouseholdStateDTO`, `HouseholdInviteDTO`, `HouseholdMemberDTO` (Task 10); rotas da Task 11
- Produces: `fetchHousehold()`, `sendHouseholdInvite(email)`, `declineHouseholdInvite(id)`, `cancelHouseholdInvite(id)` em `api.ts`; `<ContaConjuntaSection />`

- [ ] **Step 1: As funções de API**

Em `apps/web/src/lib/api.ts`, no fim, seguindo o padrão das outras seções:

```ts
// ==========================================
// CONTA CONJUNTA
// ==========================================
export async function fetchHousehold(): Promise<HouseholdStateDTO> {
  const res = await request<{ household: HouseholdStateDTO }>("/household");
  return res.household;
}

export async function sendHouseholdInvite(email: string): Promise<HouseholdInviteDTO> {
  const res = await request<{ invite: HouseholdInviteDTO }>("/household/invites", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  return res.invite;
}

export async function declineHouseholdInvite(id: string): Promise<void> {
  await request(`/household/invites/${id}/decline`, { method: "POST" });
}

export async function cancelHouseholdInvite(id: string): Promise<void> {
  await request(`/household/invites/${id}`, { method: "DELETE" });
}
```

Acrescentar `HouseholdStateDTO` e `HouseholdInviteDTO` ao `import type` do topo do arquivo.

- [ ] **Step 2: O componente**

Criar `apps/web/src/components/profile/ContaConjuntaSection.tsx`. Leia antes uma seção existente do `ProfilePage.tsx` e reuse os mesmos `Card`, `Button`, `Input`, `Field` e o `useToast` que a página já usa — não invente estilo novo.

Estados a cobrir, nesta ordem de precedência:

1. **Convite recebido pendente** (`household.invitesReceived[0]`) — `UserAvatar` e nome de quem convidou, uma frase dizendo o que acontece ("as categorias e orçamentos de vocês dois viram um conjunto só; as de mesmo nome são fundidas"), e os botões **Aceitar** e **Recusar**. Aceitar fica `disabled` até a Task 14; deixe o `onClick` chamando um `TODO`-free `onAccept` que a Task 14 liga.
2. **Espaço com mais de um membro** — a lista de membros com `UserAvatar size="sm"` e nome, e o botão **Sair da conta conjunta** (que a Task 14 liga).
3. **Convite enviado pendente** — para quem (o `inviteeEmail`), e **Cancelar**.
4. **Sozinho** — uma linha de explicação e o campo de e-mail com o botão **Convidar**.

O erro do servidor vem em `ApiError.field === "email"`; acenda-o no campo, como os outros formulários do perfil fazem, e não num alerta no topo.

A seção precisa da âncora que a notificação usa:

```tsx
<section id="conjunta" className="scroll-mt-20">
```

- [ ] **Step 3: Montar no `ProfilePage`**

Importar e renderizar `<ContaConjuntaSection household={user.household} onChanged={recarregarUsuario} />` entre as seções que já existem. `onChanged` deve refazer o `fetchMe` para que `user.household` fique atual — o `ProfilePage` já recebe `onUserUpdated`, use-o.

- [ ] **Step 4: Verificar no navegador**

Suba o app e confira os quatro estados. Para ver o convite chegando, use a segunda conta que já existe no banco compartilhado.

```bash
npm run dev
```

- Convide o e-mail da outra conta pelo perfil.
- Faça login como ela: o sininho tem "Convite para conta conjunta", e tocar leva a `/perfil#conjunta` com a seção à vista.
- Recuse; a primeira conta recebe "Convite recusado".
- Convide de novo e cancele do lado de quem enviou.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/profile/ContaConjuntaSection.tsx apps/web/src/lib/api.ts apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): a secao de conta conjunta no perfil"
```

---

## Fase 4 — fusão e dissolução

### Task 13: `normalizeCategoryName`

**Files:**
- Create: `apps/api/src/modules/household/normalizeCategoryName.ts`
- Create: `apps/api/src/modules/household/normalizeCategoryName.test.ts`

**Interfaces:**
- Produces: `normalizeCategoryName(raw: string): string`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { describe, expect, it } from "vitest";
import { normalizeCategoryName } from "./normalizeCategoryName";

describe("normalizeCategoryName", () => {
  it("ignora acento e caixa", () => {
    expect(normalizeCategoryName("Saúde")).toBe(normalizeCategoryName("saude"));
  });

  it("ignora espaço nas pontas e espaço repetido", () => {
    expect(normalizeCategoryName("  Casa   e   Jardim ")).toBe("casa e jardim");
  });

  /**
   * O motivo de esta função existir em vez de reusar a `normalizeDescription`
   * da categorização: aquela derruba stopwords de extrato — "conta",
   * "pagamento", "cartao" —, que em nome de categoria são o conteúdo inteiro.
   */
  it("preserva palavras que a normalização de extrato derruba", () => {
    expect(normalizeCategoryName("Conta de Luz")).toBe("conta de luz");
    expect(normalizeCategoryName("Pagamento de fatura")).toBe("pagamento de fatura");
  });

  it("não funde nomes que só se parecem", () => {
    expect(normalizeCategoryName("Mercado")).not.toBe(normalizeCategoryName("Mercadinho"));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- normalizeCategoryName`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

```ts
/**
 * O nome de categoria reduzido ao que serve para dizer "e a mesma coisa".
 *
 * Deliberadamente mais tímida que a `normalizeDescription` da categorizacao:
 * aquela derruba stopwords de extrato, e "Conta de Luz" viraria "luz". Aqui o
 * unico ruido e acento, caixa e espaco.
 */
export function normalizeCategoryName(raw: string): string {
  return raw
    .normalize("NFD")
    // A faixa combinante do Unicode, escrita por codigo pela mesma razao que em
    // `lib/categorization/normalize.ts`: para o arquivo nao depender de como o
    // editor salva um acento solto.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- normalizeCategoryName`
Expected: PASS (4 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/household/normalizeCategoryName.ts apps/api/src/modules/household/normalizeCategoryName.test.ts
git commit -m "feat(api): normalizacao de nome de categoria para a fusao"
```

### Task 14: A fusão

**Files:**
- Create: `apps/api/src/modules/household/merge.ts`
- Create: `apps/api/src/modules/household/merge.test.ts`
- Modify: `apps/api/src/modules/household/household.service.ts`
- Modify: `apps/api/src/modules/household/household.routes.ts`

**Interfaces:**
- Consumes: `normalizeCategoryName` (Task 13)
- Produces:
  - `mergeHouseholds(tx: Prisma.TransactionClient, origemId: string, destinoId: string): Promise<void>`
  - `acceptInvite(scope: Scope, inviteId: string): Promise<HouseholdStateDTO>` em `household.service.ts`

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/src/modules/household/merge.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { mergeHouseholds } from "./merge";

const categoryFindMany = vi.fn();
const categoryUpdate = vi.fn();
const categoryDelete = vi.fn();
const transactionUpdateMany = vi.fn();
const suggestionUpdateMany = vi.fn();
const budgetFindMany = vi.fn();
const budgetUpdate = vi.fn();
const budgetDelete = vi.fn();
const goalUpdateMany = vi.fn();

function tx() {
  return {
    category: { findMany: categoryFindMany, update: categoryUpdate, delete: categoryDelete },
    transaction: { updateMany: transactionUpdateMany },
    categorySuggestion: { updateMany: suggestionUpdateMany },
    budget: { findMany: budgetFindMany, update: budgetUpdate, delete: budgetDelete },
    goal: { updateMany: goalUpdateMany },
  } as any;
}

const cat = (over: Partial<Record<string, unknown>>) => ({
  id: "c",
  householdId: "destino",
  name: "Mercado",
  systemKey: null,
  ...over,
});

beforeEach(() => {
  [
    categoryFindMany, categoryUpdate, categoryDelete, transactionUpdateMany,
    suggestionUpdateMany, budgetFindMany, budgetUpdate, budgetDelete, goalUpdateMany,
  ].forEach((m) => m.mockReset());
  budgetFindMany.mockResolvedValue([]);
  goalUpdateMany.mockResolvedValue({ count: 0 });
});

describe("fusão de espaços", () => {
  it("funde homônimos e remapeia as transações do que foi absorvido", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado", name: "Mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem", name: "  mercádo " })]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "o-mercado" },
      data: { categoryId: "d-mercado" },
    });
    expect(categoryDelete).toHaveBeenCalledWith({ where: { id: "o-mercado" } });
  });

  it("remapeia as duas colunas de categoria da sugestão", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem" })]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "o-mercado" },
      data: { categoryId: "d-mercado" },
    });
    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { resolvedCategoryId: "o-mercado" },
      data: { resolvedCategoryId: "d-mercado" },
    });
  });

  it("casa as categorias de sistema pela chave, mesmo renomeadas", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-sem", name: "Sem categoria", systemKey: "UNCATEGORIZED" })])
      .mockResolvedValueOnce([
        cat({ id: "o-sem", householdId: "origem", name: "A classificar", systemKey: "UNCATEGORIZED" }),
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "o-sem" },
      data: { categoryId: "d-sem" },
    });
  });

  it("move inteira a categoria que não tem par", async () => {
    categoryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cat({ id: "o-pet", householdId: "origem", name: "Pet" })]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: "o-pet" },
      data: { householdId: "destino", name: "Pet" },
    });
    expect(categoryDelete).not.toHaveBeenCalled();
  });

  it("desempata nome que colide sem ter casado", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-sem", name: "Sem categoria", systemKey: "UNCATEGORIZED" })])
      .mockResolvedValueOnce([
        cat({ id: "o-sem", householdId: "origem", name: "Sem categoria", systemKey: null }),
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: "o-sem" },
      data: { householdId: "destino", name: "Sem categoria (2)" },
    });
  });

  it("soma os limites quando os dois orçam a mesma categoria", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem" })]);
    budgetFindMany
      .mockResolvedValueOnce([
        { id: "b-d", categoryId: "d-mercado", monthlyLimit: new Prisma.Decimal(800) },
      ])
      .mockResolvedValueOnce([
        { id: "b-o", categoryId: "o-mercado", monthlyLimit: new Prisma.Decimal(400) },
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(budgetUpdate).toHaveBeenCalledWith({
      where: { id: "b-d" },
      data: { monthlyLimit: new Prisma.Decimal(1200) },
    });
    expect(budgetDelete).toHaveBeenCalledWith({ where: { id: "b-o" } });
  });

  it("leva as metas inteiras", async () => {
    categoryFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(goalUpdateMany).toHaveBeenCalledWith({
      where: { householdId: "origem" },
      data: { householdId: "destino" },
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- merge`
Expected: FAIL — `Cannot find module './merge'`.

- [ ] **Step 3: Implementar a fusão**

Criar `apps/api/src/modules/household/merge.ts`:

```ts
import { Prisma } from "@prisma/client";
import { normalizeCategoryName } from "./normalizeCategoryName";

/**
 * Funde o espaco `origemId` no `destinoId`.
 *
 * Roda sempre dentro de um `$transaction` do chamador: metade de uma fusao
 * deixa transacao apontando para categoria de espaco alheio, que e um estado
 * do qual nao ha volta automatica.
 *
 * Nao guarda de-para. Foi decidido assim: a dissolucao devolve a cada um uma
 * copia do conjunto do casal, e nao o conjunto que a pessoa tinha antes.
 */
export async function mergeHouseholds(
  tx: Prisma.TransactionClient,
  origemId: string,
  destinoId: string
): Promise<void> {
  const destino = await tx.category.findMany({ where: { householdId: destinoId } });
  const origem = await tx.category.findMany({ where: { householdId: origemId } });

  const porChave = new Map(
    destino.filter((c) => c.systemKey).map((c) => [c.systemKey as string, c])
  );
  const porNome = new Map(destino.map((c) => [normalizeCategoryName(c.name), c]));
  // Os nomes crus ja ocupados no destino, para o desempate do unique.
  const nomesOcupados = new Set(destino.map((c) => c.name));

  /** Categoria da origem → categoria que passa a valer. */
  const dePara = new Map<string, string>();

  for (const cat of origem) {
    const par =
      (cat.systemKey ? porChave.get(cat.systemKey) : undefined) ??
      porNome.get(normalizeCategoryName(cat.name));

    if (par) {
      // Absorvida: tudo que apontava para ela passa a apontar para o par.
      await tx.transaction.updateMany({
        where: { categoryId: cat.id },
        data: { categoryId: par.id },
      });
      // Sao duas colunas apontando para categoria, e esquecer a segunda deixa a
      // fila de revisao com referencia morta.
      await tx.categorySuggestion.updateMany({
        where: { categoryId: cat.id },
        data: { categoryId: par.id },
      });
      await tx.categorySuggestion.updateMany({
        where: { resolvedCategoryId: cat.id },
        data: { resolvedCategoryId: par.id },
      });
      dePara.set(cat.id, par.id);
      await tx.category.delete({ where: { id: cat.id } });
      continue;
    }

    // Sem par: migra inteira. As transacoes ja apontam para ela, entao nao ha o
    // que remapear — so o nome pode precisar de desempate.
    let nome = cat.name;
    let sufixo = 2;
    while (nomesOcupados.has(nome)) {
      nome = `${cat.name} (${sufixo})`;
      sufixo++;
    }
    nomesOcupados.add(nome);

    await tx.category.update({
      where: { id: cat.id },
      data: { householdId: destinoId, name: nome },
    });
    dePara.set(cat.id, cat.id);
  }

  await fundirOrcamentos(tx, origemId, destinoId, dePara);

  // Meta nao tem nome unico, logo nao ha colisao: vao inteiras.
  await tx.goal.updateMany({
    where: { householdId: origemId },
    data: { householdId: destinoId },
  });
}

/**
 * Dois tetos para a mesma categoria viram um so, somado. E o unico agregado da
 * fusao, e por isso soma em `Decimal`: R$ 0,10 + R$ 0,20 em ponto flutuante nao
 * da R$ 0,30.
 */
async function fundirOrcamentos(
  tx: Prisma.TransactionClient,
  origemId: string,
  destinoId: string,
  dePara: Map<string, string>
): Promise<void> {
  const doDestino = await tx.budget.findMany({ where: { householdId: destinoId } });
  const daOrigem = await tx.budget.findMany({ where: { householdId: origemId } });

  const porCategoria = new Map(doDestino.map((b) => [b.categoryId, b]));

  for (const orcamento of daOrigem) {
    const categoriaFinal = dePara.get(orcamento.categoryId) ?? orcamento.categoryId;
    const existente = porCategoria.get(categoriaFinal);

    if (existente) {
      await tx.budget.update({
        where: { id: existente.id },
        data: {
          monthlyLimit: new Prisma.Decimal(existente.monthlyLimit).plus(
            new Prisma.Decimal(orcamento.monthlyLimit)
          ),
        },
      });
      await tx.budget.delete({ where: { id: orcamento.id } });
      continue;
    }

    await tx.budget.update({
      where: { id: orcamento.id },
      data: { householdId: destinoId, categoryId: categoriaFinal },
    });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- merge`
Expected: PASS (7 testes)

- [ ] **Step 5: Ligar no aceite**

Em `household.service.ts`:

```ts
import { mergeHouseholds } from "./merge";

export async function acceptInvite(
  scope: Scope,
  inviteId: string
): Promise<HouseholdStateDTO> {
  const invite = await prisma.householdInvite.findFirst({
    where: { id: inviteId, inviteeId: scope.userId, status: "PENDING" },
    include: conviteInclude,
  });
  if (!invite) throw new ConviteNaoEncontradoError();

  const membrosDoMeu = await prisma.user.count({
    where: { householdId: scope.householdId },
  });
  if (membrosDoMeu > 1) {
    throw new ConviteInvalidoError(
      "Saia da sua conta conjunta atual antes de aceitar outro convite"
    );
  }

  const origemId = scope.householdId;

  await prisma.$transaction(async (tx) => {
    await mergeHouseholds(tx, origemId, invite.householdId);

    await tx.user.update({
      where: { id: scope.userId },
      data: { householdId: invite.householdId },
    });

    await tx.householdInvite.update({
      where: { id: inviteId },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });

    // Os convites que eu recebi de terceiros vivem sob o `householdId` deles e
    // nao morrem na cascata do espaco que estou deixando. Sem isto eu ficaria
    // com um convite de outra pessoa esperando resposta numa tela que ja nao
    // faz sentido.
    await tx.householdInvite.updateMany({
      where: { inviteeId: scope.userId, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });

    // O espaco que esvaziei. A cascata leva junto os convites que ele enviou.
    await tx.household.delete({ where: { id: origemId } });

    await tx.notification.create({
      data: {
        userId: invite.inviterId,
        title: "Convite aceito",
        body: `${invite.inviteeEmail} entrou na sua conta conjunta. As categorias e orçamentos de vocês agora são um conjunto só.`,
        link: LINK_CONJUNTA,
      },
    });
  });

  return getHouseholdState(await resolveScope(scope.userId));
}
```

Importar `resolveScope` de `../../lib/scope`.

- [ ] **Step 6: A rota**

Em `household.routes.ts`:

```ts
householdRouter.post(
  "/invites/:id/accept",
  asyncHandler(async (req, res) => {
    const household = await acceptInvite(req.scope!, req.params.id);
    res.json({ household });
  })
);
```

- [ ] **Step 7: Compilar e testar**

Run: `npm run build --workspace=apps/api && npm test --workspace=apps/api`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/household
git commit -m "feat(api): aceitar o convite funde os dois espacos"
```

### Task 15: A dissolução

**Files:**
- Create: `apps/api/src/modules/household/split.ts`
- Create: `apps/api/src/modules/household/split.test.ts`
- Modify: `apps/api/src/modules/household/household.service.ts`
- Modify: `apps/api/src/modules/household/household.routes.ts`

**Interfaces:**
- Produces:
  - `splitHousehold(tx: Prisma.TransactionClient, householdId: string): Promise<void>`
  - `leaveHousehold(scope: Scope): Promise<HouseholdStateDTO>`

- [ ] **Step 1: Escrever os testes que falham**

Criar `apps/api/src/modules/household/split.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { splitHousehold } from "./split";

const userFindMany = vi.fn();
const userUpdate = vi.fn();
const householdCreate = vi.fn();
const householdDelete = vi.fn();
const categoryFindMany = vi.fn();
const categoryCreate = vi.fn();
const transactionUpdateMany = vi.fn();
const suggestionUpdateMany = vi.fn();
const budgetFindMany = vi.fn();
const budgetCreate = vi.fn();
const goalUpdateMany = vi.fn();

function tx() {
  return {
    user: { findMany: userFindMany, update: userUpdate },
    household: { create: householdCreate, delete: householdDelete },
    category: { findMany: categoryFindMany, create: categoryCreate },
    transaction: { updateMany: transactionUpdateMany },
    categorySuggestion: { updateMany: suggestionUpdateMany },
    budget: { findMany: budgetFindMany, create: budgetCreate },
    goal: { updateMany: goalUpdateMany },
  } as any;
}

beforeEach(() => {
  [
    userFindMany, userUpdate, householdCreate, householdDelete, categoryFindMany,
    categoryCreate, transactionUpdateMany, suggestionUpdateMany, budgetFindMany,
    budgetCreate, goalUpdateMany,
  ].forEach((m) => m.mockReset());

  userFindMany.mockResolvedValue([{ id: "ana" }, { id: "bento" }]);
  categoryFindMany.mockResolvedValue([
    { id: "c-mercado", name: "Mercado", icon: "cart", colorKey: "4", kind: "VARIABLE", systemKey: null },
  ]);
  budgetFindMany.mockResolvedValue([]);
  goalUpdateMany.mockResolvedValue({ count: 0 });

  let n = 0;
  householdCreate.mockImplementation(async () => ({ id: `novo-${++n}` }));
  let c = 0;
  categoryCreate.mockImplementation(async ({ data }: any) => ({ ...data, id: `copia-${++c}` }));
});

describe("dissolução do espaço", () => {
  it("dá um espaço novo a cada membro", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(householdCreate).toHaveBeenCalledTimes(2);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "ana" },
      data: { householdId: "novo-1" },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "bento" },
      data: { householdId: "novo-2" },
    });
  });

  it("copia as categorias para cada um", async () => {
    await splitHousehold(tx(), "casa-1");
    expect(categoryCreate).toHaveBeenCalledTimes(2);
  });

  /** O ponto da dissolução: ninguém fica apontando para categoria de outro. */
  it("religa as transações de cada membro à cópia dele", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "ana", categoryId: "c-mercado" },
      data: { categoryId: "copia-1" },
    });
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "bento", categoryId: "c-mercado" },
      data: { categoryId: "copia-2" },
    });
  });

  it("religa as duas colunas de categoria da sugestão", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "ana", categoryId: "c-mercado" },
      data: { categoryId: "copia-1" },
    });
    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "ana", resolvedCategoryId: "c-mercado" },
      data: { resolvedCategoryId: "copia-1" },
    });
  });

  it("a meta vai para quem a criou", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(goalUpdateMany).toHaveBeenCalledWith({
      where: { householdId: "casa-1", createdByUserId: "ana" },
      data: { householdId: "novo-1" },
    });
  });

  it("apaga o espaço esvaziado no fim", async () => {
    await splitHousehold(tx(), "casa-1");
    expect(householdDelete).toHaveBeenCalledWith({ where: { id: "casa-1" } });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- split`
Expected: FAIL

- [ ] **Step 3: Implementar**

Criar `apps/api/src/modules/household/split.ts`:

```ts
import { Prisma } from "@prisma/client";

/**
 * Dissolve o espaco: cada membro sai com uma copia do conjunto do casal, e as
 * proprias transacoes religadas a ela.
 *
 * Simetrica de proposito. Com dois membros, "um sai e o outro fica" e "os dois
 * se separam" sao o mesmo caso, e tratar os dois como um so evita o desenho
 * assimetrico em que o espaco e secretamente de um deles.
 *
 * Como a fusao, roda dentro de um `$transaction` do chamador.
 */
export async function splitHousehold(
  tx: Prisma.TransactionClient,
  householdId: string
): Promise<void> {
  const membros = await tx.user.findMany({
    where: { householdId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const categorias = await tx.category.findMany({ where: { householdId } });
  const orcamentos = await tx.budget.findMany({ where: { householdId } });

  for (const membro of membros) {
    const novo = await tx.household.create({ data: {} });

    /** Categoria do casal → a copia deste membro. */
    const dePara = new Map<string, string>();

    for (const cat of categorias) {
      const copia = await tx.category.create({
        data: {
          householdId: novo.id,
          name: cat.name,
          icon: cat.icon,
          colorKey: cat.colorKey,
          kind: cat.kind,
          systemKey: cat.systemKey,
        },
      });
      dePara.set(cat.id, copia.id);

      await tx.transaction.updateMany({
        where: { userId: membro.id, categoryId: cat.id },
        data: { categoryId: copia.id },
      });
      await tx.categorySuggestion.updateMany({
        where: { userId: membro.id, categoryId: cat.id },
        data: { categoryId: copia.id },
      });
      await tx.categorySuggestion.updateMany({
        where: { userId: membro.id, resolvedCategoryId: cat.id },
        data: { resolvedCategoryId: copia.id },
      });
    }

    // O teto do casal vale inteiro para cada um. Foi a escolha de "copia
    // identica" — dividir por dois seria inventar uma regra que ninguem pediu —,
    // e a tela avisa disso antes de confirmar.
    for (const orcamento of orcamentos) {
      const categoriaCopiada = dePara.get(orcamento.categoryId);
      if (!categoriaCopiada) continue;
      await tx.budget.create({
        data: {
          householdId: novo.id,
          categoryId: categoriaCopiada,
          monthlyLimit: new Prisma.Decimal(orcamento.monthlyLimit),
        },
      });
    }

    // Meta e de quem a criou; nao se copia para os dois.
    await tx.goal.updateMany({
      where: { householdId, createdByUserId: membro.id },
      data: { householdId: novo.id },
    });

    await tx.user.update({
      where: { id: membro.id },
      data: { householdId: novo.id },
    });
  }

  // Esvaziado: as categorias e orcamentos que sobraram aqui sao os originais, e
  // a cascata os leva junto. As transacoes ja apontam para as copias.
  await tx.household.delete({ where: { id: householdId } });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- split`
Expected: PASS (6 testes)

- [ ] **Step 5: Ligar na saída**

Em `household.service.ts`:

```ts
import { splitHousehold } from "./split";
import { UnprocessableError } from "../../lib/errors";

export async function leaveHousehold(scope: Scope): Promise<HouseholdStateDTO> {
  if (scope.memberIds.length < 2) {
    // Nao ha de quem se separar, e dissolver aqui seria trocar o espaco por
    // outro identico: trabalho e risco por nada.
    throw new UnprocessableError("Você não está numa conta conjunta");
  }

  const antigo = scope.householdId;
  const outros = scope.memberIds.filter((id) => id !== scope.userId);

  await prisma.$transaction(async (tx) => {
    await splitHousehold(tx, antigo);

    for (const membroId of [...outros, scope.userId]) {
      await tx.notification.create({
        data: {
          userId: membroId,
          title: "Conta conjunta desfeita",
          body: "Cada um voltou a ter as próprias categorias, orçamentos e metas, com o histórico preservado.",
          link: LINK_CONJUNTA,
        },
      });
    }
  });

  return getHouseholdState(await resolveScope(scope.userId));
}
```

- [ ] **Step 6: A rota**

```ts
householdRouter.post(
  "/leave",
  asyncHandler(async (req, res) => {
    const household = await leaveHousehold(req.scope!);
    res.json({ household });
  })
);
```

- [ ] **Step 7: Ligar as duas pontas na web**

Em `apps/web/src/lib/api.ts`:

```ts
export async function acceptHouseholdInvite(id: string): Promise<HouseholdStateDTO> {
  const res = await request<{ household: HouseholdStateDTO }>(
    `/household/invites/${id}/accept`,
    { method: "POST" }
  );
  return res.household;
}

export async function leaveHousehold(): Promise<HouseholdStateDTO> {
  const res = await request<{ household: HouseholdStateDTO }>("/household/leave", {
    method: "POST",
  });
  return res.household;
}
```

No `ContaConjuntaSection.tsx`, ligar o botão **Aceitar** (que estava `disabled`) e o **Sair da conta conjunta**. A saída passa pelo `ConfirmDialog` que a página já usa, com o texto:

> Cada um fica com uma cópia das categorias, orçamentos e metas, e o histórico de vocês continua inteiro. O limite de cada orçamento vale integralmente para os dois.

Depois de aceitar ou sair, chame `fetchMe()` e propague com `onUserUpdated` — o `user.household` alimenta o filtro por pessoa da Fase 5.

- [ ] **Step 8: Provar na mão, com as duas contas reais**

```bash
npm run dev
```

1. Anote antes: quantas categorias cada conta tem, e o total do mês em Relatórios.
2. Convide e aceite.
3. Confira: uma lista de categorias sem homônimo repetido; o Dashboard somando os dois; Relatórios com o total das duas contas; a fila de revisão com as pendências dos dois.
4. Saia pela conta conjunta.
5. Confira: cada conta com a lista de categorias completa, nenhuma transação em "Sem categoria" que não estivesse lá antes, e o total do mês de cada uma igual ao do passo 1.

O passo 5 é o critério de aceite da fase: **a dissolução não pode perder categorização.**

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/household apps/web/src/lib/api.ts apps/web/src/components/profile/ContaConjuntaSection.tsx
git commit -m "feat: sair da conta conjunta dissolve o espaco e cada um leva uma copia"
```

---

## Fase 5 — o filtro por pessoa

### Task 16: O dono na transação

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/modules/transactions/transactions.service.ts`

**Interfaces:**
- Produces: `TransactionDTO.ownerUserId: string`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `apps/api/src/modules/transactions/nomeDaConta.test.ts` (o arquivo da Task 1, que já monta a transação):

```ts
it("carrega o dono, que é quem o filtro por pessoa usa", () => {
  const dto = formatTransactionDTO({
    ...transacaoCom({ name: "Nubank", customName: null }),
    userId: "bento",
  });
  expect(dto.ownerUserId).toBe("bento");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- nomeDaConta`
Expected: FAIL

- [ ] **Step 3: Acrescentar o campo**

Em `packages/shared/src/index.ts`, dentro de `TransactionDTO`:

```ts
  /**
   * De quem é o dinheiro. Só faz diferença em conta conjunta, e é o que a tela
   * cruza com os membros do espaço para desenhar o avatar do dono — a API não
   * repete nome e foto em cada linha.
   */
  ownerUserId: string;
```

Em `transactions.service.ts`, acrescentar `userId: string` ao tipo do parâmetro de `formatTransactionDTO` e `ownerUserId: tx.userId` ao objeto devolvido. As consultas já trazem `userId` — é coluna da tabela, e o `TX_INCLUDE` não a exclui.

- [ ] **Step 4: Rodar e compilar**

Run: `npm run build:shared && npm test --workspace=apps/api && npm run build --workspace=apps/api`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/modules/transactions
git commit -m "feat(shared): a transacao carrega o dono"
```

### Task 17: O `OwnerFilter` e o avatar na lista

**Files:**
- Create: `apps/web/src/components/ui/OwnerFilter.tsx`
- Modify: `apps/web/src/pages/TransactionsPage.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx`
- Modify: `apps/web/src/pages/ReportsPage.tsx`
- Modify: `apps/web/src/components/transactions/TransactionDetailModal.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `packages/shared/src/index.ts` (`TransactionFilterQuery`, `ReportQuery`)

**Interfaces:**
- Consumes: `HouseholdMemberDTO` (Task 10), `TransactionDTO.ownerUserId` (Task 16), `useCurrentUser()` de `apps/web/src/hooks/useCurrentUser.ts`
- Produces: `<OwnerFilter members value onChange />`

- [ ] **Step 1: O componente**

Criar `apps/web/src/components/ui/OwnerFilter.tsx`. É o mesmo `Select` com `renderOption` que o filtro de contas usa para desenhar a `InstitutionLogo` (`TransactionsPage.tsx:298`), trocando-a pelo `UserAvatar`:

```tsx
import { useMemo } from "react";
import type { HouseholdMemberDTO } from "@poup/shared";
import { Select } from "./Select";
import { UserAvatar } from "./UserAvatar";

export interface OwnerFilterProps {
  members: HouseholdMemberDTO[];
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}

/** O primeiro nome basta na opção, e é o que cabe no seletor do mobile. */
function primeiroNome(nome: string): string {
  return nome.split(" ")[0] || nome;
}

/**
 * "Todos / Fulano / Beltrano", com a foto de cada um.
 *
 * Some quando o espaço tem um membro só: ali seria um seletor de uma opção. É o
 * próprio componente que decide isso, e não cada uma das três telas.
 */
export function OwnerFilter({ members, value, onChange, size = "md" }: OwnerFilterProps) {
  const options = useMemo(
    () => [
      { value: "all", label: "Todos" },
      ...members.map((m) => ({ value: m.id, label: primeiroNome(m.name) })),
    ],
    [members]
  );

  const porId = useMemo(() => {
    const map: Record<string, HouseholdMemberDTO> = {};
    for (const m of members) map[m.id] = m;
    return map;
  }, [members]);

  if (members.length < 2) return null;

  return (
    <Select
      size={size}
      value={value}
      onChange={onChange}
      options={options}
      aria-label="Pessoa"
      renderOption={(opt) => {
        const membro = porId[opt.value];
        if (!membro) return <span className="truncate">{opt.label}</span>;
        return (
          <span className="flex items-center gap-2 min-w-0">
            <UserAvatar size="xs" name={membro.name} avatarUrl={membro.avatarUrl} />
            <span className="truncate">{opt.label}</span>
          </span>
        );
      }}
    />
  );
}
```

- [ ] **Step 2: O parâmetro nas queries partilhadas**

Em `packages/shared/src/index.ts`, acrescentar a `TransactionFilterQuery` e a `ReportQuery`:

```ts
  /** Restringe a leitura a um membro do espaço. Ausente ou "all" soma todos. */
  owner?: string;
```

`fetchTransactions` já repassa toda chave da query como parâmetro, então não precisa mudar. Confira o mesmo em `fetchReportSummary` e, se ele montar os parâmetros à mão, acrescente `owner`.

- [ ] **Step 3: Ligar em Transações**

Em `apps/web/src/pages/TransactionsPage.tsx`:

```tsx
import { useCurrentUser } from "../hooks/useCurrentUser";
import { OwnerFilter } from "../components/ui/OwnerFilter";
```

```tsx
  const user = useCurrentUser();
  const membros = user.household.members;
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
```

Acrescentar `owner: ownerFilter === "all" ? undefined : ownerFilter` ao objeto passado a `fetchTransactions`, e `ownerFilter` ao array de dependências do `useEffect` que recarrega (junto de `typeFilter`, `categoryFilter`, `accountFilter`).

Pôr `<OwnerFilter members={membros} value={ownerFilter} onChange={setOwnerFilter} />` ao lado do `accountSelect`, dentro da folha do mobile e do popover do desktop — os dois usam a mesma variável. Ele se esconde sozinho quando há um membro só.

Somar ao `hasActiveFilters` e ao `sheetFilterCount`:

```tsx
  const hasActiveFilters =
    // ... o que já estava
    ownerFilter !== "all" ||
```

```tsx
  const sheetFilterCount =
    [typeFilter, categoryFilter, accountFilter].filter((f) => f !== "ALL").length +
    (ownerFilter !== "all" ? 1 : 0) +
    (hasDateFilter ? 1 : 0) +
    (hasAmountFilter ? 1 : 0);
```

E em `clearSelectFilters`, `setOwnerFilter("all")`.

- [ ] **Step 4: O avatar do dono na linha**

Nas duas larguras da grid (`TransactionsPage.tsx:756` e `:855`, onde hoje está `{tx.accountName || "Principal"}`), acrescentar o avatar antes do nome da conta, só quando há mais de um membro:

```tsx
{membros.length > 1 && (() => {
  const dono = membros.find((m) => m.id === tx.ownerUserId);
  return dono ? (
    <UserAvatar size="xs" name={dono.name} avatarUrl={dono.avatarUrl} className="mr-1.5" />
  ) : null;
})()}
```

E o mesmo em `TransactionDetailModal.tsx:249`, ao lado de `transaction.accountName`. O modal recebe os membros por prop de quem o abre, ou chame `useCurrentUser()` dentro dele se ele estiver sob o `AppLayout` — verifique qual dos dois vale antes de escrever.

- [ ] **Step 5: Ligar em Dashboard e Relatórios**

Mesmo padrão: `useCurrentUser()`, um `useState` de `ownerFilter`, o `<OwnerFilter />` no cabeçalho da página, `owner` na chamada da API e no array de dependências do efeito que recarrega.

- [ ] **Step 6: Verificar no navegador**

```bash
npm run dev
```

- Com uma conta sozinha: **nenhum** seletor de pessoa em nenhuma das três telas, e nenhum avatar na grid. Nada pode ter mudado de aparência.
- Com a conta conjunta ativa: o seletor aparece com as duas fotos; escolher um dos dois muda os totais do Dashboard, a lista de Transações e os gráficos de Relatórios; a grid mostra de quem é cada linha.
- Trocar o filtro no mobile e conferir que a folha de filtros conta o filtro de pessoa no badge.

- [ ] **Step 7: Rodar tudo e commitar**

Run: `npm run build && npm test --workspace=apps/api && npm test --workspace=apps/web`
Expected: PASS

```bash
git add apps/web packages/shared
git commit -m "feat(web): filtro por pessoa com foto, e o dono na linha da transacao"
```

### Task 18: Documentação

**Files:**
- Modify: `docs/PLAN.md`
- Modify: `README.md`

- [ ] **Step 1: Registrar no `PLAN.md`**

Na seção "O que está pronto", acrescentar em Backend e Frontend as linhas da conta conjunta: o `Household` como dono de categoria/orçamento/meta, o `Scope` por requisição, o convite pelo sininho, a fusão no aceite, a dissolução na saída e o filtro por pessoa.

Na seção "Backlog", acrescentar o que ficou de fora: convite para quem ainda não é usuário, mais de dois membros na interface, divisão de despesa entre os dois, e papéis graduados.

- [ ] **Step 2: Uma linha no `README.md`**

Na descrição do topo, depois de "mostra para onde o dinheiro foi", acrescentar que duas pessoas podem dividir a visão financeira num espaço conjunto.

- [ ] **Step 3: Commit**

```bash
git add docs/PLAN.md README.md
git commit -m "docs: registra a conta conjunta no plano e no README"
```

---

## Autorrevisão do plano

Feita antes de entregar. O que a passagem encontrou e como ficou:

- **Cobertura do spec.** Cada seção tem tarefa: posse (2), escopo (3-4), filtro e o 403 (3, 17), fusão (13-14), dissolução (15), permissões (8-9), convite e notificação (11-12), telas (12, 17), palpite conjunto (9), notificações em espaço conjunto (9), correção do nome da conta (1), fora de escopo (18, no backlog).
- **Ordem das notificações.** A seção de notificações do spec estava sendo implementada só na Task 9, mas `createReviewNotification` é chamada pelo sync, que a Task 9 também toca — ficaram juntas de propósito, no mesmo commit.
- **`ensureSystemCategories` tem três chamadores** fora de `categories.service` (`reports.service`, `categorization.service`, `pluggy.service`). A Task 5 muda a assinatura e as Tasks 8 e 9 consertam os chamadores; o intervalo entre elas não compila, e o plano diz isso explicitamente na Task 2, Step 6.
- **Consistência de nomes:** `Scope`/`resolveScope`/`ownerIds` (Task 3) são usados com esses nomes nas Tasks 4-9 e 11; `mergeHouseholds(tx, origemId, destinoId)` (14) e `splitHousehold(tx, householdId)` (15) batem com as chamadas em `acceptInvite` e `leaveHousehold`; `normalizeCategoryName` (13) é consumida só pela 14; `HouseholdStateDTO` (10) é o retorno de `getHouseholdState`, `acceptInvite` e `leaveHousehold`.
- **Um ponto que o executor precisa checar no lugar, e o plano manda checar:** a assinatura real de `listTransactions` (Task 8, Step 2) e como o `TransactionDetailModal` recebe contexto (Task 17, Step 4). Os dois arquivos são grandes e o plano não os transcreve inteiros.
