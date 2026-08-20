# Categorização sugerida — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a auto-categorização silenciosa do sync por um fluxo em que o app sugere e o usuário aprova, com toda transação sempre categorizada e transferências entre contas do próprio usuário resolvidas sozinhas.

**Architecture:** Três categorias de sistema por usuário (linhas reais em `Category`, marcadas por `systemKey`) garantem que `categoryId` nunca fique nulo. Um pipeline pós-importação pareia transferências internas, joga o resto nas ocultas de "sem categoria" e grava sugestões pendentes numa tabela nova (`CategorySuggestion`). O motor de palpite é código puro em `src/lib/categorization/`, testado com vitest; a persistência e as rotas ficam num módulo novo `src/modules/categorization/`.

**Tech Stack:** Node + Express + Prisma 5 + PostgreSQL (Neon) na API; React 18 + Vite + Tailwind + react-router no web; tipos compartilhados em `packages/shared`; vitest (novo neste repositório) só para a lib de categorização.

**Spec:** `docs/superpowers/specs/2026-08-20-categorizacao-sugerida-design.md`

## Global Constraints

- Idioma de tudo que o usuário lê (rótulos, mensagens de erro, títulos de notificação): **português do Brasil**. Comentários e mensagens de commit também.
- Comentários de código explicam **por que**, não o que — é o padrão de todo o repositório. Não comente o óbvio.
- Nomes exatos das categorias de sistema: `Transferência entre contas`, `Sem categoria (despesa)`, `Sem categoria (receita)`.
- Janela de pareamento de transferência: **3 dias**. Constante `TRANSFER_WINDOW_DAYS`.
- Limiar de similaridade: **0.6**. Constante `SIMILARITY_THRESHOLD`.
- `confidence` fixa: `RULE` = `0.5`, `PLUGGY` = `0.35`. `HISTORY` é calculada.
- `Transaction.categoryId` permanece **nullable no banco**. A invariante é mantida pelo serviço.
- Nenhuma sugestão retroativa: a migração não gera sugestões para o histórico.
- Money continua trafegando como `number` nos DTOs (dívida conhecida do projeto, fora do escopo deste trabalho).
- `npm run build` (raiz) precisa continuar passando ao fim de cada tarefa.

---

## Estrutura de arquivos

**Criar — API**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/lib/categorization/normalize.ts` | Normalizar descrição e extrair chave de comerciante |
| `apps/api/src/lib/categorization/normalize.test.ts` | Testes de normalização |
| `apps/api/src/lib/categorization/similarity.ts` | Score de similaridade entre duas descrições |
| `apps/api/src/lib/categorization/similarity.test.ts` | Testes de similaridade |
| `apps/api/src/lib/categorization/transfers.ts` | Pareamento de transferência interna (puro) |
| `apps/api/src/lib/categorization/transfers.test.ts` | Testes de pareamento |
| `apps/api/src/lib/categorization/engine.ts` | Índice de histórico e escolha do palpite |
| `apps/api/src/lib/categorization/engine.test.ts` | Testes do motor |
| `apps/api/src/lib/systemCategories.ts` | Definição e criação idempotente das categorias de sistema |
| `apps/api/src/modules/categorization/categorization.service.ts` | Pipeline `processNewTransactions` |
| `apps/api/src/modules/categorization/suggestions.service.ts` | Listar, aceitar, pular sugestões |
| `apps/api/src/modules/categorization/suggestions.routes.ts` | Rotas `/api/suggestions` |
| `apps/api/src/modules/categorization/similar.service.ts` | Buscar parecidas e aplicar em massa |
| `apps/api/prisma/migrations/20260820120000_categorizacao_sugerida/migration.sql` | Schema + backfill |

**Criar — Web**

| Arquivo | Responsabilidade |
|---|---|
| `apps/web/src/pages/ReviewPage.tsx` | Tela `/revisao`, uma sugestão por vez |
| `apps/web/src/components/suggestions/SuggestionsButton.tsx` | Botão com contador |
| `apps/web/src/components/transactions/SimilarTransactionsModal.tsx` | Lista de parecidas com checkboxes |
| `apps/web/src/hooks/useSuggestionsCount.ts` | Contagem de pendentes |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `apps/api/prisma/schema.prisma` | `systemKey`, `transferPairId`, `link`, `CategorySuggestion`, enums |
| `apps/api/src/lib/defaultCategories.ts` | Criar também as de sistema |
| `apps/api/src/lib/errors.ts` | `SystemCategoryError`, `SuggestionNotFoundError` |
| `apps/api/src/modules/categories/categories.service.ts` | Guardas de sistema; delete reatribui |
| `apps/api/src/modules/budgets/budgets.service.ts` | Recusar categoria de sistema |
| `apps/api/src/modules/transactions/transactions.service.ts` | Filtro `uncategorized`; criar com oculta; desfazer par |
| `apps/api/src/modules/transactions/transactions.routes.ts` | Rotas `similar` e `bulk-categorize` |
| `apps/api/src/modules/reports/reports.service.ts` | Excluir `TRANSFER`; contar não categorizadas pelas ocultas |
| `apps/api/src/modules/pluggy/pluggy.service.ts` | Detectar linhas novas; chamar o pipeline |
| `apps/api/src/modules/notifications/notifications.service.ts` | `link` no DTO; notificação de revisão |
| `apps/api/src/app.ts` | Montar `suggestionsRouter` |
| `apps/api/tsconfig.json` | Excluir `*.test.ts` do build |
| `apps/api/package.json` | `vitest` + script `test` |
| `packages/shared/src/index.ts` | DTOs novos |
| `apps/web/src/lib/api.ts` | Funções de sugestão, parecidas e massa |
| `apps/web/src/hooks/useCategories.ts` | Separar selecionáveis de todas |
| `apps/web/src/App.tsx` | Rota `/revisao` |
| `apps/web/src/pages/DashboardPage.tsx` | Botão Sugestões |
| `apps/web/src/pages/TransactionsPage.tsx` | Botão Sugestões |
| `apps/web/src/pages/CategoriesPage.tsx` | Esconder de sistema |
| `apps/web/src/components/transactions/TransactionDetailModal.tsx` | Abrir modal de parecidas |
| `apps/web/src/components/notifications/NotificationDrawer.tsx` | Item clicável com `link` |
| `PLAN.md` | Registrar o que passou a existir |

---

## Task 1: Schema, migração e categorias de sistema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260820120000_categorizacao_sugerida/migration.sql`
- Create: `apps/api/src/lib/systemCategories.ts`
- Modify: `apps/api/src/lib/defaultCategories.ts`

**Interfaces:**
- Consumes: nada (primeira tarefa).
- Produces: enums Prisma `SystemCategoryKey`, `SuggestionSource`, `SuggestionStatus`; modelo `CategorySuggestion`; campos `Category.systemKey`, `Transaction.transferPairId`, `Notification.link`; e de `systemCategories.ts`:
  - `SYSTEM_CATEGORY_DEFS: readonly { systemKey: SystemCategoryKey; name: string; icon: string; colorKey: string }[]`
  - `ensureSystemCategories(client, userId): Promise<SystemCategoryIds>`
  - `type SystemCategoryIds = Record<SystemCategoryKey, string>`
  - `uncategorizedKeyFor(type: TransactionType): SystemCategoryKey`

- [ ] **Step 1: Editar o schema**

Em `apps/api/prisma/schema.prisma`, adicione os enums junto dos outros, no topo:

```prisma
enum SystemCategoryKey {
  TRANSFER
  UNCATEGORIZED_EXPENSE
  UNCATEGORIZED_INCOME
}

enum SuggestionSource {
  HISTORY
  RULE
  PLUGGY
}

enum SuggestionStatus {
  PENDING
  ACCEPTED
  CHANGED
  DISMISSED
}
```

Em `model User`, adicione à lista de relações:

```prisma
  categorySuggestions CategorySuggestion[]
```

Substitua `model Category` por:

```prisma
model Category {
  id        String   @id @default(uuid())
  userId    String
  name      String
  icon      String
  colorKey  String
  /// Marca as categorias que o app cria e mantém. Não aparecem em seletores,
  /// não podem ser renomeadas nem excluídas, e não aceitam orçamento. Existem
  /// para que nenhuma transação precise ficar com `categoryId` nulo.
  systemKey SystemCategoryKey?
  createdAt DateTime @default(now())

  user         User                 @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions Transaction[]
  budgets      Budget[]
  suggestions  CategorySuggestion[] @relation("SuggestedCategory")

  @@unique([userId, name])
  @@unique([userId, systemKey])
}
```

Em `model Transaction`, adicione os dois campos e o índice:

```prisma
  /// Une as duas pontas de uma transferência interna detectada. Torna o
  /// pareamento idempotente e permite desfazer nas duas pontas de uma vez.
  transferPairId      String?
  suggestion          CategorySuggestion?
```

e, junto dos `@@index` existentes:

```prisma
  @@index([transferPairId])
```

Em `model Notification`, adicione:

```prisma
  /// Rota do app para onde o item leva quando tocado. Null = só informativo.
  link      String?
```

E o modelo novo, depois de `Notification`:

```prisma
model CategorySuggestion {
  id                 String           @id @default(uuid())
  userId             String
  transactionId      String           @unique
  categoryId         String
  source             SuggestionSource
  /// 0..1. Em HISTORY é a fração do histórico daquele comerciante que caiu
  /// nesta categoria; em RULE e PLUGGY é um valor fixo.
  confidence         Float
  status             SuggestionStatus @default(PENDING)
  /// A categoria que o usuário de fato escolheu, quando trocou a sugerida.
  resolvedCategoryId String?
  resolvedAt         DateTime?
  createdAt          DateTime         @default(now())

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  category    Category    @relation("SuggestedCategory", fields: [categoryId], references: [id], onDelete: Cascade)

  @@index([userId, status])
}
```

- [ ] **Step 2: Escrever a migração à mão**

`prisma migrate dev` geraria só o DDL; o backfill precisa ser escrito. Crie o
diretório e o arquivo `apps/api/prisma/migrations/20260820120000_categorizacao_sugerida/migration.sql`:

```sql
-- Enums
CREATE TYPE "SystemCategoryKey" AS ENUM ('TRANSFER', 'UNCATEGORIZED_EXPENSE', 'UNCATEGORIZED_INCOME');
CREATE TYPE "SuggestionSource" AS ENUM ('HISTORY', 'RULE', 'PLUGGY');
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'CHANGED', 'DISMISSED');

-- Colunas novas
ALTER TABLE "Category" ADD COLUMN "systemKey" "SystemCategoryKey";
ALTER TABLE "Transaction" ADD COLUMN "transferPairId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "link" TEXT;

CREATE UNIQUE INDEX "Category_userId_systemKey_key" ON "Category"("userId", "systemKey");
CREATE INDEX "Transaction_transferPairId_idx" ON "Transaction"("transferPairId");

-- Tabela de sugestões
CREATE TABLE "CategorySuggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "source" "SuggestionSource" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedCategoryId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CategorySuggestion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CategorySuggestion_transactionId_key" ON "CategorySuggestion"("transactionId");
CREATE INDEX "CategorySuggestion_userId_status_idx" ON "CategorySuggestion"("userId", "status");

ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CategorySuggestion" ADD CONSTRAINT "CategorySuggestion_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Adoção: se o usuário já tem uma categoria com um dos nomes reservados, ela
-- vira a de sistema em vez de colidir com o unique (userId, name). Ninguém
-- perde histórico, e o unique parcial garante no máximo uma por usuário.
UPDATE "Category" SET "systemKey" = 'TRANSFER'
  WHERE "name" = 'Transferência entre contas' AND "systemKey" IS NULL;
UPDATE "Category" SET "systemKey" = 'UNCATEGORIZED_EXPENSE'
  WHERE "name" = 'Sem categoria (despesa)' AND "systemKey" IS NULL;
UPDATE "Category" SET "systemKey" = 'UNCATEGORIZED_INCOME'
  WHERE "name" = 'Sem categoria (receita)' AND "systemKey" IS NULL;

-- Criação para quem não tinha
INSERT INTO "Category" ("id", "userId", "name", "icon", "colorKey", "systemKey", "createdAt")
SELECT gen_random_uuid(), u."id", 'Transferência entre contas', 'repeat', '5', 'TRANSFER', NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u."id" AND c."systemKey" = 'TRANSFER'
);

INSERT INTO "Category" ("id", "userId", "name", "icon", "colorKey", "systemKey", "createdAt")
SELECT gen_random_uuid(), u."id", 'Sem categoria (despesa)', 'dots', '5', 'UNCATEGORIZED_EXPENSE', NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u."id" AND c."systemKey" = 'UNCATEGORIZED_EXPENSE'
);

INSERT INTO "Category" ("id", "userId", "name", "icon", "colorKey", "systemKey", "createdAt")
SELECT gen_random_uuid(), u."id", 'Sem categoria (receita)', 'dots', '5', 'UNCATEGORIZED_INCOME', NOW()
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "Category" c WHERE c."userId" = u."id" AND c."systemKey" = 'UNCATEGORIZED_INCOME'
);

-- Backfill: nenhuma transação fica sem categoria
UPDATE "Transaction" t
SET "categoryId" = c."id"
FROM "Category" c
WHERE t."categoryId" IS NULL
  AND c."userId" = t."userId"
  AND c."systemKey" = (
    CASE WHEN t."type" = 'EXPENSE' THEN 'UNCATEGORIZED_EXPENSE' ELSE 'UNCATEGORIZED_INCOME' END
  )::"SystemCategoryKey";
```

- [ ] **Step 3: Aplicar a migração e regerar o client**

Run:
```bash
npm run prisma:migrate --workspace=apps/api -- --name categorizacao_sugerida
```

Se o Prisma disser que a migração já existe no diretório, ele apenas a aplica —
é o esperado, porque o arquivo foi escrito à mão. Depois:

```bash
npm run prisma:generate --workspace=apps/api
```

Expected: `Your database is now in sync with your schema.` e o client regerado
sem erro.

- [ ] **Step 4: Conferir o backfill no banco**

Run:
```bash
npx prisma studio --schema apps/api/prisma/schema.prisma
```

Expected: nenhuma linha de `Transaction` com `categoryId` vazio; cada usuário
com exatamente três categorias com `systemKey` preenchido. Feche o studio.

- [ ] **Step 5: Escrever `systemCategories.ts`**

Crie `apps/api/src/lib/systemCategories.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { SystemCategoryKey, TransactionType } from "@prisma/client";

/**
 * As categorias que o app cria e mantém para si.
 *
 * Elas existem por uma razão só: fazer com que `Transaction.categoryId` nunca
 * precise ser nulo. Nulo é um estado que cada consumidor — relatório, orçamento,
 * dashboard, filtro — interpretava do seu jeito; uma linha de verdade em
 * `Category` faz o `groupBy` e o join funcionarem sem ninguém saber que ela é
 * especial. O preço é `systemKey`, que os seletores escondem.
 */
export const SYSTEM_CATEGORY_DEFS = [
  {
    systemKey: SystemCategoryKey.TRANSFER,
    name: "Transferência entre contas",
    icon: "repeat",
    colorKey: "5",
  },
  {
    systemKey: SystemCategoryKey.UNCATEGORIZED_EXPENSE,
    name: "Sem categoria (despesa)",
    icon: "dots",
    colorKey: "5",
  },
  {
    systemKey: SystemCategoryKey.UNCATEGORIZED_INCOME,
    name: "Sem categoria (receita)",
    icon: "dots",
    colorKey: "5",
  },
] as const;

export type SystemCategoryIds = Record<SystemCategoryKey, string>;

/** A oculta em que uma transação sem palpite deve cair, pelo tipo dela. */
export function uncategorizedKeyFor(type: TransactionType): SystemCategoryKey {
  return type === TransactionType.EXPENSE
    ? SystemCategoryKey.UNCATEGORIZED_EXPENSE
    : SystemCategoryKey.UNCATEGORIZED_INCOME;
}

/**
 * Idempotente, e tolerante a quem já tinha uma categoria com o nome reservado:
 * nesse caso adota a linha existente em vez de tentar criar outra e esbarrar no
 * unique (userId, name).
 */
export async function ensureSystemCategories(
  client: Pick<PrismaClient, "category">,
  userId: string
): Promise<SystemCategoryIds> {
  const ids = {} as SystemCategoryIds;

  for (const def of SYSTEM_CATEGORY_DEFS) {
    const byKey = await client.category.findFirst({
      where: { userId, systemKey: def.systemKey },
      select: { id: true },
    });
    if (byKey) {
      ids[def.systemKey] = byKey.id;
      continue;
    }

    const byName = await client.category.findUnique({
      where: { userId_name: { userId, name: def.name } },
      select: { id: true },
    });
    if (byName) {
      const adopted = await client.category.update({
        where: { id: byName.id },
        data: { systemKey: def.systemKey },
        select: { id: true },
      });
      ids[def.systemKey] = adopted.id;
      continue;
    }

    const created = await client.category.create({
      data: {
        userId,
        name: def.name,
        icon: def.icon,
        colorKey: def.colorKey,
        systemKey: def.systemKey,
      },
      select: { id: true },
    });
    ids[def.systemKey] = created.id;
  }

  return ids;
}
```

- [ ] **Step 6: Criar as de sistema no cadastro**

Em `apps/api/src/lib/defaultCategories.ts`, importe e chame o helper no fim de
`createDefaultCategories`:

```ts
import { ensureSystemCategories } from "./systemCategories";
```

e, antes do `return`:

```ts
  // As de sistema vêm junto: conta nova já nasce podendo receber transação sem
  // que exista o estado "sem categoria nenhuma".
  await ensureSystemCategories(client, userId);
```

O parâmetro `client` de `createDefaultCategories` já é declarado como
`Pick<PrismaClient, "category">`, que é exatamente o que `ensureSystemCategories`
pede — sem cast.

- [ ] **Step 7: Compilar**

Run: `npm run build --workspace=apps/api`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/src/lib/systemCategories.ts apps/api/src/lib/defaultCategories.ts
git commit -m "Categorias de sistema: schema, migração e criação no cadastro"
```

---

## Task 2: Guardas — categoria de sistema não se edita, não se exclui, não recebe orçamento

**Files:**
- Modify: `apps/api/src/lib/errors.ts`
- Modify: `apps/api/src/modules/categories/categories.service.ts:63-118`
- Modify: `apps/api/src/modules/budgets/budgets.service.ts:83-100`

**Interfaces:**
- Consumes: `ensureSystemCategories`, `uncategorizedKeyFor` (Task 1).
- Produces: `SystemCategoryError` (400) e `SuggestionNotFoundError` (404) em `lib/errors.ts`.

- [ ] **Step 1: Adicionar os erros**

No fim de `apps/api/src/lib/errors.ts`:

```ts
export class SystemCategoryError extends BadRequestError {
  constructor() {
    super("Esta categoria é mantida pelo Poup e não pode ser editada ou excluída");
  }
}

export class SuggestionNotFoundError extends NotFoundError {
  constructor() {
    super("Sugestão não encontrada");
  }
}
```

- [ ] **Step 2: Recusar edição de categoria de sistema**

Em `categories.service.ts`, dentro de `updateCategory`, logo depois do bloco que
lança `CategoryNotFoundError`:

```ts
  if (existing.systemKey) {
    throw new SystemCategoryError();
  }
```

E ajuste o import no topo:

```ts
import {
  CategoryAlreadyExistsError,
  CategoryNotFoundError,
  SystemCategoryError,
} from "../../lib/errors";

export { CategoryAlreadyExistsError, CategoryNotFoundError, SystemCategoryError };
```

- [ ] **Step 3: Excluir categoria reatribuindo em vez de deixar nulo**

Substitua `deleteCategory` inteiro por:

```ts
/**
 * Excluir uma categoria não pode reintroduzir o estado "sem categoria nenhuma":
 * o `onDelete: SetNull` do schema faria exatamente isso. Por isso as transações
 * são reatribuídas às ocultas antes, e tudo roda numa transação — meio caminho
 * aqui deixaria linhas nulas para trás.
 */
export async function deleteCategory(userId: string, id: string) {
  const existing = await prisma.category.findFirst({
    where: { id, userId },
  });

  if (!existing) {
    throw new CategoryNotFoundError();
  }

  if (existing.systemKey) {
    throw new SystemCategoryError();
  }

  await prisma.$transaction(async (tx) => {
    const systemIds = await ensureSystemCategories(tx, userId);

    await tx.transaction.updateMany({
      where: { userId, categoryId: id, type: TransactionType.EXPENSE },
      data: { categoryId: systemIds.UNCATEGORIZED_EXPENSE },
    });
    await tx.transaction.updateMany({
      where: { userId, categoryId: id, type: TransactionType.INCOME },
      data: { categoryId: systemIds.UNCATEGORIZED_INCOME },
    });

    await tx.category.delete({ where: { id } });
  });

  return { success: true };
}
```

Imports novos no topo do arquivo:

```ts
import { TransactionType } from "@prisma/client";
import { ensureSystemCategories } from "../../lib/systemCategories";
```

- [ ] **Step 4: Recusar orçamento em categoria de sistema**

Em `budgets.service.ts`, dentro de `upsertBudget`, logo depois da busca da
categoria e da checagem de `!category`:

```ts
  if (category.systemKey) {
    throw new SystemCategoryError();
  }
```

Adicione `SystemCategoryError` ao import de `../../lib/errors` do arquivo.

- [ ] **Step 5: Compilar e verificar à mão**

Run: `npm run build --workspace=apps/api`, depois `npm run dev` na raiz.

Com um token válido em `$TOKEN` e o id de uma categoria de sistema em `$SYSID`
(pegue em `GET /api/categories`, é a que tem `systemKey`):

```bash
curl -s -X DELETE localhost:4000/api/categories/$SYSID -H "Authorization: Bearer $TOKEN"
```

Expected: HTTP 400 com `"Esta categoria é mantida pelo Poup..."`.

Depois exclua uma categoria comum que tenha transações e confira em
`GET /api/transactions` que elas apareceram com a categoria "Sem categoria
(despesa)" ou "(receita)", nunca `null`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/errors.ts apps/api/src/modules/categories apps/api/src/modules/budgets
git commit -m "Guardas das categorias de sistema e exclusão que reatribui em vez de anular"
```

---

## Task 3: vitest + normalização de descrição

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/tsconfig.json`
- Create: `apps/api/src/lib/categorization/normalize.ts`
- Test: `apps/api/src/lib/categorization/normalize.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `normalizeDescription(raw: string): string` e `merchantKey(raw: string): string | null`.

- [ ] **Step 1: Instalar o vitest e criar o script**

Run:
```bash
npm install -D vitest --workspace=apps/api
```

Em `apps/api/package.json`, adicione aos `scripts`:

```json
    "test": "vitest run",
    "test:watch": "vitest"
```

Em `apps/api/tsconfig.json`, adicione depois de `"include"`:

```json
  "exclude": ["src/**/*.test.ts"]
```

Sem isso, `npm run build` compilaria os testes para dentro de `dist/`.

- [ ] **Step 2: Escrever o teste que falha**

Crie `apps/api/src/lib/categorization/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { merchantKey, normalizeDescription } from "./normalize";

describe("normalizeDescription", () => {
  it("baixa a caixa e remove acentos", () => {
    expect(normalizeDescription("Padaria São José")).toBe("padaria sao jose");
  });

  it("remove parcelamento", () => {
    expect(normalizeDescription("MAGAZINE LUIZA PARC 03/12")).toBe("magazine luiza");
  });

  it("remove sequências de três ou mais dígitos e a pontuação de extrato", () => {
    expect(normalizeDescription("IFOOD *IFD 4829 SAO PAULO")).toBe("ifood ifd sao paulo");
  });

  it("remove os termos genéricos de extrato", () => {
    expect(normalizeDescription("COMPRA CARTAO DEBITO POSTO IPIRANGA")).toBe(
      "posto ipiranga"
    );
  });

  it("colapsa espaço e apara as bordas", () => {
    expect(normalizeDescription("  UBER   TRIP  ")).toBe("uber trip");
  });
});

describe("merchantKey", () => {
  it("usa os três primeiros tokens", () => {
    expect(merchantKey("IFOOD *IFD 4829 SAO PAULO BR")).toBe("ifood ifd sao");
  });

  it("ignora o resto da descrição, que é onde mora o ruído", () => {
    expect(merchantKey("UBER *TRIP 8821")).toBe(merchantKey("UBER *TRIP 9930"));
  });

  it("devolve null quando sobra pouco para identificar alguém", () => {
    expect(merchantKey("12 34")).toBeNull();
    expect(merchantKey("   ")).toBeNull();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test --workspace=apps/api`
Expected: FAIL — `Failed to resolve import "./normalize"`.

- [ ] **Step 4: Implementar**

Crie `apps/api/src/lib/categorization/normalize.ts`:

```ts
/**
 * Reduzir a descrição de extrato ao nome do comerciante.
 *
 * Um extrato brasileiro carrega tudo menos o que interessa: bandeira, forma de
 * pagamento, parcela, id da maquininha, cidade. Duas compras no mesmo lugar
 * chegam como textos diferentes, e é por isso que casar descrição crua contra
 * descrição crua não funciona. O que sobra depois daqui é o que dá para comparar.
 */

/** Termos que aparecem em toda descrição e não distinguem ninguém. */
const STOPWORDS = new Set([
  "compra",
  "cartao",
  "debito",
  "credito",
  "pagamento",
  "pag",
  "conta",
]);

export function normalizeDescription(raw: string): string {
  const withoutAccents = raw
    .normalize("NFD")
    // A faixa combinante do Unicode, escrita por código para que o arquivo não
    // dependa de como o editor salva um acento solto.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

  const cleaned = withoutAccents
    // parcelamento: "parc 03/12", "3/12"
    .replace(/\bparc\s*\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}(\s*\/\s*\d{2,4})?\b/g, " ")
    // ids e valores: qualquer corrida de três dígitos ou mais
    .replace(/\d{3,}/g, " ")
    // pontuação de extrato
    .replace(/[*#|.,;:()\[\]/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned
    .split(" ")
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .join(" ");
}

/**
 * Os três primeiros tokens normalizados. É o suficiente para separar "IFOOD IFD
 * SAO" de "UBER TRIP", e curto o bastante para que a cidade e o id do fim da
 * linha não impeçam duas compras no mesmo lugar de casarem.
 */
export function merchantKey(raw: string): string | null {
  const key = normalizeDescription(raw).split(" ").slice(0, 3).join(" ").trim();
  if (key.length < 3) return null;
  return key;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test --workspace=apps/api`
Expected: PASS — 8 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/tsconfig.json apps/api/src/lib/categorization/normalize.ts apps/api/src/lib/categorization/normalize.test.ts package-lock.json
git commit -m "Normalização de descrição de extrato, com vitest (primeiro teste do repositório)"
```

---

## Task 4: Similaridade entre descrições

**Files:**
- Create: `apps/api/src/lib/categorization/similarity.ts`
- Test: `apps/api/src/lib/categorization/similarity.test.ts`

**Interfaces:**
- Consumes: `normalizeDescription`, `merchantKey` (Task 3).
- Produces: `SIMILARITY_THRESHOLD: number` (= 0.6) e `similarityScore(a: string, b: string): number` (0..1, recebe descrições **cruas**).

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/categorization/similarity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SIMILARITY_THRESHOLD, similarityScore } from "./similarity";

describe("similarityScore", () => {
  it("dá 1 para descrições idênticas", () => {
    expect(similarityScore("PADARIA SAO JOSE", "PADARIA SAO JOSE")).toBe(1);
  });

  it("dá 1 quando a chave de comerciante é a mesma, apesar do sufixo", () => {
    expect(similarityScore("UBER *TRIP 8821 SP", "UBER *TRIP 9930 RJ")).toBe(1);
  });

  it("dá 0 para descrições sem token em comum", () => {
    expect(similarityScore("NETFLIX", "POSTO IPIRANGA")).toBe(0);
  });

  it("fica acima do limiar para variações do mesmo estabelecimento", () => {
    const score = similarityScore(
      "RESTAURANTE DONA INES LTDA",
      "RESTAURANTE DONA INES"
    );
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("fica abaixo do limiar para estabelecimentos diferentes que compartilham uma palavra", () => {
    const score = similarityScore("RESTAURANTE DONA INES", "RESTAURANTE DO PORTO");
    expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it("dá 0 quando algum lado fica vazio depois de normalizar", () => {
    expect(similarityScore("123456", "NETFLIX")).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test --workspace=apps/api`
Expected: FAIL — `Failed to resolve import "./similarity"`.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/lib/categorization/similarity.ts`:

```ts
import { merchantKey, normalizeDescription } from "./normalize";

/**
 * Acima disso duas descrições são tratadas como do mesmo estabelecimento.
 *
 * 0.6 no coeficiente de Dice é aproximadamente "dois terços dos tokens em
 * comum". Mais baixo começa a casar "Restaurante X" com "Restaurante Y" — que é
 * justamente o erro que faria a aplicação em massa recategorizar o que não deve.
 */
export const SIMILARITY_THRESHOLD = 0.6;

function tokenSet(raw: string): Set<string> {
  return new Set(normalizeDescription(raw).split(" ").filter(Boolean));
}

/**
 * Coeficiente de Dice sobre os conjuntos de tokens, com um atalho: chave de
 * comerciante igual vale 1 independente do resto, porque o resto é o id da
 * transação e a cidade.
 */
export function similarityScore(a: string, b: string): number {
  const keyA = merchantKey(a);
  const keyB = merchantKey(b);
  if (keyA !== null && keyA === keyB) return 1;

  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared++;
  }

  return (2 * shared) / (setA.size + setB.size);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test --workspace=apps/api`
Expected: PASS — 14 testes no total.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/categorization/similarity.ts apps/api/src/lib/categorization/similarity.test.ts
git commit -m "Score de similaridade entre descrições, por coeficiente de Dice"
```

---

## Task 5: Pareamento de transferência interna

**Files:**
- Create: `apps/api/src/lib/categorization/transfers.ts`
- Test: `apps/api/src/lib/categorization/transfers.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `TRANSFER_WINDOW_DAYS: number` (= 3)
  - `interface TransferCandidate { id: string; accountId: string; accountType: "CHECKING" | "SAVINGS" | "CREDIT" | "INVESTMENT"; amount: number; type: "INCOME" | "EXPENSE"; date: Date; transferPairId: string | null }`
  - `interface TransferPair { aId: string; bId: string }`
  - `detectTransferPairs(candidates: TransferCandidate[], universe: TransferCandidate[]): TransferPair[]`

Nota importante para quem implementa: no schema, `Transaction.amount` é sempre o
**módulo** do valor, e o sinal vive em `type`. Então "mesmo sinal" quer dizer
"mesmo `type`" — é assim que o caso da poupança (−100 nas duas pontas) chega
aqui: duas linhas `EXPENSE` de 100.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/categorization/transfers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  TRANSFER_WINDOW_DAYS,
  detectTransferPairs,
  type TransferCandidate,
} from "./transfers";

function tx(over: Partial<TransferCandidate> & { id: string }): TransferCandidate {
  return {
    accountId: "conta-corrente",
    accountType: "CHECKING",
    amount: 100,
    type: "EXPENSE",
    date: new Date("2026-08-10T00:00:00Z"),
    transferPairId: null,
    ...over,
  };
}

describe("detectTransferPairs", () => {
  it("pareia sinais opostos de mesmo valor em contas diferentes", () => {
    const saida = tx({ id: "a" });
    const entrada = tx({ id: "b", accountId: "poupanca", type: "INCOME" });

    expect(detectTransferPairs([saida], [saida, entrada])).toEqual([
      { aId: "a", bId: "b" },
    ]);
  });

  it("pareia mesmo sinal quando uma das contas é poupança (o caso -100/-100)", () => {
    const saida = tx({ id: "a" });
    const aplicacao = tx({
      id: "b",
      accountId: "poupanca",
      accountType: "SAVINGS",
      type: "EXPENSE",
    });

    expect(detectTransferPairs([saida], [saida, aplicacao])).toEqual([
      { aId: "a", bId: "b" },
    ]);
  });

  it("pareia mesmo sinal quando a conta é de investimento", () => {
    const saida = tx({ id: "a" });
    const aplicacao = tx({
      id: "b",
      accountId: "corretora",
      accountType: "INVESTMENT",
      type: "EXPENSE",
    });

    expect(detectTransferPairs([saida], [saida, aplicacao])).toHaveLength(1);
  });

  it("não pareia mesmo sinal entre duas contas correntes", () => {
    const uma = tx({ id: "a" });
    const outra = tx({ id: "b", accountId: "outra-corrente" });

    expect(detectTransferPairs([uma], [uma, outra])).toEqual([]);
  });

  it("não pareia valores diferentes", () => {
    const saida = tx({ id: "a" });
    const entrada = tx({ id: "b", accountId: "poupanca", type: "INCOME", amount: 99.99 });

    expect(detectTransferPairs([saida], [saida, entrada])).toEqual([]);
  });

  it("não pareia na mesma conta", () => {
    const saida = tx({ id: "a" });
    const entrada = tx({ id: "b", type: "INCOME" });

    expect(detectTransferPairs([saida], [saida, entrada])).toEqual([]);
  });

  it("pareia dentro da janela e recusa fora dela", () => {
    const saida = tx({ id: "a" });
    const dentro = tx({
      id: "b",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-13T00:00:00Z"),
    });
    const fora = tx({
      id: "c",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-14T01:00:00Z"),
    });

    expect(TRANSFER_WINDOW_DAYS).toBe(3);
    expect(detectTransferPairs([saida], [saida, dentro])).toHaveLength(1);
    expect(detectTransferPairs([saida], [saida, fora])).toEqual([]);
  });

  it("escolhe a contraparte de data mais próxima quando há várias", () => {
    const saida = tx({ id: "a", date: new Date("2026-08-10T00:00:00Z") });
    const longe = tx({
      id: "b",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-12T00:00:00Z"),
    });
    const perto = tx({
      id: "c",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-11T00:00:00Z"),
    });

    expect(detectTransferPairs([saida], [saida, longe, perto])).toEqual([
      { aId: "a", bId: "c" },
    ]);
  });

  it("não pareia quando duas contrapartes estão à mesma distância", () => {
    const saida = tx({ id: "a", date: new Date("2026-08-10T00:00:00Z") });
    const antes = tx({
      id: "b",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-09T00:00:00Z"),
    });
    const depois = tx({
      id: "c",
      accountId: "corretora",
      type: "INCOME",
      date: new Date("2026-08-11T00:00:00Z"),
    });

    expect(detectTransferPairs([saida], [saida, antes, depois])).toEqual([]);
  });

  it("ignora quem já está pareado, dos dois lados", () => {
    const jaPareada = tx({ id: "a", transferPairId: "par-antigo" });
    const livre = tx({ id: "b", accountId: "poupanca", type: "INCOME" });
    expect(detectTransferPairs([jaPareada], [jaPareada, livre])).toEqual([]);

    const saida = tx({ id: "c" });
    const contraparteOcupada = tx({
      id: "d",
      accountId: "poupanca",
      type: "INCOME",
      transferPairId: "par-antigo",
    });
    expect(detectTransferPairs([saida], [saida, contraparteOcupada])).toEqual([]);
  });

  it("não usa a mesma contraparte para dois candidatos", () => {
    const primeira = tx({ id: "a" });
    const segunda = tx({ id: "b" });
    const unica = tx({ id: "c", accountId: "poupanca", type: "INCOME" });

    const pairs = detectTransferPairs([primeira, segunda], [primeira, segunda, unica]);
    expect(pairs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test --workspace=apps/api`
Expected: FAIL — `Failed to resolve import "./transfers"`.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/lib/categorization/transfers.ts`:

```ts
/**
 * Encontrar as duas pontas de uma transferência entre contas do próprio usuário.
 *
 * A Pluggy não entrega nada que ligue uma ponta à outra: chegam duas linhas
 * independentes, de contas independentes. O que resta é parear por valor e data,
 * e o cuidado todo está em errar para menos — este é o único caminho do sistema
 * que grava uma categoria sem passar pelo usuário.
 *
 * O caso que quebra a intuição é a poupança: depositar 100 na poupança aparece
 * como saída de 100 nas DUAS pontas, porque o extrato da poupança registra a
 * aplicação como débito. Por isso "mesmo sinal" é aceito — mas só quando uma das
 * contas é de poupança ou investimento. Entre duas contas correntes, duas
 * despesas de mesmo valor no mesmo dia são só duas despesas.
 */

export const TRANSFER_WINDOW_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TransferCandidate {
  id: string;
  accountId: string;
  accountType: "CHECKING" | "SAVINGS" | "CREDIT" | "INVESTMENT";
  /** Sempre o módulo: o sinal está em `type`. */
  amount: number;
  type: "INCOME" | "EXPENSE";
  date: Date;
  transferPairId: string | null;
}

export interface TransferPair {
  aId: string;
  bId: string;
}

function acumula(candidate: TransferCandidate): boolean {
  return candidate.accountType === "SAVINGS" || candidate.accountType === "INVESTMENT";
}

function podeParear(a: TransferCandidate, b: TransferCandidate): boolean {
  if (a.id === b.id) return false;
  if (a.accountId === b.accountId) return false;
  if (a.transferPairId !== null || b.transferPairId !== null) return false;
  if (a.amount !== b.amount) return false;
  if (Math.abs(a.date.getTime() - b.date.getTime()) > TRANSFER_WINDOW_DAYS * DAY_MS) {
    return false;
  }
  if (a.type !== b.type) return true;
  return acumula(a) || acumula(b);
}

export function detectTransferPairs(
  candidates: TransferCandidate[],
  universe: TransferCandidate[]
): TransferPair[] {
  const pairs: TransferPair[] = [];
  const usados = new Set<string>();

  for (const candidate of candidates) {
    if (usados.has(candidate.id)) continue;
    if (candidate.transferPairId !== null) continue;

    const contrapartes = universe.filter(
      (other) => !usados.has(other.id) && podeParear(candidate, other)
    );
    if (contrapartes.length === 0) continue;

    const distancia = (other: TransferCandidate) =>
      Math.abs(other.date.getTime() - candidate.date.getTime());

    const menor = Math.min(...contrapartes.map(distancia));
    const maisProximas = contrapartes.filter((other) => distancia(other) === menor);

    // Empate significa que a informação disponível não decide. Marcar uma das
    // duas seria adivinhar num caminho que não pede confirmação a ninguém.
    if (maisProximas.length !== 1) continue;

    const escolhida = maisProximas[0];
    usados.add(candidate.id);
    usados.add(escolhida.id);
    pairs.push({ aId: candidate.id, bId: escolhida.id });
  }

  return pairs;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test --workspace=apps/api`
Expected: PASS — 25 testes no total.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/categorization/transfers.ts apps/api/src/lib/categorization/transfers.test.ts
git commit -m "Pareamento de transferência entre contas, com o caso da poupança"
```

---

## Task 6: Motor de sugestão

**Files:**
- Create: `apps/api/src/lib/categorization/engine.ts`
- Test: `apps/api/src/lib/categorization/engine.test.ts`
- Modify: `apps/api/src/lib/categorization/index.ts`

**Interfaces:**
- Consumes: `merchantKey` (Task 3), `CATEGORIZATION_RULES` (já existe em `rules.ts`).
- Produces:
  - `type HistoryIndex = Map<string, Map<string, number>>`
  - `buildHistoryIndex(entries: { description: string; categoryId: string }[]): HistoryIndex`
  - `interface SuggestionContext { history: HistoryIndex; categories: { id: string; name: string }[] }` — `categories` traz **apenas** as não de sistema
  - `interface Suggestion { categoryId: string; source: "HISTORY" | "RULE" | "PLUGGY"; confidence: number }`
  - `suggestCategory(input: { description: string; pluggyCategory?: string | null }, ctx: SuggestionContext): Suggestion | null`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/categorization/engine.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildHistoryIndex, suggestCategory } from "./engine";

const CATEGORIES = [
  { id: "cat-restaurante", name: "Restaurante" },
  { id: "cat-lazer", name: "Lazer" },
  { id: "cat-mercado", name: "Mercado" },
];

describe("buildHistoryIndex", () => {
  it("conta por chave de comerciante e categoria", () => {
    const index = buildHistoryIndex([
      { description: "IFOOD *IFD 1111", categoryId: "cat-restaurante" },
      { description: "IFOOD *IFD 2222", categoryId: "cat-restaurante" },
      { description: "IFOOD *IFD 3333", categoryId: "cat-lazer" },
    ]);

    expect(index.get("ifood ifd")?.get("cat-restaurante")).toBe(2);
    expect(index.get("ifood ifd")?.get("cat-lazer")).toBe(1);
  });

  it("descarta descrição sem chave aproveitável", () => {
    const index = buildHistoryIndex([{ description: "123", categoryId: "cat-lazer" }]);
    expect(index.size).toBe(0);
  });
});

describe("suggestCategory", () => {
  const history = buildHistoryIndex([
    { description: "IFOOD *IFD 1111", categoryId: "cat-restaurante" },
    { description: "IFOOD *IFD 2222", categoryId: "cat-restaurante" },
    { description: "IFOOD *IFD 3333", categoryId: "cat-lazer" },
  ]);

  it("usa o histórico e reporta a consistência dele como confiança", () => {
    const result = suggestCategory(
      { description: "IFOOD *IFD 9999" },
      { history, categories: CATEGORIES }
    );

    expect(result).toEqual({
      categoryId: "cat-restaurante",
      source: "HISTORY",
      confidence: 2 / 3,
    });
  });

  it("o histórico vence a regra fixa", () => {
    // "ifood" também está na tabela de palavras-chave apontando para
    // Restaurante; aqui o histórico manda em Lazer e é ele que deve valer.
    const historicoDivergente = buildHistoryIndex([
      { description: "IFOOD *IFD 1111", categoryId: "cat-lazer" },
    ]);

    const result = suggestCategory(
      { description: "IFOOD *IFD 9999" },
      { history: historicoDivergente, categories: CATEGORIES }
    );

    expect(result?.categoryId).toBe("cat-lazer");
    expect(result?.source).toBe("HISTORY");
  });

  it("cai na regra fixa quando o histórico não conhece o comerciante", () => {
    const result = suggestCategory(
      { description: "CARREFOUR OSASCO" },
      { history: new Map(), categories: CATEGORIES }
    );

    expect(result).toEqual({
      categoryId: "cat-mercado",
      source: "RULE",
      confidence: 0.5,
    });
  });

  it("cai na categoria da Pluggy quando não há histórico nem regra", () => {
    const result = suggestCategory(
      { description: "ESTABELECIMENTO XPTO", pluggyCategory: "Lazer" },
      { history: new Map(), categories: CATEGORIES }
    );

    expect(result).toEqual({
      categoryId: "cat-lazer",
      source: "PLUGGY",
      confidence: 0.35,
    });
  });

  it("devolve null quando nada se aplica", () => {
    const result = suggestCategory(
      { description: "ESTABELECIMENTO XPTO" },
      { history: new Map(), categories: CATEGORIES }
    );

    expect(result).toBeNull();
  });

  it("não sugere nada quando o usuário não tem categoria selecionável", () => {
    const result = suggestCategory(
      { description: "CARREFOUR OSASCO" },
      { history: new Map(), categories: [] }
    );

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test --workspace=apps/api`
Expected: FAIL — `Failed to resolve import "./engine"`.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/lib/categorization/engine.ts`:

```ts
import { merchantKey } from "./normalize";
import { CATEGORIZATION_RULES } from "./rules";

/**
 * De onde sai o palpite, em ordem de quem conhece mais o usuário.
 *
 * O histórico vem primeiro porque é a única fonte que sabe que ESTE usuário põe
 * a farmácia em Saúde e não em Casa. A tabela de palavras-chave é a rede de
 * segurança para quem ainda não tem histórico, e a categoria da Pluggy é o
 * último recurso — ela acerta a família do gasto e erra o vocabulário.
 */

export const RULE_CONFIDENCE = 0.5;
export const PLUGGY_CONFIDENCE = 0.35;

/** chave de comerciante -> (categoria -> quantas vezes) */
export type HistoryIndex = Map<string, Map<string, number>>;

export interface CategoryRef {
  id: string;
  name: string;
}

export interface SuggestionContext {
  history: HistoryIndex;
  /** Apenas as selecionáveis: categoria de sistema nunca é sugerida. */
  categories: CategoryRef[];
}

export interface SuggestionInput {
  description: string;
  pluggyCategory?: string | null;
}

export interface Suggestion {
  categoryId: string;
  source: "HISTORY" | "RULE" | "PLUGGY";
  confidence: number;
}

export function buildHistoryIndex(
  entries: { description: string; categoryId: string }[]
): HistoryIndex {
  const index: HistoryIndex = new Map();

  for (const entry of entries) {
    const key = merchantKey(entry.description);
    if (key === null) continue;

    let porCategoria = index.get(key);
    if (!porCategoria) {
      porCategoria = new Map();
      index.set(key, porCategoria);
    }
    porCategoria.set(entry.categoryId, (porCategoria.get(entry.categoryId) ?? 0) + 1);
  }

  return index;
}

function fromHistory(description: string, ctx: SuggestionContext): Suggestion | null {
  const key = merchantKey(description);
  if (key === null) return null;

  const porCategoria = ctx.history.get(key);
  if (!porCategoria || porCategoria.size === 0) return null;

  let melhorId: string | null = null;
  let melhorContagem = 0;
  let total = 0;

  for (const [categoryId, contagem] of porCategoria) {
    total += contagem;
    if (contagem > melhorContagem) {
      melhorContagem = contagem;
      melhorId = categoryId;
    }
  }

  if (melhorId === null) return null;
  if (!ctx.categories.some((c) => c.id === melhorId)) return null;

  return { categoryId: melhorId, source: "HISTORY", confidence: melhorContagem / total };
}

function fromRules(
  description: string,
  pluggyCategory: string | null | undefined,
  ctx: SuggestionContext
): Suggestion | null {
  const text = `${description} ${pluggyCategory ?? ""}`.toLowerCase();

  for (const rule of CATEGORIZATION_RULES) {
    if (!rule.keywords.some((keyword) => text.includes(keyword))) continue;

    const match = ctx.categories.find(
      (category) => category.name.toLowerCase() === rule.targetName.toLowerCase()
    );
    if (match) {
      return { categoryId: match.id, source: "RULE", confidence: RULE_CONFIDENCE };
    }
  }

  return null;
}

function fromPluggy(
  pluggyCategory: string | null | undefined,
  ctx: SuggestionContext
): Suggestion | null {
  if (!pluggyCategory) return null;

  const alvo = pluggyCategory.toLowerCase();
  const match = ctx.categories.find((category) => {
    const name = category.name.toLowerCase();
    return name.includes(alvo) || alvo.includes(name);
  });

  if (!match) return null;
  return { categoryId: match.id, source: "PLUGGY", confidence: PLUGGY_CONFIDENCE };
}

export function suggestCategory(
  input: SuggestionInput,
  ctx: SuggestionContext
): Suggestion | null {
  if (ctx.categories.length === 0) return null;

  return (
    fromHistory(input.description, ctx) ??
    fromRules(input.description, input.pluggyCategory, ctx) ??
    fromPluggy(input.pluggyCategory, ctx)
  );
}
```

- [ ] **Step 4: Reexportar pelo index e aposentar o `findBestCategoryMatch`**

Substitua `apps/api/src/lib/categorization/index.ts` inteiro por:

```ts
export type { CategorizationRule } from "./rules";
export { CATEGORIZATION_RULES } from "./rules";

export { merchantKey, normalizeDescription } from "./normalize";
export { SIMILARITY_THRESHOLD, similarityScore } from "./similarity";

export {
  TRANSFER_WINDOW_DAYS,
  detectTransferPairs,
  type TransferCandidate,
  type TransferPair,
} from "./transfers";

export {
  PLUGGY_CONFIDENCE,
  RULE_CONFIDENCE,
  buildHistoryIndex,
  suggestCategory,
  type CategoryRef,
  type HistoryIndex,
  type Suggestion,
  type SuggestionContext,
  type SuggestionInput,
} from "./engine";
```

`findBestCategoryMatch` sai daqui: ele aplicava a categoria direto, que é
exatamente o comportamento que este trabalho substitui. O único chamador é
`pluggy.service.ts`, corrigido na Task 8 — até lá o build da API vai quebrar,
e é o esperado.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test --workspace=apps/api`
Expected: PASS — 33 testes no total. (`npm run build --workspace=apps/api` ainda
falha em `pluggy.service.ts`; a Task 8 resolve.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/categorization
git commit -m "Motor de sugestão: histórico primeiro, regras e Pluggy como rede de segurança"
```

---

## Task 7: Pipeline pós-importação

**Files:**
- Create: `apps/api/src/modules/categorization/categorization.service.ts`

**Interfaces:**
- Consumes: `ensureSystemCategories`, `uncategorizedKeyFor` (Task 1); `detectTransferPairs`, `buildHistoryIndex`, `suggestCategory` (Tasks 5–6).
- Produces: `processNewTransactions(userId: string, transactionIds: string[]): Promise<ProcessResult>` com `interface ProcessResult { transfers: number; suggested: number; withoutGuess: number }`.

- [ ] **Step 1: Escrever o serviço**

Crie `apps/api/src/modules/categorization/categorization.service.ts`:

```ts
import { randomUUID } from "node:crypto";
import { Prisma, SuggestionSource, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  buildHistoryIndex,
  detectTransferPairs,
  suggestCategory,
  TRANSFER_WINDOW_DAYS,
  type TransferCandidate,
} from "../../lib/categorization";
import { ensureSystemCategories, uncategorizedKeyFor } from "../../lib/systemCategories";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProcessResult {
  /** Transações que entraram em "Transferência entre contas" (as duas pontas). */
  transfers: number;
  /** Transações que ganharam sugestão pendente. */
  suggested: number;
  /** Transações que ficaram na oculta sem palpite nenhum. */
  withoutGuess: number;
}

/**
 * O que acontece com uma transação recém-importada.
 *
 * A ordem importa: transferência interna é decidida ANTES de qualquer palpite,
 * porque uma transferência não é um gasto e não deve consumir a atenção do
 * usuário na fila de revisão. O que sobra vai para a oculta correspondente ao
 * tipo — nenhuma transação sai daqui sem categoria — e só então recebe (ou não)
 * uma sugestão pendente.
 */
export async function processNewTransactions(
  userId: string,
  transactionIds: string[]
): Promise<ProcessResult> {
  if (transactionIds.length === 0) {
    return { transfers: 0, suggested: 0, withoutGuess: 0 };
  }

  const systemIds = await ensureSystemCategories(prisma, userId);
  const systemIdSet = new Set(Object.values(systemIds));

  const novas = await prisma.transaction.findMany({
    where: { id: { in: transactionIds }, userId },
    select: {
      id: true,
      accountId: true,
      amount: true,
      type: true,
      date: true,
      description: true,
      transferPairId: true,
      account: { select: { type: true } },
    },
  });

  if (novas.length === 0) {
    return { transfers: 0, suggested: 0, withoutGuess: 0 };
  }

  // 1. Universo do pareamento: a outra ponta pode ter entrado num sync
  //    anterior, então a janela de datas manda, não o lote.
  const datas = novas.map((t) => t.date.getTime());
  const universo = await prisma.transaction.findMany({
    where: {
      userId,
      date: {
        gte: new Date(Math.min(...datas) - TRANSFER_WINDOW_DAYS * DAY_MS),
        lte: new Date(Math.max(...datas) + TRANSFER_WINDOW_DAYS * DAY_MS),
      },
    },
    select: {
      id: true,
      accountId: true,
      amount: true,
      type: true,
      date: true,
      transferPairId: true,
      account: { select: { type: true } },
    },
  });

  const toCandidate = (row: {
    id: string;
    accountId: string;
    amount: Prisma.Decimal;
    type: "INCOME" | "EXPENSE";
    date: Date;
    transferPairId: string | null;
    account: { type: "CHECKING" | "SAVINGS" | "CREDIT" | "INVESTMENT" };
  }): TransferCandidate => ({
    id: row.id,
    accountId: row.accountId,
    accountType: row.account.type,
    amount: Number(row.amount),
    type: row.type,
    date: row.date,
    transferPairId: row.transferPairId,
  });

  const pares = detectTransferPairs(
    novas.map(toCandidate),
    universo.map(toCandidate)
  );

  const emTransferencia = new Set<string>();
  for (const par of pares) {
    const pairId = randomUUID();
    await prisma.transaction.updateMany({
      where: { id: { in: [par.aId, par.bId] }, userId },
      data: { categoryId: systemIds[SystemCategoryKey.TRANSFER], transferPairId: pairId },
    });
    emTransferencia.add(par.aId);
    emTransferencia.add(par.bId);
  }

  // 2. O resto cai na oculta do próprio tipo.
  const restantes = novas.filter((t) => !emTransferencia.has(t.id));

  for (const key of [
    SystemCategoryKey.UNCATEGORIZED_EXPENSE,
    SystemCategoryKey.UNCATEGORIZED_INCOME,
  ] as const) {
    const ids = restantes.filter((t) => uncategorizedKeyFor(t.type) === key).map((t) => t.id);
    if (ids.length === 0) continue;
    await prisma.transaction.updateMany({
      where: { id: { in: ids }, userId },
      data: { categoryId: systemIds[key] },
    });
  }

  // 3. Índice de histórico, construído uma vez para o lote inteiro.
  const selecionaveis = await prisma.category.findMany({
    where: { userId, systemKey: null },
    select: { id: true, name: true },
  });

  const historico = await prisma.transaction.findMany({
    where: {
      userId,
      categoryId: { notIn: Array.from(systemIdSet) },
      id: { notIn: novas.map((t) => t.id) },
    },
    select: { description: true, categoryId: true },
  });

  const ctx = {
    history: buildHistoryIndex(
      historico
        .filter((t): t is { description: string; categoryId: string } => t.categoryId !== null)
    ),
    categories: selecionaveis,
  };

  // 4. Sugestões. `skipDuplicates` cobre a transação que já foi julgada num
  //    sync anterior: uma sugestão por transação, e pular é definitivo.
  const sugestoes = restantes
    .map((tx) => {
      const palpite = suggestCategory({ description: tx.description }, ctx);
      if (!palpite) return null;
      return {
        userId,
        transactionId: tx.id,
        categoryId: palpite.categoryId,
        source: palpite.source as SuggestionSource,
        confidence: palpite.confidence,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  let suggested = 0;
  if (sugestoes.length > 0) {
    const result = await prisma.categorySuggestion.createMany({
      data: sugestoes,
      skipDuplicates: true,
    });
    suggested = result.count;
  }

  return {
    transfers: emTransferencia.size,
    suggested,
    withoutGuess: restantes.length - suggested,
  };
}
```

- [ ] **Step 2: Compilar só este arquivo**

Run: `npx tsc --noEmit -p apps/api/tsconfig.json`
Expected: o único erro restante é `findBestCategoryMatch` em
`pluggy.service.ts`. Qualquer erro dentro de `categorization.service.ts` precisa
ser corrigido agora.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/categorization
git commit -m "Pipeline pós-importação: transferências, ocultas e sugestões pendentes"
```

---

## Task 8: Ligar o pipeline ao sync e à criação manual

**Files:**
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts:19,213-290`
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:150-190`

**Interfaces:**
- Consumes: `processNewTransactions` (Task 7), `ensureSystemCategories` / `uncategorizedKeyFor` (Task 1).
- Produces: `SyncItemResult` ganha `review: ProcessResult` (o objeto devolvido por `processNewTransactions`), consumido pela Task 9.

- [ ] **Step 1: Trocar o import no `pluggy.service.ts`**

Remova:

```ts
import { findBestCategoryMatch } from "../../lib/categorization";
```

E ponha:

```ts
import { processNewTransactions } from "../categorization/categorization.service";
import type { ProcessResult } from "../categorization/categorization.service";
```

- [ ] **Step 2: Descobrir quais linhas são de fato novas**

`upsert` não conta se criou ou atualizou. Dentro do laço de contas, **antes** do
`for (const pTx of transactions)`, insira:

```ts
    // O upsert não diz se criou ou atualizou, e o pipeline só deve rodar sobre
    // o que é novo — reprocessar o que já foi revisado ressuscitaria sugestões
    // que o usuário já julgou.
    const idsRemotos = transactions.map((t) => t.id);
    const jaExistentes = new Set(
      (
        await prisma.transaction.findMany({
          where: { pluggyTransactionId: { in: idsRemotos } },
          select: { pluggyTransactionId: true },
        })
      ).map((t) => t.pluggyTransactionId!)
    );
```

- [ ] **Step 3: Coletar os ids novos e parar de categorizar no create**

Declare o acumulador junto de `let transactionsSynced = 0;`:

```ts
  const idsNovos: string[] = [];
```

E troque o corpo do `await prisma.transaction.upsert({...})` para guardar o
retorno e remover a categorização:

```ts
      const saved = await prisma.transaction.upsert({
        where: { pluggyTransactionId: pTx.id },
        update: {
          description,
          amount: new Prisma.Decimal(Math.abs(rawAmount)),
          type: isExpense ? TransactionType.EXPENSE : TransactionType.INCOME,
          date: new Date(pTx.date),
          accountId: accountRecord.id,
        },
        create: {
          userId,
          accountId: accountRecord.id,
          pluggyTransactionId: pTx.id,
          description,
          amount: new Prisma.Decimal(Math.abs(rawAmount)),
          type: isExpense ? TransactionType.EXPENSE : TransactionType.INCOME,
          date: new Date(pTx.date),
          isRecurring: false,
        },
        select: { id: true },
      });

      if (!jaExistentes.has(pTx.id)) {
        idsNovos.push(saved.id);
      }

      transactionsSynced++;
```

Repare que `categoryId` sumiu do `create`: quem decide categoria agora é o
pipeline, que roda depois com o lote inteiro na mão.

A busca de `userCategories` logo acima (o comentário "4. Categorias do usuário,
para a auto-categorização") fica sem uso — remova as duas coisas.

- [ ] **Step 4: Rodar o pipeline no fim do sync**

Substitua o `return` da função por:

```ts
  const review = await processNewTransactions(userId, idsNovos);

  return {
    item: toItemDTO(itemRecord),
    accountsSynced,
    transactionsSynced,
    review,
  };
```

E acrescente `review: ProcessResult;` à interface de retorno da função (a que
declara `transactionsSynced: number`), e some os campos no agregador de
`syncAllItems` (onde hoje há `totalTransactions += res.transactionsSynced`):

```ts
    totalReview.transfers += res.review.transfers;
    totalReview.suggested += res.review.suggested;
    totalReview.withoutGuess += res.review.withoutGuess;
```

declarando antes do laço:

```ts
  const totalReview: ProcessResult = { transfers: 0, suggested: 0, withoutGuess: 0 };
```

e devolvendo `review: totalReview` no objeto final.

- [ ] **Step 5: Transação criada à mão também nasce categorizada**

Em `transactions.service.ts`, dentro de `createTransaction`, troque a linha
`categoryId: input.categoryId ?? null,` por um id resolvido antes do `create`:

```ts
  // Nem a criação manual escapa da invariante: sem categoria escolhida, a
  // transação nasce na oculta do próprio tipo.
  let categoryId = input.categoryId ?? null;
  if (!categoryId) {
    const systemIds = await ensureSystemCategories(prisma, userId);
    categoryId = systemIds[uncategorizedKeyFor(input.type as PrismaTransactionType)];
  }
```

e no `data` do `create`, `categoryId,`.

Imports novos no topo:

```ts
import { ensureSystemCategories, uncategorizedKeyFor } from "../../lib/systemCategories";
```

- [ ] **Step 6: Recategorizar uma ponta desfaz o par**

Ainda em `transactions.service.ts`, dentro de `updateTransaction`, logo antes do
`prisma.transaction.update`:

```ts
  // Mover uma ponta para fora de "Transferência entre contas" significa que o
  // pareamento errou. Desfazer só um lado deixaria a outra ponta sozinha numa
  // categoria que já não descreve nada.
  if (input.categoryId !== undefined && existing.transferPairId) {
    await prisma.transaction.updateMany({
      where: { userId, transferPairId: existing.transferPairId, id: { not: id } },
      data: { transferPairId: null },
    });
    await prisma.transaction.update({
      where: { id },
      data: { transferPairId: null },
    });
  }
```

E o `update` seguinte precisa rejeitar `null` em `categoryId`: substitua
`...(input.categoryId !== undefined && { categoryId: input.categoryId }),` por:

```ts
      ...(input.categoryId !== undefined && input.categoryId !== null && {
        categoryId: input.categoryId,
      }),
```

Limpar a categoria pela edição deixaria de novo uma transação sem categoria;
para "não sei ainda" existe a oculta, que o usuário alcança pela fila.

- [ ] **Step 7: Compilar e testar o sync de ponta a ponta**

Run: `npm run build --workspace=apps/api` — Expected: sem erros.

Suba `npm run dev`, faça login no app e clique em **Sincronizar**. Depois:

```bash
curl -s localhost:4000/api/transactions -H "Authorization: Bearer $TOKEN" | head -c 1200
```

Expected: nenhuma transação com `"categoryId": null`. As que o motor não soube
palpitar aparecem com `"categoryName": "Sem categoria (despesa)"`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pluggy apps/api/src/modules/transactions
git commit -m "Sync passa a delegar a categorização ao pipeline, em vez de aplicar direto"
```

---

## Task 9: Notificação de revisão

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts:1-40`
- Modify: `apps/api/src/modules/pluggy/pluggy.routes.ts`

**Interfaces:**
- Consumes: `ProcessResult` (Task 8).
- Produces: `createReviewNotification(userId: string, result: ProcessResult): Promise<void>`; `NotificationDTO` passa a ter `link: string | null`.

- [ ] **Step 1: Levar o `link` até o DTO**

Em `notifications.service.ts`, na assinatura de `formatNotificationDTO`, adicione
`link: string | null;` ao objeto do parâmetro e `link: n.link,` ao retorno.

- [ ] **Step 2: Criar a notificação de revisão**

Adicione ao mesmo arquivo:

```ts
import type { ProcessResult } from "../categorization/categorization.service";

const REVIEW_LINK = "/revisao";

/**
 * Uma notificação por lote, não uma por transação — uma importação de 200
 * lançamentos encheria o sininho e enterraria os alertas de orçamento. Se já
 * existe uma não lida apontando para a revisão, ela é atualizada: o que o
 * usuário quer saber é quantas estão esperando agora, não quantas chegaram em
 * cada sync.
 */
export async function createReviewNotification(
  userId: string,
  result: ProcessResult
): Promise<void> {
  if (result.suggested === 0) return;

  const pendentes = await prisma.categorySuggestion.count({
    where: { userId, status: "PENDING" },
  });
  if (pendentes === 0) return;

  const title = `${pendentes} ${pendentes === 1 ? "transação" : "transações"} para revisar`;
  const partes = [
    `${result.suggested} com categoria sugerida`,
    result.withoutGuess > 0 ? `${result.withoutGuess} sem palpite` : null,
    result.transfers > 0
      ? `${result.transfers} identificadas como transferência entre suas contas`
      : null,
  ].filter(Boolean);
  const body = `${partes.join(", ")}. Toque para revisar uma a uma.`;

  const existing = await prisma.notification.findFirst({
    where: { userId, link: REVIEW_LINK, read: false },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    await prisma.notification.update({
      where: { id: existing.id },
      data: { title, body, createdAt: new Date() },
    });
    return;
  }

  await prisma.notification.create({
    data: { userId, title, body, severity: NotificationSeverity.INFO, link: REVIEW_LINK },
  });
}
```

- [ ] **Step 3: Disparar depois do sync**

Em `pluggy.routes.ts`, nos handlers que chamam `syncUserItem` e `syncAllItems`,
depois de obter o resultado e antes do `res.json`:

```ts
    await createReviewNotification(req.userId!, result.review);
```

com o import correspondente:

```ts
import { createReviewNotification } from "../notifications/notifications.service";
```

Use o nome de variável que já existir no handler no lugar de `result`.

- [ ] **Step 4: Verificar**

Suba `npm run dev`, sincronize pelo app e depois:

```bash
curl -s localhost:4000/api/notifications -H "Authorization: Bearer $TOKEN"
```

Expected: um item com `"link": "/revisao"` e título no formato `N transações
para revisar`. Sincronize de novo: o item deve ser **atualizado**, não
duplicado — a lista continua com um só.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/notifications apps/api/src/modules/pluggy
git commit -m "Notificação de revisão, uma por lote e atualizada em vez de duplicada"
```

---

## Task 10: Rotas de sugestão

**Files:**
- Create: `apps/api/src/modules/categorization/suggestions.service.ts`
- Create: `apps/api/src/modules/categorization/suggestions.routes.ts`
- Modify: `apps/api/src/app.ts:14,100`

**Interfaces:**
- Consumes: `SuggestionNotFoundError`, `SystemCategoryError` (Task 2); `CategoryNotFoundError` (existente).
- Produces:
  - `listPendingSuggestions(userId): Promise<{ suggestions: SuggestionDTO[]; count: number }>`
  - `countPendingSuggestions(userId): Promise<number>`
  - `acceptSuggestion(userId, id, categoryId?): Promise<{ transaction: TransactionDTO; remaining: number }>`
  - `dismissSuggestion(userId, id): Promise<{ remaining: number }>`
  - `suggestionsRouter` montado em `/api/suggestions`

`SuggestionDTO` é definido em `packages/shared` na Task 13; até lá, declare a
interface localmente no serviço com os mesmos campos e troque pelo import
compartilhado quando a Task 13 rodar. Campos: `id`, `transaction`,
`suggestedCategoryId`, `suggestedCategoryName`, `source`, `confidence`.

- [ ] **Step 1: Escrever o serviço**

Crie `apps/api/src/modules/categorization/suggestions.service.ts`:

```ts
import { SuggestionStatus } from "@prisma/client";
import { prisma } from "../../prisma";
import type { SuggestionDTO, TransactionDTO } from "@poup/shared";
import {
  CategoryNotFoundError,
  SuggestionNotFoundError,
  SystemCategoryError,
} from "../../lib/errors";
import { getTransactionById } from "../transactions/transactions.service";

const TX_INCLUDE = {
  account: { select: { name: true } },
  category: { select: { name: true } },
} as const;

export async function countPendingSuggestions(userId: string): Promise<number> {
  return prisma.categorySuggestion.count({
    where: { userId, status: SuggestionStatus.PENDING },
  });
}

export async function listPendingSuggestions(
  userId: string
): Promise<{ suggestions: SuggestionDTO[]; count: number }> {
  const rows = await prisma.categorySuggestion.findMany({
    where: { userId, status: SuggestionStatus.PENDING },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
    include: {
      category: { select: { name: true } },
      transaction: { include: TX_INCLUDE },
    },
  });

  const suggestions = rows.map((row) => ({
    id: row.id,
    transaction: {
      id: row.transaction.id,
      description: row.transaction.description,
      amount: Number(row.transaction.amount),
      type: row.transaction.type,
      date: row.transaction.date.toISOString(),
      note: row.transaction.note,
      isRecurring: row.transaction.isRecurring,
      accountId: row.transaction.accountId,
      accountName: row.transaction.account.name,
      categoryId: row.transaction.categoryId,
      categoryName: row.transaction.category?.name ?? null,
    } as TransactionDTO,
    suggestedCategoryId: row.categoryId,
    suggestedCategoryName: row.category.name,
    source: row.source,
    confidence: row.confidence,
  }));

  return { suggestions, count: suggestions.length };
}

/**
 * Aceitar sem `categoryId` aplica o que foi sugerido; com `categoryId` aplica a
 * escolha do usuário e guarda as duas. A diferença entre `ACCEPTED` e `CHANGED`
 * é o único sinal que existe sobre a qualidade do palpite.
 */
export async function acceptSuggestion(
  userId: string,
  id: string,
  categoryId?: string
): Promise<{ transaction: TransactionDTO; remaining: number }> {
  const suggestion = await prisma.categorySuggestion.findFirst({
    where: { id, userId, status: SuggestionStatus.PENDING },
  });
  if (!suggestion) {
    throw new SuggestionNotFoundError();
  }

  let escolhida = suggestion.categoryId;
  let status: SuggestionStatus = SuggestionStatus.ACCEPTED;

  if (categoryId && categoryId !== suggestion.categoryId) {
    const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
    if (!category) throw new CategoryNotFoundError();
    if (category.systemKey) throw new SystemCategoryError();
    escolhida = categoryId;
    status = SuggestionStatus.CHANGED;
  }

  await prisma.$transaction([
    prisma.transaction.update({
      where: { id: suggestion.transactionId },
      data: { categoryId: escolhida, transferPairId: null },
    }),
    prisma.categorySuggestion.update({
      where: { id },
      data: { status, resolvedCategoryId: escolhida, resolvedAt: new Date() },
    }),
  ]);

  const transaction = await getTransactionById(userId, suggestion.transactionId);
  if (!transaction) throw new SuggestionNotFoundError();

  return { transaction, remaining: await countPendingSuggestions(userId) };
}

export async function dismissSuggestion(
  userId: string,
  id: string
): Promise<{ remaining: number }> {
  const suggestion = await prisma.categorySuggestion.findFirst({
    where: { id, userId, status: SuggestionStatus.PENDING },
  });
  if (!suggestion) {
    throw new SuggestionNotFoundError();
  }

  await prisma.categorySuggestion.update({
    where: { id },
    data: { status: SuggestionStatus.DISMISSED, resolvedAt: new Date() },
  });

  return { remaining: await countPendingSuggestions(userId) };
}
```

- [ ] **Step 2: Escrever as rotas**

Crie `apps/api/src/modules/categorization/suggestions.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import {
  acceptSuggestion,
  countPendingSuggestions,
  dismissSuggestion,
  listPendingSuggestions,
} from "./suggestions.service";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const suggestionsRouter = Router();

suggestionsRouter.use(requireAuth);

const acceptSchema = z.object({
  categoryId: z.string().min(1).optional(),
});

suggestionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listPendingSuggestions(req.userId!));
  })
);

suggestionsRouter.get(
  "/count",
  asyncHandler(async (req, res) => {
    res.json({ count: await countPendingSuggestions(req.userId!) });
  })
);

suggestionsRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const { categoryId } = acceptSchema.parse(req.body ?? {});
    res.json(await acceptSuggestion(req.userId!, req.params.id, categoryId));
  })
);

suggestionsRouter.post(
  "/:id/dismiss",
  asyncHandler(async (req, res) => {
    res.json(await dismissSuggestion(req.userId!, req.params.id));
  })
);
```

- [ ] **Step 3: Montar no app**

Em `apps/api/src/app.ts`, junto dos outros imports de router:

```ts
import { suggestionsRouter } from "./modules/categorization/suggestions.routes";
```

e junto dos outros `apiRouter.use`:

```ts
apiRouter.use("/suggestions", suggestionsRouter);
```

- [ ] **Step 4: Verificar**

Com o servidor no ar e uma fila já criada por um sync:

```bash
curl -s localhost:4000/api/suggestions/count -H "Authorization: Bearer $TOKEN"
curl -s localhost:4000/api/suggestions -H "Authorization: Bearer $TOKEN" | head -c 800
```

Expected: contagem maior que zero e a lista com `suggestedCategoryName` e
`confidence` preenchidos. Aceite a primeira (`$SID`):

```bash
curl -s -X POST localhost:4000/api/suggestions/$SID/accept -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

Expected: a transação volta com a categoria sugerida aplicada, e `remaining`
uma unidade menor.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/categorization apps/api/src/app.ts
git commit -m "Rotas de sugestão: listar, contar, aprovar e pular"
```

---

## Task 11: Parecidas e aplicação em massa

**Files:**
- Create: `apps/api/src/modules/categorization/similar.service.ts`
- Modify: `apps/api/src/modules/transactions/transactions.routes.ts`

**Interfaces:**
- Consumes: `similarityScore`, `SIMILARITY_THRESHOLD` (Task 4); `ensureSystemCategories` (Task 1); `countPendingSuggestions` (Task 10).
- Produces:
  - `findSimilarTransactions(userId, transactionId, categoryId): Promise<{ uncategorized: SimilarTransactionDTO[]; differentCategory: SimilarTransactionDTO[] }>`
  - `bulkCategorize(userId, transactionIds: string[], categoryId: string): Promise<{ updated: number }>`
  - Rotas `GET /api/transactions/:id/similar` e `POST /api/transactions/bulk-categorize`

- [ ] **Step 1: Escrever o serviço**

Crie `apps/api/src/modules/categorization/similar.service.ts`:

```ts
import { SuggestionStatus, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import type { SimilarTransactionDTO } from "@poup/shared";
import { SIMILARITY_THRESHOLD, similarityScore } from "../../lib/categorization";
import {
  CategoryNotFoundError,
  SystemCategoryError,
  TransactionNotFoundError,
} from "../../lib/errors";
import { ensureSystemCategories } from "../../lib/systemCategories";

/**
 * Tetos deliberados: este é o único caminho que compara par a par em vez de
 * consultar por chave, então sem limite ele degrada junto com o tamanho do
 * histórico. Vinte e quatro meses cobrem qualquer padrão de gasto recorrente.
 */
const HISTORY_MONTHS = 24;
const MAX_CANDIDATES = 500;
const MAX_PER_SECTION = 50;

export async function findSimilarTransactions(
  userId: string,
  transactionId: string,
  categoryId: string
): Promise<{
  uncategorized: SimilarTransactionDTO[];
  differentCategory: SimilarTransactionDTO[];
}> {
  const base = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { id: true, description: true },
  });
  if (!base) throw new TransactionNotFoundError();

  const systemIds = await ensureSystemCategories(prisma, userId);
  const semCategoria = [
    systemIds[SystemCategoryKey.UNCATEGORIZED_EXPENSE],
    systemIds[SystemCategoryKey.UNCATEGORIZED_INCOME],
  ];

  const desde = new Date();
  desde.setMonth(desde.getMonth() - HISTORY_MONTHS);

  const candidatas = await prisma.transaction.findMany({
    where: {
      userId,
      id: { not: base.id },
      date: { gte: desde },
      // Transferência interna não entra: ela já está resolvida, e oferecê-la
      // aqui convidaria a desfazer o pareamento sem querer.
      categoryId: { not: systemIds[SystemCategoryKey.TRANSFER] },
    },
    orderBy: { date: "desc" },
    take: MAX_CANDIDATES,
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
  });

  const uncategorized: SimilarTransactionDTO[] = [];
  const differentCategory: SimilarTransactionDTO[] = [];

  for (const tx of candidatas) {
    const score = similarityScore(base.description, tx.description);
    if (score < SIMILARITY_THRESHOLD) continue;
    if (tx.categoryId === categoryId) continue;

    const dto: SimilarTransactionDTO = {
      id: tx.id,
      description: tx.description,
      amount: Number(tx.amount),
      type: tx.type,
      date: tx.date.toISOString(),
      note: tx.note,
      isRecurring: tx.isRecurring,
      accountId: tx.accountId,
      accountName: tx.account.name,
      categoryId: tx.categoryId,
      categoryName: tx.category?.name ?? null,
      score,
    };

    if (tx.categoryId && semCategoria.includes(tx.categoryId)) {
      uncategorized.push(dto);
    } else {
      differentCategory.push({ ...dto, currentCategoryName: tx.category?.name ?? null });
    }
  }

  const porScore = (a: SimilarTransactionDTO, b: SimilarTransactionDTO) => b.score - a.score;

  return {
    uncategorized: uncategorized.sort(porScore).slice(0, MAX_PER_SECTION),
    differentCategory: differentCategory.sort(porScore).slice(0, MAX_PER_SECTION),
  };
}

export async function bulkCategorize(
  userId: string,
  transactionIds: string[],
  categoryId: string
): Promise<{ updated: number }> {
  const category = await prisma.category.findFirst({ where: { id: categoryId, userId } });
  if (!category) throw new CategoryNotFoundError();
  if (category.systemKey) throw new SystemCategoryError();

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.transaction.updateMany({
      where: { id: { in: transactionIds }, userId },
      data: { categoryId, transferPairId: null },
    });

    // Uma transação que acabou de receber categoria não pode continuar na fila
    // pedindo a mesma decisão.
    await tx.categorySuggestion.updateMany({
      where: {
        userId,
        transactionId: { in: transactionIds },
        status: SuggestionStatus.PENDING,
      },
      data: {
        status: SuggestionStatus.CHANGED,
        resolvedCategoryId: categoryId,
        resolvedAt: new Date(),
      },
    });

    return updated.count;
  });

  return { updated: result };
}
```

- [ ] **Step 2: Expor as rotas**

Em `transactions.routes.ts`, adicione os imports:

```ts
import { bulkCategorize, findSimilarTransactions } from "../categorization/similar.service";
```

e os schemas + rotas. **A rota `bulk-categorize` precisa vir antes de `/:id`**,
senão o Express casa `bulk-categorize` como um id:

```ts
const bulkCategorizeSchema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1, "Selecione ao menos uma transação"),
  categoryId: z.string().min(1, "Categoria é obrigatória"),
});

transactionsRouter.post(
  "/bulk-categorize",
  asyncHandler(async (req, res) => {
    const { transactionIds, categoryId } = bulkCategorizeSchema.parse(req.body);
    res.json(await bulkCategorize(req.userId!, transactionIds, categoryId));
  })
);

transactionsRouter.get(
  "/:id/similar",
  asyncHandler(async (req, res) => {
    const categoryId = z.string().min(1).parse(req.query.categoryId);
    res.json(await findSimilarTransactions(req.userId!, req.params.id, categoryId));
  })
);
```

Coloque as duas **acima** do `transactionsRouter.get("/:id", ...)` existente.

- [ ] **Step 3: Verificar**

Categorize uma transação pelo app, pegue o id dela em `$TXID` e o id da
categoria em `$CATID`:

```bash
curl -s "localhost:4000/api/transactions/$TXID/similar?categoryId=$CATID" -H "Authorization: Bearer $TOKEN"
```

Expected: `uncategorized` com transações do mesmo estabelecimento e
`differentCategory` com as que já têm outra categoria, cada uma com
`currentCategoryName`. Nenhuma delas com `categoryName` igual a "Transferência
entre contas".

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/categorization/similar.service.ts apps/api/src/modules/transactions/transactions.routes.ts
git commit -m "Buscar transações parecidas e aplicar categoria em massa"
```

---

## Task 12: Relatórios e filtros passam a conhecer as ocultas

**Files:**
- Modify: `apps/api/src/modules/reports/reports.service.ts:100-160,230-245`
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:95-105`

**Interfaces:**
- Consumes: `ensureSystemCategories` (Task 1).
- Produces: nenhuma interface nova; muda a semântica de `filters.uncategorized` e dos agregados.

- [ ] **Step 1: Excluir transferência dos totais**

Em `reports.service.ts`, adicione perto do topo:

```ts
import { SystemCategoryKey } from "@prisma/client";
import { ensureSystemCategories } from "../../lib/systemCategories";

/**
 * Transferência entre contas do próprio usuário não é gasto nem receita: o
 * dinheiro só mudou de bolso. Contá-la infla os dois lados do mesmo mês e
 * estraga a taxa de poupança.
 */
async function transferCategoryId(userId: string): Promise<string> {
  const ids = await ensureSystemCategories(prisma, userId);
  return ids[SystemCategoryKey.TRANSFER];
}
```

Em `totalsByType`, `expensesByCategory` e `monthlySeries`, acrescente ao `where`
de cada consulta:

```ts
      categoryId: { not: transferId },
```

passando `transferId` como parâmetro novo para as três funções, resolvido uma
vez em `getReportSummary`:

```ts
  const transferId = await transferCategoryId(userId);
```

- [ ] **Step 2: Contar as não categorizadas pelas ocultas**

Em `getReportSummary`, troque a consulta de `uncategorizedCount`:

```ts
    prisma.transaction.count({
      where: {
        userId,
        categoryId: {
          in: [
            systemIds[SystemCategoryKey.UNCATEGORIZED_EXPENSE],
            systemIds[SystemCategoryKey.UNCATEGORIZED_INCOME],
          ],
        },
        ...dateFilter(period),
      },
    }),
```

com `const systemIds = await ensureSystemCategories(prisma, userId);` resolvido
antes do `Promise.all` (e `transferId` saindo daí também, dispensando a função
auxiliar do passo anterior — prefira esta forma e remova `transferCategoryId`).

- [ ] **Step 3: Reapontar o filtro `uncategorized`**

Em `transactions.service.ts`, dentro de `listTransactions`, troque:

```ts
  if (filters.uncategorized) {
    where.categoryId = null;
  } else if (filters.categoryId) {
```

por:

```ts
  if (filters.uncategorized) {
    // "Sem categoria" deixou de ser ausência e virou um lugar: as duas ocultas.
    const systemIds = await ensureSystemCategories(prisma, userId);
    where.categoryId = {
      in: [
        systemIds[SystemCategoryKey.UNCATEGORIZED_EXPENSE],
        systemIds[SystemCategoryKey.UNCATEGORIZED_INCOME],
      ],
    };
  } else if (filters.categoryId) {
```

com `SystemCategoryKey` adicionado ao import de `@prisma/client`.

- [ ] **Step 4: Verificar**

```bash
curl -s localhost:4000/api/reports/summary -H "Authorization: Bearer $TOKEN"
curl -s "localhost:4000/api/transactions?uncategorized=true" -H "Authorization: Bearer $TOKEN" | head -c 600
```

Expected: em `byCategory` não existe nenhuma linha "Transferência entre contas";
`uncategorizedCount` bate com o número de itens do segundo comando; e as
transações listadas todas têm `categoryName` começando com "Sem categoria".

Confira também no app que o total de despesas do mês **caiu** em relação ao que
era antes desta tarefa, se você tiver transferências entre contas no período —
é justamente a distorção que sai.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/reports apps/api/src/modules/transactions
git commit -m "Relatórios ignoram transferência interna; filtro sem categoria aponta para as ocultas"
```

---

## Task 13: DTOs compartilhados e cliente HTTP

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/hooks/useCategories.ts`
- Modify: `apps/api/src/modules/categorization/suggestions.service.ts` (trocar a interface local pelo import compartilhado)

**Interfaces:**
- Consumes: as rotas das Tasks 10 e 11.
- Produces:
  - Tipos `SystemCategoryKey`, `SuggestionDTO`, `SimilarTransactionDTO`, `SimilarTransactionsResponse`; `CategoryDTO.systemKey`; `NotificationDTO.link`.
  - Funções do cliente: `fetchSuggestions`, `fetchSuggestionsCount`, `acceptSuggestion`, `dismissSuggestion`, `fetchSimilarTransactions`, `bulkCategorize`.
  - `useCategories(): { categories, allCategories, categoryMap, loading, reload }` — `categories` sem as de sistema, `allCategories` e `categoryMap` com todas.

- [ ] **Step 1: Adicionar os tipos compartilhados**

Em `packages/shared/src/index.ts`, junto de `CategoryDTO`:

```ts
export type SystemCategoryKey =
  | "TRANSFER"
  | "UNCATEGORIZED_EXPENSE"
  | "UNCATEGORIZED_INCOME";
```

e o campo dentro de `CategoryDTO`:

```ts
  /** Preenchido nas categorias que o Poup mantém. Não aparecem em seletores. */
  systemKey: SystemCategoryKey | null;
```

Em `NotificationDTO`:

```ts
  /** Rota do app para onde o item leva. Null = só informativo. */
  link: string | null;
```

E, no fim do arquivo:

```ts
export interface SuggestionDTO {
  id: string;
  transaction: TransactionDTO;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  source: "HISTORY" | "RULE" | "PLUGGY";
  confidence: number;
}

export interface SimilarTransactionDTO extends TransactionDTO {
  /** 0..1. Quanto a descrição se parece com a da transação de origem. */
  score: number;
  /** Só na seção de categoria divergente. */
  currentCategoryName?: string | null;
}

export interface SimilarTransactionsResponse {
  uncategorized: SimilarTransactionDTO[];
  differentCategory: SimilarTransactionDTO[];
}
```

Run: `npm run build:shared`
Expected: sem erros.

- [ ] **Step 2: Trocar a interface local do serviço pelo import**

Em `suggestions.service.ts`, se a Task 10 declarou `SuggestionDTO` localmente,
remova a declaração — o import de `@poup/shared` já está no arquivo.

- [ ] **Step 3: Funções do cliente**

Em `apps/web/src/lib/api.ts`, adicione os tipos ao bloco de import de
`@poup/shared` (`SuggestionDTO`, `SimilarTransactionsResponse`) e, ao fim do
arquivo:

```ts
// ==========================================
// SUGESTÕES DE CATEGORIA
// ==========================================
export async function fetchSuggestions(): Promise<{
  suggestions: SuggestionDTO[];
  count: number;
}> {
  return request("/suggestions");
}

export async function fetchSuggestionsCount(): Promise<number> {
  const data = await request<{ count: number }>("/suggestions/count");
  return data.count;
}

export async function acceptSuggestion(
  id: string,
  categoryId?: string
): Promise<{ transaction: TransactionDTO; remaining: number }> {
  return request(`/suggestions/${id}/accept`, {
    method: "POST",
    body: JSON.stringify(categoryId ? { categoryId } : {}),
  });
}

export async function dismissSuggestion(id: string): Promise<{ remaining: number }> {
  return request(`/suggestions/${id}/dismiss`, { method: "POST" });
}

export async function fetchSimilarTransactions(
  transactionId: string,
  categoryId: string
): Promise<SimilarTransactionsResponse> {
  return request(
    `/transactions/${transactionId}/similar?categoryId=${encodeURIComponent(categoryId)}`
  );
}

export async function bulkCategorize(
  transactionIds: string[],
  categoryId: string
): Promise<{ updated: number }> {
  return request("/transactions/bulk-categorize", {
    method: "POST",
    body: JSON.stringify({ transactionIds, categoryId }),
  });
}
```

- [ ] **Step 4: Separar as selecionáveis das demais**

Em `apps/web/src/hooks/useCategories.ts`, substitua o retorno de `useCategories`
e a interface por:

```ts
export interface UseCategoriesResult {
  /** Só as selecionáveis: é o que todo seletor quer mostrar. */
  categories: CategoryDTO[];
  /** Todas, inclusive as de sistema — para desenhar o chip de uma transação. */
  allCategories: CategoryDTO[];
  categoryMap: CategoryMap;
  loading: boolean;
  /** Recarrega do servidor — use depois de criar, editar ou excluir. */
  reload: () => Promise<CategoryDTO[]>;
}
```

e, no corpo, antes do `return`:

```ts
  // O mapa continua com todas: a lista de transações precisa saber desenhar
  // "Transferência entre contas", que nenhum seletor deve oferecer.
  const selectable = useMemo(() => categories.filter((c) => !c.systemKey), [categories]);
```

com `return { categories: selectable, allCategories: categories, categoryMap: useCategoryMap(categories), loading, reload };`.

- [ ] **Step 5: Esconder as de sistema na tela de Categorias**

Em `apps/web/src/pages/CategoriesPage.tsx`, o consumo de `useCategories` já passa
a receber só as selecionáveis em `categories`. Se a página buscar categorias por
`fetchCategories` direto, filtre no ponto de uso:

```ts
const visiveis = categories.filter((c) => !c.systemKey);
```

Verifique o arquivo e aplique a forma que couber; o resultado obrigatório é que
as três de sistema não apareçam na grade nem no seletor de orçamento.

- [ ] **Step 6: Compilar**

Run: `npm run build`
Expected: shared, api e web compilam sem erro.

- [ ] **Step 7: Commit**

```bash
git add packages/shared apps/web/src/lib/api.ts apps/web/src/hooks/useCategories.ts apps/web/src/pages/CategoriesPage.tsx apps/api/src/modules/categorization/suggestions.service.ts
git commit -m "DTOs de sugestão, cliente HTTP e categorias de sistema fora dos seletores"
```

---

## Task 14: Botão "Sugestões" com contador

**Files:**
- Create: `apps/web/src/hooks/useSuggestionsCount.ts`
- Create: `apps/web/src/components/suggestions/SuggestionsButton.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx:180-200`
- Modify: `apps/web/src/pages/TransactionsPage.tsx:181-192`

**Interfaces:**
- Consumes: `fetchSuggestionsCount` (Task 13).
- Produces: `useSuggestionsCount(): { count: number; refresh: () => Promise<void> }` e `<SuggestionsButton />`.

- [ ] **Step 1: O hook**

Crie `apps/web/src/hooks/useSuggestionsCount.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import { fetchSuggestionsCount } from "../lib/api";

/**
 * Contagem de sugestões pendentes.
 *
 * É de sugestões, não de transações sem categoria: a fila é feita de decisões
 * que o app propôs, e uma transação sem palpite não é uma proposta — ela mora
 * no filtro "sem categoria" da tela de Transações.
 */
export function useSuggestionsCount(): { count: number; refresh: () => Promise<void> } {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      setCount(await fetchSuggestionsCount());
    } catch {
      // A contagem é enfeite: falhar aqui não pode derrubar a tela que a usa.
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { count, refresh };
}
```

- [ ] **Step 2: O botão**

Crie `apps/web/src/components/suggestions/SuggestionsButton.tsx`:

```tsx
import React from "react";
import { Link } from "react-router-dom";
import { useSuggestionsCount } from "../../hooks/useSuggestionsCount";

/**
 * Não renderiza nada com a fila vazia. Um botão permanente que quase sempre
 * mostra zero vira parte do cenário, e quando enfim tem algo ninguém repara.
 */
export function SuggestionsButton() {
  const { count } = useSuggestionsCount();

  if (count === 0) return null;

  return (
    <Link
      to="/revisao"
      className="tap-target inline-flex items-center gap-2 h-ctl px-3 rounded-ctl bg-surface border border-border hover:border-border-strong hover:bg-surface-alt transition-colors focus-ring shrink-0"
      title="Revisar categorias sugeridas"
    >
      <span className="text-sm font-semibold text-text-primary">Sugestões</span>
      <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-xs font-bold flex items-center justify-center">
        {count > 99 ? "99+" : count}
      </span>
    </Link>
  );
}
```

- [ ] **Step 3: Colocar em Transações**

Em `apps/web/src/pages/TransactionsPage.tsx`, o cabeçalho hoje é um `div` com só
o título dentro. Substitua o bloco:

```tsx
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-display-xl font-display font-extrabold text-text-primary">
            Transações
          </h1>
          <p className="text-xs md:text-sm text-text-secondary mt-0.5">
            Visualize e categorize suas movimentações financeiras
          </p>
        </div>
      </div>
```

por:

```tsx
      <div className="flex flex-row items-start justify-between gap-4">
        <div>
          <h1 className="text-display-xl font-display font-extrabold text-text-primary">
            Transações
          </h1>
          <p className="text-xs md:text-sm text-text-secondary mt-0.5">
            Visualize e categorize suas movimentações financeiras
          </p>
        </div>
        <SuggestionsButton />
      </div>
```

com `import { SuggestionsButton } from "../components/suggestions/SuggestionsButton";`.

- [ ] **Step 4: Colocar no Dashboard**

Em `apps/web/src/pages/DashboardPage.tsx`, dentro do
`<div className="flex items-center gap-3 shrink-0">` que já guarda os botões
Sincronizar e Ver transações, adicione **como primeiro filho**:

```tsx
          <SuggestionsButton />
```

com o mesmo import. Fica à direita do título, na mesma linha, acima do resto da
página — que é onde ele foi pedido.

- [ ] **Step 5: Verificar no navegador**

Suba `npm run dev`. Com fila pendente, o botão aparece nas duas telas com o
número certo; depois de zerar a fila (Task 15) ele some. Confira no celular
(DevTools em 375px) que ele não empurra o título para fora.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/hooks/useSuggestionsCount.ts apps/web/src/components/suggestions apps/web/src/pages/DashboardPage.tsx apps/web/src/pages/TransactionsPage.tsx
git commit -m "Botão Sugestões com contador no Dashboard e em Transações"
```

---

## Task 15: Tela de revisão

**Files:**
- Create: `apps/web/src/pages/ReviewPage.tsx`
- Modify: `apps/web/src/App.tsx:110-125`

**Interfaces:**
- Consumes: `fetchSuggestions`, `acceptSuggestion`, `dismissSuggestion` (Task 13); `useCategories` (Task 13); `CategorySelectModal`, `EmptyState`, `Button`, `CategoryTile` (existentes); **`SimilarTransactionsModal` (Task 16)**.
- Produces: rota `/revisao`.

> **Ordem:** esta tarefa importa o `SimilarTransactionsModal`, que só nasce na
> Task 16. Ou faça o Step 1 da Task 16 antes desta, ou aceite que o `npm run
> build` só volta a passar ao fim da Task 16 — as duas formas funcionam, mas a
> segunda deixa a verificação do Step 3 sem como rodar.

- [ ] **Step 1: A página**

Crie `apps/web/src/pages/ReviewPage.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SuggestionDTO } from "@poup/shared";
import {
  acceptSuggestion,
  dismissSuggestion,
  fetchSuggestions,
} from "../lib/api";
import { useCategories } from "../hooks/useCategories";
import { CategorySelectModal } from "../components/categories/CategorySelectModal";
import { SimilarTransactionsModal } from "../components/transactions/SimilarTransactionsModal";
import { EmptyState } from "../components/common/EmptyState";
import { Button } from "../components/ui/Button";
import { CategoryTile } from "../components/ui/CategoryTile";
import { formatCurrency, formatDate } from "../lib/format";

const SOURCE_LABEL: Record<SuggestionDTO["source"], string> = {
  HISTORY: "porque você já categorizou transações parecidas assim",
  RULE: "pelo nome do estabelecimento",
  PLUGGY: "pela categoria informada pelo banco",
};

export function ReviewPage() {
  const { categories, categoryMap } = useCategories();
  const [queue, setQueue] = useState<SuggestionDTO[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Oferta de aplicar em massa, mostrada só depois de uma troca de categoria. */
  const [offer, setOffer] = useState<{ transactionId: string; categoryId: string } | null>(
    null
  );
  const [similarOpen, setSimilarOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await fetchSuggestions();
        setQueue(data.suggestions);
      } catch (err) {
        console.error("Erro ao carregar sugestões:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const current = queue[index] ?? null;

  async function resolve(categoryId?: string) {
    if (!current || saving) return;
    setSaving(true);
    try {
      await acceptSuggestion(current.id, categoryId);
      // Trocar a categoria é a decisão que vale a pena repetir em massa;
      // aprovar o que o app já sugeriu, não — abrir o modal a cada aprovação
      // transformaria oito toques em dezesseis.
      setOffer(
        categoryId && categoryId !== current.suggestedCategoryId
          ? { transactionId: current.transaction.id, categoryId }
          : null
      );
      setIndex((i) => i + 1);
    } catch (err) {
      console.error("Erro ao aplicar categoria:", err);
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    if (!current || saving) return;
    setSaving(true);
    try {
      await dismissSuggestion(current.id);
      setOffer(null);
      setIndex((i) => i + 1);
    } catch (err) {
      console.error("Erro ao pular sugestão:", err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-text-secondary">Carregando sugestões…</div>;
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-6 anim-fade-up">
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Revisar categorias
        </h1>
        <EmptyState
          title="Nada para revisar"
          description="Assim que chegarem transações novas com uma categoria sugerida, elas aparecem aqui."
          action={
            <Link to="/transacoes">
              <Button variant="primary">Ver transações</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const tx = current.transaction;
  const sugerida = categoryMap[current.suggestedCategoryId];

  return (
    <div className="flex flex-col gap-6 anim-fade-up">
      <div className="flex flex-row items-start justify-between gap-4">
        <h1 className="text-display-xl font-display font-extrabold text-text-primary">
          Revisar categorias
        </h1>
        <span className="text-sm text-text-secondary shrink-0 mt-1">
          {index + 1} de {queue.length}
        </span>
      </div>

      {offer && (
        <button
          type="button"
          onClick={() => setSimilarOpen(true)}
          className="tap-target text-left w-full rounded-panel border border-border bg-surface-alt px-4 py-3 text-sm text-text-primary hover:border-border-strong transition-colors focus-ring"
        >
          Aplicar <strong>{categoryMap[offer.categoryId]?.name}</strong> a outras
          transações parecidas?
        </button>
      )}

      <div className="bg-surface rounded-panel p-5 shadow-sh1 border border-border flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold text-text-primary break-words">
            {tx.description}
          </p>
          <p
            className={`text-2xl font-display font-extrabold ${
              tx.type === "EXPENSE" ? "text-danger" : "text-success"
            }`}
          >
            {tx.type === "EXPENSE" ? "-" : "+"}
            {formatCurrency(tx.amount)}
          </p>
          <p className="text-xs text-text-secondary">
            {tx.accountName} · {formatDate(tx.date)}
          </p>
        </div>

        <div className="rounded-ctl bg-surface-alt border border-border p-4 flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Categoria sugerida
          </span>
          <div className="flex items-center gap-3">
            {sugerida && (
              <CategoryTile icon={sugerida.icon} colorKey={sugerida.colorKey} size="md" />
            )}
            <span className="text-base font-semibold text-text-primary">
              {current.suggestedCategoryName}
            </span>
          </div>
          <span className="text-xs text-text-secondary">{SOURCE_LABEL[current.source]}</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="primary" onClick={() => void resolve()} loading={saving} fullWidth>
            Aprovar
          </Button>
          <Button variant="secondary" onClick={() => setPickerOpen(true)} disabled={saving} fullWidth>
            Trocar categoria
          </Button>
          <Button variant="ghost" onClick={() => void skip()} disabled={saving} fullWidth>
            Pular
          </Button>
        </div>
      </div>

      <CategorySelectModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={categories}
        selectedCategoryId={current.suggestedCategoryId}
        onSelectCategory={(id) => {
          if (id) void resolve(id);
        }}
        title="Escolher categoria"
        allowUncategorized={false}
      />

      {offer && (
        <SimilarTransactionsModal
          isOpen={similarOpen}
          onClose={() => {
            setSimilarOpen(false);
            setOffer(null);
          }}
          transactionId={offer.transactionId}
          categoryId={offer.categoryId}
          categoryMap={categoryMap}
        />
      )}
    </div>
  );
}
```

Confira as assinaturas de `EmptyState`, `Button` e `CategoryTile` nos arquivos
existentes e ajuste as props se divergirem (por exemplo, se `EmptyState` usar
`message` em vez de `description`).

- [ ] **Step 2: Registrar a rota**

Em `apps/web/src/App.tsx`, junto das outras rotas dentro do `AppLayout`:

```tsx
                  <Route path="/revisao" element={<ReviewPage />} />
```

com `import { ReviewPage } from "./pages/ReviewPage";`.

- [ ] **Step 3: Verificar**

Rode `npm run dev`, sincronize para encher a fila e abra `/revisao`. Confira:
aprovar avança e diminui o contador do botão Sugestões; trocar categoria aplica
a escolhida e faz aparecer a faixa de "aplicar em parecidas" no card seguinte;
pular avança sem categorizar; ao fim aparece o estado vazio. Recarregue a página
no meio da fila: ela deve recomeçar do primeiro pendente, sem erro.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ReviewPage.tsx apps/web/src/App.tsx
git commit -m "Tela de revisão: uma sugestão por vez, com aprovar, trocar e pular"
```

---

## Task 16: Modal de transações parecidas

**Files:**
- Create: `apps/web/src/components/transactions/SimilarTransactionsModal.tsx`
- Modify: `apps/web/src/components/transactions/TransactionDetailModal.tsx:45-70`

**Interfaces:**
- Consumes: `fetchSimilarTransactions`, `bulkCategorize` (Task 13); `Modal`, `Button` (existentes); `CategoryMap` (de `useCategories`).
- Produces: `<SimilarTransactionsModal isOpen onClose transactionId categoryId categoryMap onApplied? />`.

- [ ] **Step 1: O modal**

Crie `apps/web/src/components/transactions/SimilarTransactionsModal.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import type { SimilarTransactionDTO } from "@poup/shared";
import { bulkCategorize, fetchSimilarTransactions } from "../../lib/api";
import type { CategoryMap } from "../../hooks/useCategories";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { formatCurrency, formatDate } from "../../lib/format";

interface SimilarTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** A transação que você acabou de categorizar. Ela não entra na lista. */
  transactionId: string;
  categoryId: string;
  categoryMap: CategoryMap;
  onApplied?: (updated: number) => void;
}

function Linha({
  tx,
  checked,
  onToggle,
}: {
  tx: SimilarTransactionDTO;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="tap-target flex items-center gap-3 px-3 py-2.5 rounded-ctl hover:bg-surface-alt cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="w-4 h-4 shrink-0 accent-primary"
      />
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-text-primary truncate">{tx.description}</span>
        <span className="block text-xs text-text-secondary">
          {formatDate(tx.date)} · {tx.accountName}
          {tx.currentCategoryName ? ` · hoje em ${tx.currentCategoryName}` : ""}
        </span>
      </span>
      <span
        className={`text-sm font-semibold shrink-0 ${
          tx.type === "EXPENSE" ? "text-danger" : "text-success"
        }`}
      >
        {tx.type === "EXPENSE" ? "-" : "+"}
        {formatCurrency(tx.amount)}
      </span>
    </label>
  );
}

export function SimilarTransactionsModal({
  isOpen,
  onClose,
  transactionId,
  categoryId,
  categoryMap,
  onApplied,
}: SimilarTransactionsModalProps) {
  const [semCategoria, setSemCategoria] = useState<SimilarTransactionDTO[]>([]);
  const [divergentes, setDivergentes] = useState<SimilarTransactionDTO[]>([]);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      setLoading(true);
      try {
        const data = await fetchSimilarTransactions(transactionId, categoryId);
        setSemCategoria(data.uncategorized);
        setDivergentes(data.differentCategory);
        // Pré-marcar só as que ainda não têm categoria: as outras já são uma
        // decisão sua, e desfazê-la em massa tem que ser deliberado.
        setSelecionadas(new Set(data.uncategorized.map((t) => t.id)));
      } catch (err) {
        console.error("Erro ao buscar transações parecidas:", err);
        setSemCategoria([]);
        setDivergentes([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, transactionId, categoryId]);

  function toggle(id: string) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function aplicar() {
    if (selecionadas.size === 0 || saving) return;
    setSaving(true);
    try {
      const { updated } = await bulkCategorize(Array.from(selecionadas), categoryId);
      onApplied?.(updated);
      onClose();
    } catch (err) {
      console.error("Erro ao aplicar em massa:", err);
    } finally {
      setSaving(false);
    }
  }

  const nomeCategoria = categoryMap[categoryId]?.name ?? "esta categoria";
  const vazio = !loading && semCategoria.length === 0 && divergentes.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Aplicar em transações parecidas"
      description={`Marque as que também são ${nomeCategoria}.`}
      maxWidth="lg"
      footer={
        <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Agora não
          </Button>
          <Button
            variant="primary"
            onClick={() => void aplicar()}
            loading={saving}
            disabled={selecionadas.size === 0}
          >
            Aplicar em {selecionadas.size}
          </Button>
        </div>
      }
    >
      {loading && <p className="text-sm text-text-secondary">Procurando parecidas…</p>}

      {vazio && (
        <p className="text-sm text-text-secondary">
          Nenhuma outra transação parecida com esta.
        </p>
      )}

      {semCategoria.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary px-3 pt-1">
            Sem categoria
          </h3>
          {semCategoria.map((tx) => (
            <Linha
              key={tx.id}
              tx={tx}
              checked={selecionadas.has(tx.id)}
              onToggle={() => toggle(tx.id)}
            />
          ))}
        </section>
      )}

      {divergentes.length > 0 && (
        <section className="flex flex-col gap-1 mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary px-3">
            Já categorizadas de outro jeito
          </h3>
          <p className="text-xs text-text-secondary px-3 pb-1">
            Marcar uma destas substitui a categoria que ela tem hoje.
          </p>
          {divergentes.map((tx) => (
            <Linha
              key={tx.id}
              tx={tx}
              checked={selecionadas.has(tx.id)}
              onToggle={() => toggle(tx.id)}
            />
          ))}
        </section>
      )}
    </Modal>
  );
}
```

- [ ] **Step 2: Abrir depois de categorizar à mão**

Em `TransactionDetailModal.tsx`, no `handleSave` (onde hoje há
`const updated = await updateTransaction(...)`), guarde se a categoria mudou e
abra o modal em vez de fechar direto. Adicione o estado:

```tsx
  const [similarFor, setSimilarFor] = useState<string | null>(null);
```

Dentro do save, depois do `updateTransaction` bem-sucedido:

```tsx
      // A categoria da transação editada já está salva; o modal cuida só das
      // outras. Só faz sentido quando a categoria de fato mudou e não é oculta.
      const mudou = categoryId && categoryId !== transaction.categoryId;
      const oculta = categoryId ? Boolean(categoryMap[categoryId]?.systemKey) : false;
      if (mudou && !oculta) {
        setSimilarFor(categoryId);
        return;
      }
```

antes do `onClose()` / `onSaved(updated)` que o arquivo já faz — mantenha a
propagação do `updated` para quem chamou, apenas adie o fechamento.

E, no JSX do componente, ao lado do `CategorySelectModal` existente:

```tsx
      {similarFor && (
        <SimilarTransactionsModal
          isOpen={true}
          onClose={() => {
            setSimilarFor(null);
            onClose();
          }}
          transactionId={transaction.id}
          categoryId={similarFor}
          categoryMap={categoryMap}
        />
      )}
```

com `import { SimilarTransactionsModal } from "./SimilarTransactionsModal";`.

- [ ] **Step 3: Verificar**

No app, abra uma transação sem categoria de um estabelecimento que se repete
(ex.: iFood), escolha uma categoria e salve. Expected: o modal abre listando as
outras do mesmo estabelecimento — as sem categoria marcadas, as de outra
categoria desmarcadas e com "hoje em X". Desmarque uma, aplique, e confira na
lista de transações que só as marcadas mudaram.

Depois teste o caminho de dentro da fila: em `/revisao`, troque a categoria de
uma sugestão e toque na faixa que aparece no card seguinte.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/transactions
git commit -m "Modal de transações parecidas, com as já categorizadas desmarcadas"
```

---

## Task 17: Notificação que leva à revisão

**Files:**
- Modify: `apps/web/src/components/notifications/NotificationDrawer.tsx:80-237`

**Interfaces:**
- Consumes: `NotificationDTO.link` (Task 13).
- Produces: nada novo.

- [ ] **Step 1: Tornar o item clicável**

No `NotificationDrawer`, importe o navegador do router:

```tsx
import { useNavigate } from "react-router-dom";
```

e dentro do componente:

```tsx
  const navigate = useNavigate();

  async function handleOpen(n: NotificationDTO) {
    if (!n.link) return;
    if (!n.read) {
      await handleMarkRead(n.id).catch(() => {
        // Navegar importa mais que o "lida": se a marcação falhar, a
        // notificação continua ali e o usuário chega onde queria mesmo assim.
      });
    }
    onClose();
    navigate(n.link);
  }
```

No `map` que renderiza cada notificação, envolva o conteúdo do item num
`role="button"` quando houver `link`:

```tsx
              <div
                {...(n.link
                  ? {
                      role: "button",
                      tabIndex: 0,
                      onClick: () => void handleOpen(n),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void handleOpen(n);
                        }
                      },
                    }
                  : {})}
                className={n.link ? "cursor-pointer focus-ring rounded-ctl" : undefined}
              >
```

Mantenha o botão de "marcar como lida" que já existe fora desse `div`, para que
clicar nele não navegue.

- [ ] **Step 2: Verificar**

Sincronize, abra o sininho e toque na notificação "N transações para revisar".
Expected: o painel fecha, a rota vira `/revisao` e a notificação aparece como
lida ao reabrir o sininho. No celular (375px), onde o painel é folha de rodapé,
o mesmo toque precisa funcionar.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/notifications/NotificationDrawer.tsx
git commit -m "Notificação de revisão leva à tela de revisão ao ser tocada"
```

---

## Task 18: Verificação de ponta a ponta e atualização do PLAN.md

**Files:**
- Modify: `PLAN.md`

**Interfaces:**
- Consumes: tudo.
- Produces: nada.

- [ ] **Step 1: Rodar tudo**

```bash
npm run test --workspace=apps/api
```

Expected: 33 testes passando.

```bash
npm run build
```

Expected: shared, api e web sem erro.

- [ ] **Step 2: Passar pelo fluxo inteiro no app**

Com `npm run dev` e o app aberto, confirme, um a um:

1. Sincronizar cria uma notificação "N transações para revisar" com link.
2. O botão Sugestões aparece no Dashboard e em Transações com a contagem certa.
3. `/revisao` mostra uma transação por vez; aprovar, trocar e pular funcionam.
4. Trocar categoria oferece aplicar em parecidas; aplicar muda só as marcadas.
5. Nenhuma transação em `GET /api/transactions` tem `categoryId` nulo.
6. Transferência entre duas contas suas caiu em "Transferência entre contas" nas
   duas pontas — inclusive um depósito em poupança, que chega como saída dos
   dois lados.
7. O relatório do mês não conta essa transferência como despesa.
8. A tela de Categorias não mostra nenhuma das três de sistema, e o seletor de
   categoria do orçamento também não.
9. Sincronizar de novo **não** ressuscita sugestões já aprovadas ou puladas.

Qualquer item que falhar volta para a tarefa correspondente antes de seguir.

- [ ] **Step 3: Atualizar o PLAN.md**

O `PLAN.md` tem uma regra escrita no topo: ele descreve o que **existe**.
Adicione à seção "O que está pronto", em Backend:

```markdown
18. Categorização sugerida: o sync deixa de aplicar categoria e passa a gravar
    sugestões pendentes (`CategorySuggestion`); toda transação nasce numa das
    três categorias de sistema (`Category.systemKey`), que não aparecem em
    seletores nem aceitam orçamento
19. Transferência entre contas do próprio usuário detectada por valor + data +
    contas (`src/lib/categorization/transfers.ts`), com as duas pontas fora dos
    relatórios; cobre o caso da poupança, em que as duas pontas têm o mesmo sinal
20. Aplicar categoria em transações parecidas, por similaridade de descrição
    (`GET /transactions/:id/similar`, `POST /transactions/bulk-categorize`)
```

Renumere os itens seguintes. Em Frontend:

```markdown
    Tela de revisão (`/revisao`), uma sugestão por vez, alcançável pela
    notificação e pelo botão "Sugestões" com contador no Dashboard e em
    Transações
```

E em "Outros pendentes conhecidos", corrija a linha sobre testes:

```markdown
- **Teste automatizado só na lib de categorização.** `npm run test --workspace=apps/api`
  cobre normalização, similaridade, pareamento de transferência e o motor de
  palpite. Rotas, pipeline e telas seguem verificados à mão.
```

- [ ] **Step 4: Commit**

```bash
git add PLAN.md
git commit -m "PLAN.md: registrar a categorização sugerida"
```

---

## Auto-revisão deste plano

**Cobertura do spec.** Todas as seções têm tarefa: modelo de dados → Task 1;
guardas → Task 2; detecção de transferência → Tasks 5, 7; motor → Tasks 3, 4, 6;
pipeline → Tasks 7, 8; notificação → Tasks 9, 17; API → Tasks 10, 11; frontend →
Tasks 13–17; impacto em relatórios, orçamentos, filtros e exclusão de categoria →
Tasks 2, 12; testes → Tasks 3–6.

**Dois pontos em que o build fica vermelho de propósito**, e nenhum é acidente:

1. A Task 6 remove `findBestCategoryMatch`, único símbolo que `pluggy.service.ts`
   ainda importava. O build da API só volta a passar na Task 8. Executar 6, 7 e 8
   fora de ordem não funciona.
2. A Task 15 importa o `SimilarTransactionsModal` da Task 16. O build do web só
   volta a passar na Task 16 — antecipe o Step 1 da Task 16 se quiser verificar a
   tela de revisão no navegador antes.

**Nomes que atravessam tarefas** e precisam bater exatamente:
`ensureSystemCategories`, `uncategorizedKeyFor`, `SYSTEM_CATEGORY_DEFS`,
`SystemCategoryIds` (Task 1); `normalizeDescription`, `merchantKey` (Task 3);
`similarityScore`, `SIMILARITY_THRESHOLD` (Task 4); `detectTransferPairs`,
`TransferCandidate`, `TransferPair`, `TRANSFER_WINDOW_DAYS` (Task 5);
`buildHistoryIndex`, `suggestCategory`, `HistoryIndex`, `SuggestionContext`,
`Suggestion` (Task 6); `processNewTransactions`, `ProcessResult` (Task 7);
`countPendingSuggestions` (Task 10); `SuggestionDTO`, `SimilarTransactionDTO`,
`SimilarTransactionsResponse` (Task 13); `useSuggestionsCount` (Task 14);
`SimilarTransactionsModal` (Task 16, consumido também pela Task 15).
