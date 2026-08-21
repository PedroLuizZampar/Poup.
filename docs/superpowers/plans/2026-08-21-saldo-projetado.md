# Saldo Projetado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Poup responder "com o que ainda vai entrar e sair, quanto sobra dia 31?", com um motor de projeção que produz um calendário de eventos datados e telas derivadas dele.

**Architecture:** Um motor puro em `apps/api/src/lib/projection/` (sem Prisma, testável sem banco) gera um calendário de eventos futuros a partir de medianas históricas, parcelas e ciclos de fatura. `modules/projection/projection.service.ts` monta os insumos com agregação no banco e chama o motor. Todas as leituras da UI — saldo de fim de mês, linha diária, dia do aperto, runway, disponível diário — são derivadas do mesmo calendário.

**Tech Stack:** Node + Express + TypeScript + Prisma (Postgres/Neon), React + Vite + Tailwind, vitest, pluggy-sdk.

**Spec:** `docs/superpowers/specs/2026-08-21-saldo-projetado-design.md`

## Global Constraints

- **Moeda no banco é `Decimal(14, 2)`.** Colunas novas de dinheiro seguem `@db.Decimal(14, 2)`. Nos DTOs o valor trafega como `number` (padrão existente do projeto).
- **Datas são gravadas e comparadas em UTC.** Use `Date.UTC(...)`, `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()` — nunca os equivalentes locais. `reports.service.ts` já faz assim; divergir quebra a chave de mês.
- **Chave de mês é `"YYYY-MM"`**, gerada como em `reports.service.ts:monthKey`.
- **Migrações são SQL escrito à mão** em `apps/api/prisma/migrations/<timestamp>_<nome_snake_case>/migration.sql`, com um comentário no topo explicando *por que* a coluna existe. Nunca rode `prisma migrate dev` (ele tentaria criar a migração sozinho e pode resetar o banco): crie o diretório e o arquivo, e aplique com `npx prisma migrate deploy`.
- **O banco `DATABASE_URL` tem mais de uma conta real.** Todo script de manutenção e toda query de backfill precisa ser escopada por `userId`. Nunca rode `UPDATE`/`DELETE` sem cláusula de usuário.
- **Categorias de sistema (`systemKey` `TRANSFER` e `UNCATEGORIZED`) nunca projetam** e recusam alteração de `nature`, como já recusam orçamento.
- **Contas `excludedFromBalance` ficam fora dos dois lados da projeção** (saldo inicial e eventos). Exceção deliberada ao item 29 do `PLAN.md`.
- **Todo valor em dinheiro exibido no web passa pelo componente `<Money>`** (`apps/web/src/components/ui/Money.tsx`). Sem isso o modo discreto vaza.
- **Nada de `any` novo.** O projeto compila com `tsc -p tsconfig.json` em cada workspace.
- **Testes ficam ao lado do fonte**, como `apps/api/src/lib/categorization/normalize.test.ts`. Rodar: `npm run test --workspace=apps/api`.
- **Comentário explica o porquê, não o quê.** Siga o tom dos comentários existentes em `schema.prisma` e `lib/categorization/`.

---

### Task 1: Schema e migração

Todas as colunas novas numa migração só. Separá-las em quatro migrações não daria nenhuma capacidade de rollback útil — elas são um pacote — e multiplicaria o custo de aplicar no Neon.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260822120000_saldo_projetado/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: enum Prisma `CategoryNature` (`FIXED` | `VARIABLE`); campos `Category.nature`, `User.safetyReserve`, `Account.creditLimit`, `Account.availableCreditLimit`, `Account.statementClosingDate`, `Account.statementDueDate`, `Transaction.installmentIndex`, `Transaction.installmentTotal`, `Transaction.merchantName`, `Transaction.merchantKey`; model `CreditCardBill`.

- [ ] **Step 1: Adicionar o enum e os campos ao schema**

Em `apps/api/prisma/schema.prisma`, junto dos outros enums:

```prisma
enum CategoryNature {
  FIXED
  VARIABLE
}
```

Em `model Category`, depois de `systemKey`:

```prisma
  /// Fixa: o valor se repete todo mês e entra na projeção como *comprometido*.
  /// Variável: o valor oscila e entra como *estimado*, prorateado pelos dias que
  /// faltam. É o único sinal que o motor tem para separar as duas faixas — não
  /// há detector de recorrência, e a fila de revisão é o que alimenta isso.
  nature    CategoryNature @default(VARIABLE)
```

Em `model User`, depois de `avatarUrl`:

```prisma
  /// Colchão que o "disponível diário" desconta antes de dividir pelos dias que
  /// faltam. Zero por padrão: quem não configurou não deve ver o número mudar.
  safetyReserve Decimal @default(0) @db.Decimal(14, 2)
```

Em `model Account`, depois de `excludedFromBalance`:

```prisma
  /// creditData da Pluggy. Chegavam a cada sync e eram descartados — sem eles a
  /// projeção não sabe *quando* a fatura vira saída de caixa, que é a única
  /// coisa que interessa numa projeção de caixa.
  creditLimit          Decimal?  @db.Decimal(14, 2)
  availableCreditLimit Decimal?  @db.Decimal(14, 2)
  statementClosingDate DateTime?
  statementDueDate     DateTime?
```

E a relação nova, junto de `transactions` e `goals`:

```prisma
  bills        CreditCardBill[]
```

Em `model Transaction`, depois de `transferPairId`:

```prisma
  /// creditCardMetadata da Pluggy quando o conector devolve; senão, o que o
  /// parser tira da descrição crua. Vive aqui, e não é reparseado a cada
  /// projeção, porque excluir parcela do cálculo da mediana é filtro de SQL.
  installmentIndex Int?
  installmentTotal Int?
  /// merchant.name da Pluggy. Null quando o conector não devolve.
  merchantName     String?
  /// merchantKey(description), materializado. Era recalculado em memória a cada
  /// consulta — e agrupar por comerciante precisa ser GROUP BY, não reduce.
  merchantKey      String?
```

E os índices, junto dos existentes de `Transaction`:

```prisma
  @@index([userId, merchantKey])
  @@index([userId, installmentTotal])
```

Em `model User`, junto das outras relações:

```prisma
  bills         CreditCardBill[]
```

E o model novo, depois de `CategorySuggestion`:

```prisma
/// Fatura de cartão vinda de `client.fetchCreditCardBills()`. Fatura fechada e
/// ainda não paga é a saída de caixa mais certa que a projeção tem: valor exato
/// e data exata, sem estimativa nenhuma no meio.
model CreditCardBill {
  id           String    @id @default(uuid())
  userId       String
  accountId    String
  pluggyBillId String?   @unique
  dueDate      DateTime
  closingDate  DateTime?
  totalAmount  Decimal   @db.Decimal(14, 2)
  paidAmount   Decimal   @default(0) @db.Decimal(14, 2)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([userId, dueDate])
}
```

- [ ] **Step 2: Escrever a migração SQL**

Crie `apps/api/prisma/migrations/20260822120000_saldo_projetado/migration.sql`:

```sql
-- O futuro entra no modelo.
--
-- Quatro coisas, que só fazem sentido juntas: a natureza da categoria (fixa ou
-- variável, o único sinal que separa comprometido de estimado), os dados de
-- cartão que o sync vinha descartando, a parcela e o comerciante materializados
-- na transação, e a fatura como entidade própria.

CREATE TYPE "CategoryNature" AS ENUM ('FIXED', 'VARIABLE');

ALTER TABLE "Category" ADD COLUMN "nature" "CategoryNature" NOT NULL DEFAULT 'VARIABLE';

ALTER TABLE "User" ADD COLUMN "safetyReserve" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "Account" ADD COLUMN "creditLimit" DECIMAL(14,2);
ALTER TABLE "Account" ADD COLUMN "availableCreditLimit" DECIMAL(14,2);
ALTER TABLE "Account" ADD COLUMN "statementClosingDate" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "statementDueDate" TIMESTAMP(3);

ALTER TABLE "Transaction" ADD COLUMN "installmentIndex" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "installmentTotal" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "merchantName" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "merchantKey" TEXT;

CREATE INDEX "Transaction_userId_merchantKey_idx" ON "Transaction"("userId", "merchantKey");
CREATE INDEX "Transaction_userId_installmentTotal_idx" ON "Transaction"("userId", "installmentTotal");

CREATE TABLE "CreditCardBill" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "pluggyBillId" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "closingDate" TIMESTAMP(3),
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditCardBill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditCardBill_pluggyBillId_key" ON "CreditCardBill"("pluggyBillId");
CREATE INDEX "CreditCardBill_userId_dueDate_idx" ON "CreditCardBill"("userId", "dueDate");

ALTER TABLE "CreditCardBill" ADD CONSTRAINT "CreditCardBill_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditCardBill" ADD CONSTRAINT "CreditCardBill_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Marcar as categorias padrão com a natureza certa**

Em `apps/api/src/lib/defaultCategories.ts`, troque a constante e o upsert:

```ts
import { CategoryNature, type PrismaClient } from "@prisma/client";

export const DEFAULT_CATEGORIES = [
  { name: "Renda", icon: "wallet", colorKey: "1", nature: CategoryNature.FIXED },
  { name: "Mercado", icon: "cart", colorKey: "1", nature: CategoryNature.VARIABLE },
  { name: "Moradia", icon: "home", colorKey: "4", nature: CategoryNature.FIXED },
  { name: "Transporte", icon: "car", colorKey: "2", nature: CategoryNature.VARIABLE },
  { name: "Lazer", icon: "film", colorKey: "3", nature: CategoryNature.VARIABLE },
  { name: "Restaurante", icon: "utensils", colorKey: "3", nature: CategoryNature.VARIABLE },
  { name: "Serviços", icon: "repeat", colorKey: "3", nature: CategoryNature.FIXED },
  { name: "Saúde", icon: "pulse", colorKey: "4", nature: CategoryNature.FIXED },
  { name: "Casa", icon: "sofa", colorKey: "5", nature: CategoryNature.VARIABLE },
  { name: "Eletrônicos", icon: "device", colorKey: "2", nature: CategoryNature.VARIABLE },
  { name: "Outros", icon: "dots", colorKey: "5", nature: CategoryNature.VARIABLE },
] as const;
```

No `upsert`, o `update` **não** deve escrever `nature` — reescrever a natureza a cada login desfaria a escolha do usuário. Só o `create` leva:

```ts
    await client.category.upsert({
      where: { userId_name: { userId, name: category.name } },
      update: { icon: category.icon, colorKey: category.colorKey },
      create: { ...category, userId },
    });
```

- [ ] **Step 4: Gerar o client e aplicar a migração**

```bash
npm run prisma:generate --workspace=apps/api
```

```bash
npx --workspace=apps/api prisma migrate deploy
```

Esperado: `1 migration found` e `applied`. Depois, `npx --workspace=apps/api prisma migrate status` deve dizer que o schema está em dia.

- [ ] **Step 5: Verificar que o projeto ainda compila**

Run: `npm run build --workspace=apps/api`
Expected: sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/lib/defaultCategories.ts
git commit -m "Schema do saldo projetado: natureza da categoria, dados de cartao e fatura"
```

---

### Task 2: Parser de parcelas

Função pura, sem banco. É fallback — o caminho normal é o metadado da Pluggy (Task 3) — mas precisa existir antes, porque o backfill das transações antigas depende só dele.

**Files:**
- Create: `apps/api/src/lib/projection/installments.ts`
- Test: `apps/api/src/lib/projection/installments.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `export interface ParsedInstallment { index: number; total: number }` e `export function parseInstallment(raw: string): ParsedInstallment | null`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/projection/installments.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseInstallment } from "./installments";

describe("parseInstallment", () => {
  it("lê o formato com a palavra PARC", () => {
    expect(parseInstallment("MAGALU PARC 3/12")).toEqual({ index: 3, total: 12 });
  });

  it("lê parcela escrita por extenso", () => {
    expect(parseInstallment("CASAS BAHIA PARCELA 2/6")).toEqual({ index: 2, total: 6 });
  });

  it("lê o formato nu, sem palavra nenhuma", () => {
    expect(parseInstallment("AMERICANAS 4/10")).toEqual({ index: 4, total: 10 });
  });

  it("lê entre parênteses e com zero à esquerda", () => {
    expect(parseInstallment("RENNER (03/12)")).toEqual({ index: 3, total: 12 });
  });

  it("tolera espaços em volta da barra", () => {
    expect(parseInstallment("LOJA 3 / 12")).toEqual({ index: 3, total: 12 });
  });

  // Os que NÃO podem casar. Cada um é um falso positivo que já apareceu em
  // extrato de verdade, e é por isso que o parser tem arquivo próprio.
  it("não confunde data completa com parcela", () => {
    expect(parseInstallment("PIX ENVIADO 03/08/2026")).toBeNull();
  });

  it("não confunde mês/ano com parcela", () => {
    expect(parseInstallment("MENSALIDADE 12/2026")).toBeNull();
  });

  it("recusa parcela única, que não é parcelamento", () => {
    expect(parseInstallment("COMPRA 1/1")).toBeNull();
  });

  it("recusa total absurdo", () => {
    expect(parseInstallment("ALGO 5/60")).toBeNull();
  });

  it("recusa índice maior que o total", () => {
    expect(parseInstallment("ALGO 13/12")).toBeNull();
  });

  it("devolve null quando não há nada parecido", () => {
    expect(parseInstallment("SUPERMERCADO CENTRAL")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste para ver falhar**

Run: `npm run test --workspace=apps/api -- installments`
Expected: FAIL — `Failed to resolve import "./installments"`.

- [ ] **Step 3: Implementar o parser**

Crie `apps/api/src/lib/projection/installments.ts`:

```ts
/**
 * Parcela lida da descrição **crua**.
 *
 * Fallback, e só: quando o conector devolve `creditCardMetadata`, a parcela vem
 * estruturada e este arquivo não é consultado. Ele existe para lançamento manual
 * e para conector que não devolve o metadado.
 *
 * A descrição precisa ser a crua, não a normalizada: `normalizeDescription` já
 * remove o padrão da parcela — é lixo para casar comerciante, e é justamente a
 * informação aqui.
 */

export interface ParsedInstallment {
  index: number;
  total: number;
}

/** Acima disso não é parcelamento de varejo; é data ou id de maquininha. */
const MAX_INSTALLMENTS = 48;

const PATTERN = /(?:parc(?:ela)?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})(?!\s*\/)(?!\d)/i;

export function parseInstallment(raw: string): ParsedInstallment | null {
  const match = PATTERN.exec(raw);
  if (!match) return null;

  const index = parseInt(match[1], 10);
  const total = parseInt(match[2], 10);

  // Total 1 não é parcelamento. Índice maior que o total é leitura errada de
  // outra coisa. E o teto corta "12/26" querendo dizer dezembro de 2026.
  if (total <= 1 || total > MAX_INSTALLMENTS) return null;
  if (index < 1 || index > total) return null;

  return { index, total };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm run test --workspace=apps/api -- installments`
Expected: PASS, 11 testes.

Se `"MENSALIDADE 12/2026"` ainda casar, o guarda `(?!\d)` não está pegando os quatro dígitos — confira que o lookahead está depois do segundo grupo e que o grupo é `\d{1,2}`, não `\d+`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/projection/installments.ts apps/api/src/lib/projection/installments.test.ts
git commit -m "Parser de parcela na descricao crua, com os guardas contra data"
```

---

### Task 3: O sync para de descartar

**Files:**
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts` (o `upsert` de conta por volta da linha 230, o de transação por volta da linha 281)
- Create: `apps/api/src/scripts/backfillProjectionFields.ts`

**Interfaces:**
- Consumes: `parseInstallment` de `lib/projection/installments.ts`; `merchantKey` de `lib/categorization/normalize.ts`.
- Produces: transações novas com `merchantKey`, `merchantName`, `installmentIndex`, `installmentTotal` preenchidos; contas de crédito com `creditLimit`, `availableCreditLimit`, `statementClosingDate`, `statementDueDate`; linhas em `CreditCardBill`.

- [ ] **Step 1: Gravar o `creditData` da conta**

Em `pluggy.service.ts`, no `prisma.account.upsert`, adicione os mesmos quatro campos ao `update` e ao `create`. Extraia antes do upsert:

```ts
    // A Pluggy publica valores novos antes de o SDK acompanhar, então o acesso é
    // defensivo — como já é em `mapAccountType`.
    const creditData = (pAccount as { creditData?: Record<string, unknown> | null }).creditData ?? null;
    const toDecimal = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) ? new Prisma.Decimal(v) : null;
    const toDate = (v: unknown) => {
      if (!v) return null;
      const d = new Date(v as string);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const creditFields = {
      creditLimit: toDecimal(creditData?.creditLimit),
      availableCreditLimit: toDecimal(creditData?.availableCreditLimit),
      statementClosingDate: toDate(creditData?.balanceCloseDate),
      statementDueDate: toDate(creditData?.balanceDueDate),
    };
```

E espalhe `...creditFields` no `update` e no `create` do upsert de conta.

- [ ] **Step 2: Gravar comerciante e parcela na transação**

No laço `for (const pTx of transactions)`, antes do upsert:

```ts
      // Metadado estruturado tem precedência sobre o parser: quando o conector
      // devolve a parcela, adivinhá-la a partir do texto só introduz erro.
      const meta = (pTx as { creditCardMetadata?: { installmentNumber?: number; totalInstallments?: number } | null })
        .creditCardMetadata ?? null;
      const parsed =
        meta?.installmentNumber && meta?.totalInstallments
          ? { index: meta.installmentNumber, total: meta.totalInstallments }
          : parseInstallment(pTx.descriptionRaw || pTx.description || "");

      const merchant = (pTx as { merchant?: { name?: string } | null }).merchant ?? null;

      const projectionFields = {
        installmentIndex: parsed?.index ?? null,
        installmentTotal: parsed?.total ?? null,
        merchantName: merchant?.name ?? null,
        merchantKey: merchantKey(description),
      };
```

Espalhe `...projectionFields` no `update` e no `create` do upsert de transação. Os imports no topo do arquivo:

```ts
import { merchantKey } from "../../lib/categorization/normalize";
import { parseInstallment } from "../../lib/projection/installments";
```

- [ ] **Step 3: Importar as faturas do cartão**

Depois do laço de transações da conta, dentro do mesmo `for` de contas, e **só para conta de crédito**:

```ts
    if (accountRecord.type === AccountType.CREDIT) {
      // Endpoint próprio: `fetchTransactions` não traz fatura. Sem ela a
      // projeção não sabe o valor exato do que já fechou e ainda não foi pago.
      try {
        const bills = await client.fetchCreditCardBills(pAccount.id);
        for (const bill of bills.results ?? []) {
          const paidAmount = (bill.payments ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);
          await prisma.creditCardBill.upsert({
            where: { pluggyBillId: bill.id },
            update: {
              dueDate: new Date(bill.dueDate),
              closingDate: bill.billClosingDate ? new Date(bill.billClosingDate) : null,
              totalAmount: new Prisma.Decimal(bill.totalAmount ?? 0),
              paidAmount: new Prisma.Decimal(paidAmount),
            },
            create: {
              userId,
              accountId: accountRecord.id,
              pluggyBillId: bill.id,
              dueDate: new Date(bill.dueDate),
              closingDate: bill.billClosingDate ? new Date(bill.billClosingDate) : null,
              totalAmount: new Prisma.Decimal(bill.totalAmount ?? 0),
              paidAmount: new Prisma.Decimal(paidAmount),
            },
          });
        }
      } catch (err: any) {
        // Nem todo conector expõe fatura. Falhar o sync inteiro por causa disso
        // tiraria do usuário também as transações, que chegaram bem.
        console.warn(`Faturas indisponíveis para a conta ${accountRecord.id}:`, err?.message || err);
      }
    }
```

- [ ] **Step 4: Escrever o script de backfill**

Crie `apps/api/src/scripts/backfillProjectionFields.ts`:

```ts
/**
 * Preenche `merchantKey`, `installmentIndex` e `installmentTotal` nas transações
 * que já existiam antes de o sync passar a gravá-los.
 *
 * Limite conhecido e sem conserto: `creditCardMetadata` não foi guardado, e a
 * Pluggy só devolve transação de uma janela recente. As linhas antigas só podem
 * ser preenchidas pelo parser da descrição; o metadado estruturado vale da
 * próxima sincronização em diante.
 *
 * Uso: npx tsx src/scripts/backfillProjectionFields.ts <userId>
 *
 * O userId é OBRIGATÓRIO. Este banco tem mais de uma conta real, e um UPDATE sem
 * escopo mexeria no histórico de outra pessoa.
 */
import { prisma } from "../prisma";
import { merchantKey } from "../lib/categorization/normalize";
import { parseInstallment } from "../lib/projection/installments";

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Informe o userId: npx tsx src/scripts/backfillProjectionFields.ts <userId>");
    process.exit(1);
  }

  const transactions = await prisma.transaction.findMany({
    where: { userId, merchantKey: null },
    select: { id: true, description: true },
  });

  console.log(`${transactions.length} transações a preencher para o usuário ${userId}.`);

  let comParcela = 0;
  for (const tx of transactions) {
    const parsed = parseInstallment(tx.description);
    if (parsed) comParcela++;
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        merchantKey: merchantKey(tx.description),
        installmentIndex: parsed?.index ?? null,
        installmentTotal: parsed?.total ?? null,
      },
    });
  }

  console.log(`Pronto. ${comParcela} reconhecidas como parcela.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 5: Compilar e rodar o backfill**

Run: `npm run build --workspace=apps/api`
Expected: sem erros de tipo. Se o SDK reclamar de `bills.results`, confira o retorno de `fetchCreditCardBills` — é um `PageResponse<CreditCardBills>`, com os itens em `results`.

Depois, com o `userId` real (pegue-o no banco ou no token da sessão):

```bash
npx --workspace=apps/api tsx src/scripts/backfillProjectionFields.ts <userId>
```

Expected: imprime a contagem e termina sem erro.

- [ ] **Step 6: Verificar à mão que o sync grava**

Suba a API (`npm run dev:api`), dispare o sync pelo app, e confira:

```bash
npx --workspace=apps/api prisma studio
```

Em `Transaction`, as linhas novas devem ter `merchantKey` preenchido. Em `Account`, uma conta `CREDIT` deve ter `statementDueDate`. Em `CreditCardBill`, deve haver linhas — a menos que o conector não exponha faturas, caso em que o log traz o aviso do Step 3.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/pluggy/pluggy.service.ts apps/api/src/scripts/backfillProjectionFields.ts
git commit -m "Sync passa a gravar comerciante, parcela, creditData e faturas"
```

---

### Task 4: `nature` na API de categorias

**Files:**
- Modify: `packages/shared/src/index.ts` (`CategoryDTO`, `CreateCategoryRequest`, `UpdateCategoryRequest`)
- Modify: `apps/api/src/modules/categories/categories.service.ts`
- Modify: `apps/api/src/modules/categories/categories.routes.ts`

**Interfaces:**
- Consumes: enum `CategoryNature` do Prisma (Task 1).
- Produces: `CategoryNature = "FIXED" | "VARIABLE"` exportado de `@poup/shared`; `CategoryDTO.nature`; `PATCH /api/categories/:id` aceitando `{ nature }`.

- [ ] **Step 1: Estender os tipos compartilhados**

Em `packages/shared/src/index.ts`, junto de `SystemCategoryKey`:

```ts
/** Fixa entra na projeção como comprometido; variável, como estimado. */
export type CategoryNature = "FIXED" | "VARIABLE";
```

E nos três lugares:

```ts
export interface CategoryDTO {
  id: string;
  name: string;
  icon: string;
  colorKey: string;
  systemKey: SystemCategoryKey | null;
  nature: CategoryNature;
}

export interface CreateCategoryRequest {
  name: string;
  icon?: string;
  colorKey?: string;
  nature?: CategoryNature;
}

export interface UpdateCategoryRequest {
  name?: string;
  icon?: string;
  colorKey?: string;
  nature?: CategoryNature;
}
```

- [ ] **Step 2: Escrever o teste que falha**

Crie `apps/api/src/modules/categories/categories.service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertNatureEditable } from "./categories.service";

describe("assertNatureEditable", () => {
  it("aceita natureza numa categoria comum", () => {
    expect(() => assertNatureEditable(null, "FIXED")).not.toThrow();
  });

  it("aceita quando a requisição nem menciona natureza", () => {
    expect(() => assertNatureEditable("TRANSFER", undefined)).not.toThrow();
  });

  it("recusa mudar a natureza de uma categoria de sistema", () => {
    // Projetar "Sem categoria" seria dar peso a uma dúvida, e "Transferência"
    // não é gasto. Nem uma nem outra pode ser marcada como fixa.
    expect(() => assertNatureEditable("UNCATEGORIZED", "FIXED")).toThrow(
      /categoria do sistema/i
    );
  });
});
```

- [ ] **Step 3: Rodar o teste para ver falhar**

Run: `npm run test --workspace=apps/api -- categories.service`
Expected: FAIL — `assertNatureEditable` não existe.

- [ ] **Step 4: Implementar**

Em `categories.service.ts`, exporte o guarda e use-o no update:

```ts
import { CategoryNature, SystemCategoryKey } from "@prisma/client";
import { ValidationError } from "../../lib/errors";

/**
 * Categoria de sistema não projeta, e por isso não tem natureza que valha.
 * Deixar marcar faria a UI oferecer um controle sem efeito.
 */
export function assertNatureEditable(
  systemKey: SystemCategoryKey | null,
  nature: CategoryNature | undefined
): void {
  if (nature && systemKey) {
    throw new ValidationError("Não dá para definir a natureza de uma categoria do sistema.");
  }
}
```

Confira o nome real da classe de erro em `apps/api/src/lib/errors.ts` e use a que já existe para 400 (se o projeto chamar de outro jeito, use aquela — não crie uma nova).

No `toDTO` da service, inclua `nature: category.nature`. No `updateCategory`, chame `assertNatureEditable(existing.systemKey, input.nature)` antes de gravar, e passe `nature` no `data`. No `createCategory`, passe `nature: input.nature ?? CategoryNature.VARIABLE`.

- [ ] **Step 5: Estender os schemas zod das rotas**

Em `categories.routes.ts`, nos dois schemas:

```ts
  nature: z.enum(["FIXED", "VARIABLE"]).optional(),
```

- [ ] **Step 6: Rodar os testes e compilar**

Run: `npm run test --workspace=apps/api -- categories.service`
Expected: PASS, 3 testes.

Run: `npm run build:shared && npm run build --workspace=apps/api`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/modules/categories
git commit -m "Categoria ganha natureza fixa/variavel na API"
```

---

### Task 5: Toggle fixa/variável na interface

**Files:**
- Modify: `apps/web/src/components/categories/CategoryFormModal.tsx`
- Modify: `apps/web/src/pages/CategoriesPage.tsx`

**Interfaces:**
- Consumes: `CategoryDTO.nature` e `UpdateCategoryRequest.nature` de `@poup/shared` (Task 4).
- Produces: nada que outras tasks consumam.

- [ ] **Step 1: Adicionar o campo ao formulário**

Em `CategoryFormModal.tsx`, junto do estado dos outros campos:

```tsx
const [nature, setNature] = useState<CategoryNature>(category?.nature ?? "VARIABLE");
```

E o controle, seguindo o `Field` que o modal já usa nos outros campos:

```tsx
<Field label="Natureza">
  <div className="flex gap-2">
    {(["FIXED", "VARIABLE"] as const).map((option) => (
      <button
        key={option}
        type="button"
        onClick={() => setNature(option)}
        aria-pressed={nature === option}
        className={`tap-target flex-1 rounded-xl border px-3 py-2 text-sm transition ${
          nature === option
            ? "border-brand bg-brand/10 text-brand"
            : "border-border text-muted hover:border-brand/40"
        }`}
      >
        {option === "FIXED" ? "Fixa" : "Variável"}
      </button>
    ))}
  </div>
  <p className="mt-1.5 text-xs text-muted">
    {nature === "FIXED"
      ? "Repete todo mês. Entra no seu comprometido do mês."
      : "Oscila. Entra como estimativa, pelo seu histórico."}
  </p>
</Field>
```

Use as classes de cor que o arquivo já usa nos outros controles — `brand`, `border`, `muted` são os tokens do projeto; se os nomes divergirem, siga os do arquivo.

Inclua `nature` no payload enviado no submit.

- [ ] **Step 2: Mostrar o rótulo na listagem**

Em `CategoriesPage.tsx`, no item de cada categoria e **só quando `systemKey` for null**, um `Badge` discreto:

```tsx
{!category.systemKey && (
  <Badge tone={category.nature === "FIXED" ? "info" : "neutral"}>
    {category.nature === "FIXED" ? "Fixa" : "Variável"}
  </Badge>
)}
```

Confira as `tone` disponíveis em `apps/web/src/components/ui/Badge.tsx` e use as que existem.

- [ ] **Step 3: Verificar no navegador**

Suba `npm run dev`, abra Categorias, edite uma categoria, marque "Fixa", salve, e recarregue: o badge deve continuar "Fixa". Abra uma categoria de sistema — o campo não deve aparecer.

- [ ] **Step 4: Compilar**

Run: `npm run build --workspace=apps/web`
Expected: sem erros de tipo.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/categories/CategoryFormModal.tsx apps/web/src/pages/CategoriesPage.tsx
git commit -m "Toggle fixa/variavel na categoria, e o rotulo na listagem"
```

---

### Task 6: Tipos do motor e medianas

**Files:**
- Create: `apps/api/src/lib/projection/types.ts`
- Create: `apps/api/src/lib/projection/medians.ts`
- Test: `apps/api/src/lib/projection/medians.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - de `types.ts`: `ProjectionNature`, `ProjectionSource`, `ProjectionEvent`, `DailyPoint`, `MonthContext`
  - de `medians.ts`: `median(values: number[]): number`, `closedMonthWindow(today: Date, firstMonth: string | null, maxMonths: number): string[]`, `monthlyMedian(observations: MonthlyObservation[], window: string[]): number`, `medianDayOfMonth(days: number[]): number`, `monthKeyOf(date: Date): string`

- [ ] **Step 1: Escrever os tipos**

Crie `apps/api/src/lib/projection/types.ts`:

```ts
export type TransactionType = "INCOME" | "EXPENSE";

/** Comprometido é explicável linha a linha; estimado vem do histórico. */
export type ProjectionNature = "committed" | "estimated";

export type ProjectionSource =
  | "merchant"
  | "category-residual"
  | "variable"
  | "installment"
  | "bill";

/**
 * A unidade de tudo. O motor produz uma lista destes, e cada leitura da UI é um
 * agrupamento ou uma acumulação sobre a mesma lista.
 */
export interface ProjectionEvent {
  date: Date;
  categoryId: string | null;
  categoryName: string;
  categoryIcon: string | null;
  categoryColorKey: string | null;
  type: TransactionType;
  amount: number;
  nature: ProjectionNature;
  source: ProjectionSource;
  label: string;
}

export interface DailyPoint {
  date: Date;
  /** true até hoje: reconstituído do saldo real, não projetado. */
  actual: boolean;
  balanceCommitted: number;
  balanceExpected: number;
}

export interface MonthContext {
  today: Date;
  /** Primeiro dia do mês corrente, UTC. */
  monthStart: Date;
  /** Último dia do mês corrente, UTC. */
  monthEnd: Date;
}
```

- [ ] **Step 2: Escrever o teste que falha**

Crie `apps/api/src/lib/projection/medians.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { closedMonthWindow, median, medianDayOfMonth, monthlyMedian } from "./medians";

const u = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

describe("median", () => {
  it("devolve o do meio numa lista ímpar", () => {
    expect(median([10, 30, 20])).toBe(20);
  });

  it("devolve a média dos dois do meio numa lista par", () => {
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it("devolve zero para lista vazia", () => {
    expect(median([])).toBe(0);
  });

  it("não se deixa levar por um mês fora da curva", () => {
    // O mês do notebook novo não pode virar custo de vida. A média daria 1220.
    expect(median([400, 420, 450, 430, 5400])).toBe(430);
  });
});

describe("closedMonthWindow", () => {
  it("devolve os meses fechados, sem o corrente", () => {
    expect(closedMonthWindow(u(2026, 8, 21), "2026-01", 6)).toEqual([
      "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
    ]);
  });

  it("nunca é mais longa que o histórico", () => {
    // Quem usa o app há três meses tem janela de três, não seis com metade
    // zerada — senão a mediana de todo mundo novo seria zero.
    expect(closedMonthWindow(u(2026, 8, 21), "2026-05", 6)).toEqual([
      "2026-05", "2026-06", "2026-07",
    ]);
  });

  it("é vazia quando só há o mês corrente", () => {
    expect(closedMonthWindow(u(2026, 8, 21), "2026-08", 6)).toEqual([]);
  });

  it("é vazia quando não há histórico nenhum", () => {
    expect(closedMonthWindow(u(2026, 8, 21), null, 6)).toEqual([]);
  });
});

describe("monthlyMedian", () => {
  it("conta como zero os meses sem movimento", () => {
    // A categoria esporádica — o IPVA que apareceu uma vez — cai para zero e não
    // projeta. É o comportamento certo num horizonte curto.
    const window = ["2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
    expect(monthlyMedian([{ month: "2026-04", amount: 1800 }], window)).toBe(0);
  });

  it("tira a mediana dos meses observados", () => {
    const window = ["2026-05", "2026-06", "2026-07"];
    expect(
      monthlyMedian(
        [
          { month: "2026-05", amount: 700 },
          { month: "2026-06", amount: 800 },
          { month: "2026-07", amount: 780 },
        ],
        window
      )
    ).toBe(780);
  });

  it("ignora observação fora da janela", () => {
    const window = ["2026-06", "2026-07"];
    expect(
      monthlyMedian(
        [
          { month: "2026-01", amount: 9999 },
          { month: "2026-06", amount: 100 },
          { month: "2026-07", amount: 200 },
        ],
        window
      )
    ).toBe(150);
  });

  it("devolve zero com janela vazia", () => {
    expect(monthlyMedian([{ month: "2026-07", amount: 500 }], [])).toBe(0);
  });
});

describe("medianDayOfMonth", () => {
  it("devolve o dia do meio", () => {
    expect(medianDayOfMonth([5, 6, 5])).toBe(5);
  });

  it("arredonda para baixo quando cai entre dois dias", () => {
    // Adiantar o compromisso é o erro seguro: a linha desce antes, não depois.
    expect(medianDayOfMonth([5, 10])).toBe(7);
  });

  it("devolve 1 para lista vazia", () => {
    expect(medianDayOfMonth([])).toBe(1);
  });
});
```

- [ ] **Step 3: Rodar o teste para ver falhar**

Run: `npm run test --workspace=apps/api -- medians`
Expected: FAIL — `Failed to resolve import "./medians"`.

- [ ] **Step 4: Implementar**

Crie `apps/api/src/lib/projection/medians.ts`:

```ts
/**
 * Mediana, e não média.
 *
 * Um extrato tem outliers por construção: o mês da viagem, o mês do notebook, o
 * mês do conserto do carro. A média transforma cada um deles em custo de vida
 * permanente; a mediana não.
 */

export interface MonthlyObservation {
  /** "YYYY-MM" */
  month: string;
  amount: number;
}

/** "2026-08" a partir de uma data, sempre em UTC (como as datas são gravadas). */
export function monthKeyOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Os meses fechados que entram no cálculo. O corrente fica fora — está pela
 * metade, e incluí-lo puxaria toda mediana para baixo.
 */
export function closedMonthWindow(
  today: Date,
  firstMonth: string | null,
  maxMonths: number
): string[] {
  if (!firstMonth) return [];

  const months: string[] = [];
  // Começa no mês anterior ao corrente e anda para trás.
  for (let back = 1; back <= maxMonths; back++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, 1));
    const key = monthKeyOf(d);
    if (key < firstMonth) break;
    months.unshift(key);
  }
  return months;
}

/** Meses da janela sem observação valem zero — é o que zera a categoria esporádica. */
export function monthlyMedian(
  observations: MonthlyObservation[],
  window: string[]
): number {
  if (window.length === 0) return 0;
  const byMonth = new Map(observations.map((o) => [o.month, o.amount]));
  return median(window.map((month) => byMonth.get(month) ?? 0));
}

/** Em que dia do mês a coisa costuma cair. Empate arredonda para baixo. */
export function medianDayOfMonth(days: number[]): number {
  if (days.length === 0) return 1;
  return Math.max(1, Math.floor(median(days)));
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npm run test --workspace=apps/api -- medians`
Expected: PASS, 15 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/projection/types.ts apps/api/src/lib/projection/medians.ts apps/api/src/lib/projection/medians.test.ts
git commit -m "Motor de projecao: tipos e medianas com meses zerados na janela"
```

---

### Task 7: O calendário de eventos

**Files:**
- Modify: `apps/api/src/lib/projection/installments.ts` (acrescenta a projeção das parcelas restantes)
- Create: `apps/api/src/lib/projection/events.ts`
- Test: `apps/api/src/lib/projection/events.test.ts`
- Test: `apps/api/src/lib/projection/installments.test.ts` (acrescenta casos)

**Interfaces:**
- Consumes: `ProjectionEvent`, `MonthContext` de `types.ts`; `parseInstallment` de `installments.ts`.
- Produces:
  - de `installments.ts`: `InstallmentGroup`, `InstallmentOccurrence`, `remainingInstallments(group: InstallmentGroup, horizonEnd: Date): InstallmentOccurrence[]`
  - de `events.ts`: `FixedMerchantInput`, `CategoryInput`, `variableRemaining(args): number`, `fixedCategoryEvents(category: CategoryInput, ctx: MonthContext): ProjectionEvent[]`, `variableCategoryEvents(category: CategoryInput, ctx: MonthContext): ProjectionEvent[]`, `installmentEvents(occurrences: InstallmentOccurrence[]): ProjectionEvent[]`

- [ ] **Step 1: Escrever o teste das parcelas restantes**

Acrescente a `apps/api/src/lib/projection/installments.test.ts`:

```ts
import { remainingInstallments, type InstallmentGroup } from "./installments";

const u = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const grupo = (over: Partial<InstallmentGroup> = {}): InstallmentGroup => ({
  merchantKey: "magalu",
  merchantName: "Magalu",
  total: 12,
  amount: 250,
  lastIndex: 10,
  lastDate: u(2026, 8, 15),
  categoryId: "cat-eletro",
  isCredit: true,
  ...over,
});

describe("remainingInstallments", () => {
  it("projeta as que faltam, uma por mês, mesmo dia", () => {
    const restantes = remainingInstallments(grupo(), u(2026, 12, 31));
    expect(restantes.map((r) => [r.index, r.date.toISOString().slice(0, 10)])).toEqual([
      [11, "2026-09-15"],
      [12, "2026-10-15"],
    ]);
  });

  it("mantém o valor da parcela", () => {
    expect(remainingInstallments(grupo(), u(2026, 12, 31))[0].amount).toBe(250);
  });

  it("não passa do horizonte", () => {
    expect(remainingInstallments(grupo({ lastIndex: 1 }), u(2026, 10, 31))).toHaveLength(2);
  });

  it("devolve vazio quando a última parcela já caiu", () => {
    expect(remainingInstallments(grupo({ lastIndex: 12 }), u(2026, 12, 31))).toEqual([]);
  });

  it("preserva o dia 31 nos meses curtos, sem vazar para o mês seguinte", () => {
    // new Date(Date.UTC(2026, 1, 31)) viraria 3 de março. Um parcelamento que cai
    // dia 31 tem de cair no último dia de fevereiro, não em março.
    const restantes = remainingInstallments(
      grupo({ lastIndex: 1, total: 3, lastDate: u(2026, 1, 31) }),
      u(2026, 5, 31)
    );
    expect(restantes.map((r) => r.date.toISOString().slice(0, 10))).toEqual([
      "2026-02-28",
      "2026-03-31",
    ]);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm run test --workspace=apps/api -- installments`
Expected: FAIL — `remainingInstallments` não é exportado.

- [ ] **Step 3: Implementar as parcelas restantes**

Acrescente ao fim de `apps/api/src/lib/projection/installments.ts`:

```ts
export interface InstallmentGroup {
  merchantKey: string;
  merchantName: string;
  total: number;
  /** Valor de uma parcela. */
  amount: number;
  /** A maior parcela já vista no histórico. */
  lastIndex: number;
  lastDate: Date;
  categoryId: string | null;
  /** Parcela de cartão entra na fatura; de conta corrente, vira evento de caixa. */
  isCredit: boolean;
}

export interface InstallmentOccurrence {
  date: Date;
  amount: number;
  index: number;
  total: number;
  merchantName: string;
  categoryId: string | null;
  isCredit: boolean;
}

/** Soma meses preservando o dia; mês curto recebe o último dia que couber. */
function addMonthsKeepingDay(base: Date, months: number): Date {
  const day = base.getUTCDate();
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDayOfTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDayOfTarget))
  );
}

/** Uma por mês, mesmo valor, mesmo dia — até o fim do parcelamento ou do horizonte. */
export function remainingInstallments(
  group: InstallmentGroup,
  horizonEnd: Date
): InstallmentOccurrence[] {
  const occurrences: InstallmentOccurrence[] = [];

  for (let index = group.lastIndex + 1; index <= group.total; index++) {
    const date = addMonthsKeepingDay(group.lastDate, index - group.lastIndex);
    if (date > horizonEnd) break;
    occurrences.push({
      date,
      amount: group.amount,
      index,
      total: group.total,
      merchantName: group.merchantName,
      categoryId: group.categoryId,
      isCredit: group.isCredit,
    });
  }

  return occurrences;
}
```

- [ ] **Step 4: Rodar e confirmar**

Run: `npm run test --workspace=apps/api -- installments`
Expected: PASS, 16 testes.

- [ ] **Step 5: Escrever o teste do calendário**

Crie `apps/api/src/lib/projection/events.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  fixedCategoryEvents,
  installmentEvents,
  variableCategoryEvents,
  variableRemaining,
  type CategoryInput,
} from "./events";
import type { MonthContext } from "./types";

const u = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** Dia 20 de agosto: 20 dias decorridos, 11 restantes (21 a 31). */
const ctx: MonthContext = {
  today: u(2026, 8, 20),
  monthStart: u(2026, 8, 1),
  monthEnd: u(2026, 8, 31),
};

const categoria = (over: Partial<CategoryInput> = {}): CategoryInput => ({
  categoryId: "cat-1",
  categoryName: "Moradia",
  categoryIcon: "home",
  categoryColorKey: "4",
  type: "EXPENSE",
  nature: "FIXED",
  medianMonthly: 1900,
  spentThisMonth: 0,
  merchants: [],
  ...over,
});

describe("variableRemaining", () => {
  it("segue a mediana quando o mês está devagar", () => {
    // Dia 25, gastou 200 de uma mediana de 800: pelo ritmo daria 48, pela
    // mediana 600. A mediana segura o número.
    expect(
      variableRemaining({
        medianMonthly: 800,
        spentSoFar: 200,
        elapsedDays: 25,
        remainingDays: 6,
        type: "EXPENSE",
      })
    ).toBe(600);
  });

  it("segue o ritmo quando a mediana já estourou", () => {
    // Gastou 900 de uma mediana de 800 no dia 10. Pela mediana projetaria zero
    // para o resto do mês, o que é absurdo.
    expect(
      variableRemaining({
        medianMonthly: 800,
        spentSoFar: 900,
        elapsedDays: 10,
        remainingDays: 21,
        type: "EXPENSE",
      })
    ).toBe(1890);
  });

  it("nunca devolve negativo", () => {
    expect(
      variableRemaining({
        medianMonthly: 100,
        spentSoFar: 500,
        elapsedDays: 31,
        remainingDays: 0,
        type: "EXPENSE",
      })
    ).toBe(0);
  });

  it("para receita fica com a leitura menor", () => {
    // Receita projetada para cima é a mesma mentira com outro sinal. Pela
    // mediana faltariam 3000; pelo ritmo, 1000/20×11 = 550. Fica 550.
    expect(
      variableRemaining({
        medianMonthly: 4000,
        spentSoFar: 1000,
        elapsedDays: 20,
        remainingDays: 11,
        type: "INCOME",
      })
    ).toBe(550);
  });
});

describe("fixedCategoryEvents", () => {
  it("gera um evento por comerciante recorrente, no dia mediano dele", () => {
    const events = fixedCategoryEvents(
      categoria({
        merchants: [
          { merchantKey: "aluguel", merchantName: "Aluguel", medianAmount: 1500, medianDay: 25, paidThisMonth: false },
          { merchantKey: "condominio", merchantName: "Condomínio", medianAmount: 400, medianDay: 28, paidThisMonth: false },
        ],
      }),
      ctx
    );

    const porComerciante = events.filter((e) => e.source === "merchant");
    expect(porComerciante.map((e) => [e.label, e.amount, e.date.getUTCDate()])).toEqual([
      ["Aluguel", 1500, 25],
      ["Condomínio", 400, 28],
    ]);
    expect(porComerciante.every((e) => e.nature === "committed")).toBe(true);
  });

  it("não reprojeta a fixa que já foi paga neste mês", () => {
    const events = fixedCategoryEvents(
      categoria({
        medianMonthly: 1500,
        spentThisMonth: 1500,
        merchants: [
          { merchantKey: "aluguel", merchantName: "Aluguel", medianAmount: 1500, medianDay: 5, paidThisMonth: true },
        ],
      }),
      ctx
    );
    expect(events.filter((e) => e.source === "merchant")).toEqual([]);
  });

  it("manda para amanhã a fixa cujo dia passou sem aparecer", () => {
    // Atrasado não é cancelado.
    const events = fixedCategoryEvents(
      categoria({
        merchants: [
          { merchantKey: "aluguel", merchantName: "Aluguel", medianAmount: 1500, medianDay: 5, paidThisMonth: false },
        ],
      }),
      ctx
    );
    expect(events[0].date).toEqual(u(2026, 8, 21));
  });

  it("fecha a diferença entre a categoria e os comerciantes com um resíduo estimado", () => {
    // Mediana da categoria 1900, comerciantes explicam 1900... menos 300.
    const events = fixedCategoryEvents(
      categoria({
        medianMonthly: 1900,
        merchants: [
          { merchantKey: "aluguel", merchantName: "Aluguel", medianAmount: 1200, medianDay: 25, paidThisMonth: false },
          { merchantKey: "condominio", merchantName: "Condomínio", medianAmount: 400, medianDay: 26, paidThisMonth: false },
        ],
      }),
      ctx
    );
    const residuo = events.find((e) => e.source === "category-residual");
    expect(residuo?.amount).toBe(300);
    expect(residuo?.nature).toBe("estimated");
  });

  it("não gera resíduo quando os comerciantes já explicam a categoria inteira", () => {
    const events = fixedCategoryEvents(
      categoria({
        medianMonthly: 1600,
        merchants: [
          { merchantKey: "aluguel", merchantName: "Aluguel", medianAmount: 1200, medianDay: 25, paidThisMonth: false },
          { merchantKey: "condominio", merchantName: "Condomínio", medianAmount: 400, medianDay: 26, paidThisMonth: false },
        ],
      }),
      ctx
    );
    expect(events.find((e) => e.source === "category-residual")).toBeUndefined();
  });
});

describe("variableCategoryEvents", () => {
  it("distribui o restante por igual entre os dias que faltam", () => {
    // Mediana 620, nada gasto: restam 620 para 11 dias.
    const events = variableCategoryEvents(
      categoria({
        categoryName: "Mercado",
        nature: "VARIABLE",
        medianMonthly: 620,
        spentThisMonth: 0,
      }),
      ctx
    );
    expect(events).toHaveLength(11);
    expect(events.every((e) => e.nature === "estimated")).toBe(true);
    expect(events.every((e) => e.source === "variable")).toBe(true);
    const soma = events.reduce((s, e) => s + e.amount, 0);
    expect(soma).toBeCloseTo(620, 2);
    expect(events[0].date).toEqual(u(2026, 8, 21));
    expect(events[10].date).toEqual(u(2026, 8, 31));
  });

  it("não gera evento nenhum quando não sobra nada a projetar", () => {
    const events = variableCategoryEvents(
      categoria({ nature: "VARIABLE", medianMonthly: 0, spentThisMonth: 0 }),
      ctx
    );
    expect(events).toEqual([]);
  });
});

describe("installmentEvents", () => {
  it("converte só as parcelas de conta corrente em evento de caixa", () => {
    // A do cartão vai para a fatura; contá-la aqui também dobraria o valor.
    const events = installmentEvents([
      {
        date: u(2026, 9, 15), amount: 250, index: 11, total: 12,
        merchantName: "Magalu", categoryId: "cat-eletro", isCredit: true,
      },
      {
        date: u(2026, 9, 10), amount: 180, index: 4, total: 10,
        merchantName: "Crediário Móveis", categoryId: "cat-casa", isCredit: false,
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Crediário Móveis — parcela 4/10");
    expect(events[0].nature).toBe("committed");
    expect(events[0].source).toBe("installment");
  });
});
```

- [ ] **Step 6: Rodar para ver falhar**

Run: `npm run test --workspace=apps/api -- events`
Expected: FAIL — `Failed to resolve import "./events"`.

- [ ] **Step 7: Implementar o calendário**

Crie `apps/api/src/lib/projection/events.ts`:

```ts
import type { InstallmentOccurrence } from "./installments";
import type { MonthContext, ProjectionEvent, TransactionType } from "./types";

export interface FixedMerchantInput {
  merchantKey: string;
  merchantName: string;
  /** Mediana das ocorrências dele na janela. */
  medianAmount: number;
  /** Dia do mês em que ele costuma cair. */
  medianDay: number;
  /** Já apareceu no mês corrente? Fixa paga não se repete no mesmo mês. */
  paidThisMonth: boolean;
}

export interface CategoryInput {
  categoryId: string;
  categoryName: string;
  categoryIcon: string | null;
  categoryColorKey: string | null;
  type: TransactionType;
  nature: "FIXED" | "VARIABLE";
  /** Mediana mensal da categoria inteira, no universo caixa. */
  medianMonthly: number;
  /** Soma da categoria no mês corrente até hoje. */
  spentThisMonth: number;
  /** Vazio nas categorias variáveis. */
  merchants: FixedMerchantInput[];
}

/**
 * Quanto ainda falta acontecer no mês, pela leitura mais pessimista.
 *
 * Duas leituras: a mediana diz que o mês fecha no de sempre; o ritmo diz que
 * fecha no que está acontecendo. Para despesa vale a maior — subestimar despesa
 * é o que faz alguém gastar dinheiro que não tem. Para receita vale a menor,
 * pela razão invertida.
 */
export function variableRemaining(args: {
  medianMonthly: number;
  spentSoFar: number;
  elapsedDays: number;
  remainingDays: number;
  type: TransactionType;
}): number {
  const { medianMonthly, spentSoFar, elapsedDays, remainingDays, type } = args;
  if (remainingDays <= 0) return 0;

  const byMedian = Math.max(0, medianMonthly - spentSoFar);
  const byRunRate =
    elapsedDays > 0 ? (spentSoFar / elapsedDays) * remainingDays : 0;

  const chosen = type === "EXPENSE"
    ? Math.max(byMedian, byRunRate)
    : Math.min(byMedian, byRunRate);

  return Math.max(0, chosen);
}

function daysRemaining(ctx: MonthContext): Date[] {
  const days: Date[] = [];
  for (let d = ctx.today.getUTCDate() + 1; d <= ctx.monthEnd.getUTCDate(); d++) {
    days.push(new Date(Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), d)));
  }
  return days;
}

function baseEvent(category: CategoryInput) {
  return {
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    categoryIcon: category.categoryIcon,
    categoryColorKey: category.categoryColorKey,
    type: category.type,
  };
}

/**
 * Categoria fixa projeta por comerciante. "Moradia" não é um número: é aluguel
 * dia 5, condomínio dia 10, e o que sobra.
 */
export function fixedCategoryEvents(
  category: CategoryInput,
  ctx: MonthContext
): ProjectionEvent[] {
  const events: ProjectionEvent[] = [];
  let explained = 0;

  for (const merchant of category.merchants) {
    explained += merchant.medianAmount;
    if (merchant.paidThisMonth) continue;

    const lastDay = ctx.monthEnd.getUTCDate();
    const day = Math.min(merchant.medianDay, lastDay);
    let date = new Date(Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), day));

    // Dia que já passou e o gasto não apareceu: vai para amanhã. Atrasado não é
    // cancelado — e deixá-lo no passado sumiria com ele da linha adiante.
    if (date <= ctx.today) {
      date = new Date(Date.UTC(ctx.today.getUTCFullYear(), ctx.today.getUTCMonth(), ctx.today.getUTCDate() + 1));
    }

    events.push({
      ...baseEvent(category),
      date,
      amount: merchant.medianAmount,
      nature: "committed",
      source: "merchant",
      label: merchant.merchantName,
    });
  }

  // O que a categoria gasta e nenhum comerciante recorrente explica. Sem isso o
  // motor subestimaria a categoria; somando a categoria inteira MAIS os
  // comerciantes, contaria duas vezes. A subtração é o que fecha os dois lados.
  const residual = Math.max(0, category.medianMonthly - explained - category.spentThisMonth);
  if (residual > 0) {
    const days = daysRemaining(ctx);
    if (days.length > 0) {
      events.push({
        ...baseEvent(category),
        date: days[days.length - 1],
        amount: residual,
        nature: "estimated",
        source: "category-residual",
        label: `Outros de ${category.categoryName}`,
      });
    }
  }

  return events;
}

/**
 * Categoria variável vira uma chuva fina: o restante do mês distribuído por
 * igual entre os dias que faltam. É isso que faz a linha descer suave em vez de
 * dar um degrau no fim do mês.
 */
export function variableCategoryEvents(
  category: CategoryInput,
  ctx: MonthContext
): ProjectionEvent[] {
  const days = daysRemaining(ctx);
  if (days.length === 0) return [];

  const elapsedDays = ctx.today.getUTCDate();
  const remaining = variableRemaining({
    medianMonthly: category.medianMonthly,
    spentSoFar: category.spentThisMonth,
    elapsedDays,
    remainingDays: days.length,
    type: category.type,
  });

  if (remaining <= 0) return [];

  const perDay = remaining / days.length;
  return days.map((date) => ({
    ...baseEvent(category),
    date,
    amount: perDay,
    nature: "estimated" as const,
    source: "variable" as const,
    label: category.categoryName,
  }));
}

/**
 * Só as parcelas de conta corrente viram evento de caixa. As de cartão entram na
 * fatura (ver `bills.ts`); contá-las aqui também dobraria o valor.
 */
export function installmentEvents(
  occurrences: InstallmentOccurrence[]
): ProjectionEvent[] {
  return occurrences
    .filter((o) => !o.isCredit)
    .map((o) => ({
      date: o.date,
      categoryId: o.categoryId,
      categoryName: o.merchantName,
      categoryIcon: null,
      categoryColorKey: null,
      type: "EXPENSE" as const,
      amount: o.amount,
      nature: "committed" as const,
      source: "installment" as const,
      label: `${o.merchantName} — parcela ${o.index}/${o.total}`,
    }));
}
```

- [ ] **Step 8: Rodar os testes**

Run: `npm run test --workspace=apps/api -- events`
Expected: PASS, 11 testes.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/projection/events.ts apps/api/src/lib/projection/events.test.ts apps/api/src/lib/projection/installments.ts apps/api/src/lib/projection/installments.test.ts
git commit -m "Calendario de eventos: fixa por comerciante com residuo, variavel pelo pior caso"
```

---

### Task 8: O ciclo do cartão

**Files:**
- Create: `apps/api/src/lib/projection/bills.ts`
- Test: `apps/api/src/lib/projection/bills.test.ts`

**Interfaces:**
- Consumes: `ProjectionEvent` de `types.ts`; `InstallmentOccurrence` de `installments.ts`.
- Produces: `ClosedBill`, `CardInput`, `CardSummary`, `limitBreachDate(args): Date | null`, `cardEvents(card: CardInput, ctx: { today: Date; horizonEnd: Date }): { events: ProjectionEvent[]; summary: CardSummary }`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/projection/bills.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cardEvents, limitBreachDate, type CardInput } from "./bills";

const u = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const ctx = { today: u(2026, 8, 20), horizonEnd: u(2026, 11, 30) };

const cartao = (over: Partial<CardInput> = {}): CardInput => ({
  accountId: "acc-1",
  accountName: "Nubank",
  statementClosingDate: u(2026, 8, 28),
  statementDueDate: u(2026, 9, 5),
  creditLimit: 5000,
  closedBills: [],
  openCycleSoFar: 1200,
  dailyCardRate: 60,
  medianBill: 2400,
  futureInstallments: [],
  ...over,
});

describe("cardEvents", () => {
  it("transforma fatura fechada e não paga em comprometido, na data exata", () => {
    const { events } = cardEvents(
      cartao({ closedBills: [{ dueDate: u(2026, 8, 25), totalAmount: 1800, paidAmount: 0 }] }),
      ctx
    );
    const fechada = events.find((e) => e.nature === "committed");
    expect(fechada?.amount).toBe(1800);
    expect(fechada?.date).toEqual(u(2026, 8, 25));
    expect(fechada?.source).toBe("bill");
  });

  it("desconta o que já foi pago da fatura fechada", () => {
    const { events } = cardEvents(
      cartao({ closedBills: [{ dueDate: u(2026, 8, 25), totalAmount: 1800, paidAmount: 500 }] }),
      ctx
    );
    expect(events.find((e) => e.nature === "committed")?.amount).toBe(1300);
  });

  it("ignora fatura já quitada", () => {
    const { events } = cardEvents(
      cartao({ closedBills: [{ dueDate: u(2026, 8, 25), totalAmount: 1800, paidAmount: 1800 }] }),
      ctx
    );
    expect(events.some((e) => e.nature === "committed")).toBe(false);
  });

  it("ignora fatura cujo vencimento já passou", () => {
    // Já saiu do caixa, ou virou dívida antiga — nos dois casos não é evento futuro.
    const { events } = cardEvents(
      cartao({ closedBills: [{ dueDate: u(2026, 8, 10), totalAmount: 900, paidAmount: 0 }] }),
      ctx
    );
    expect(events.some((e) => e.date < ctx.today)).toBe(false);
  });

  it("projeta o ciclo aberto pelo que falta até o fechamento", () => {
    // Fecha dia 28; de 21 a 28 são 8 dias a 60/dia = 480, mais os 1200 já gastos.
    const { summary } = cardEvents(cartao(), ctx);
    expect(summary.openSoFar).toBe(1200);
    expect(summary.openProjected).toBe(1680);
  });

  it("lança o ciclo aberto como estimado, no vencimento", () => {
    const { events } = cardEvents(cartao(), ctx);
    const aberto = events.find((e) => e.nature === "estimated");
    expect(aberto?.date).toEqual(u(2026, 9, 5));
    expect(aberto?.amount).toBe(1680);
  });

  it("soma as parcelas conhecidas ao ciclo futuro", () => {
    const { events } = cardEvents(
      cartao({
        futureInstallments: [
          { date: u(2026, 9, 15), amount: 250, index: 11, total: 12, merchantName: "Magalu", categoryId: null, isCredit: true },
        ],
      }),
      ctx
    );
    // O ciclo que fecha em setembro vence em outubro: mediana 2400 + parcela 250.
    const outubro = events.find((e) => e.date.getUTCMonth() === 9);
    expect(outubro?.amount).toBe(2650);
  });

  it("declara o cartão fora quando não há creditData nem fatura", () => {
    const { events, summary } = cardEvents(
      cartao({ statementClosingDate: null, statementDueDate: null, closedBills: [] }),
      ctx
    );
    expect(events).toEqual([]);
    expect(summary.excludedReason).toBe("no-credit-data");
  });
});

describe("limitBreachDate", () => {
  it("acha o dia em que o ciclo cruza o limite no ritmo atual", () => {
    // 4200 usados, limite 5000, 200/dia: cruza em 4 dias.
    expect(
      limitBreachDate({
        soFar: 4200,
        dailyRate: 200,
        creditLimit: 5000,
        today: u(2026, 8, 20),
        closingDate: u(2026, 8, 28),
      })
    ).toEqual(u(2026, 8, 24));
  });

  it("devolve null quando o ritmo não chega ao limite antes do fechamento", () => {
    expect(
      limitBreachDate({
        soFar: 1000,
        dailyRate: 50,
        creditLimit: 5000,
        today: u(2026, 8, 20),
        closingDate: u(2026, 8, 28),
      })
    ).toBeNull();
  });

  it("devolve null quando o limite é desconhecido", () => {
    expect(
      limitBreachDate({
        soFar: 4200, dailyRate: 200, creditLimit: null,
        today: u(2026, 8, 20), closingDate: u(2026, 8, 28),
      })
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm run test --workspace=apps/api -- bills`
Expected: FAIL — `Failed to resolve import "./bills"`.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/lib/projection/bills.ts`:

```ts
/**
 * O cartão em três camadas, da mais certa para a mais estimada.
 *
 * Compra no cartão não é saída de caixa no dia da compra: é fatura no dia do
 * vencimento. Este arquivo é o que traduz uma coisa na outra — e é por ele que
 * as transações de conta de crédito nunca viram evento de caixa direto.
 */
import type { InstallmentOccurrence } from "./installments";
import type { ProjectionEvent } from "./types";

export interface ClosedBill {
  dueDate: Date;
  totalAmount: number;
  paidAmount: number;
}

export interface CardInput {
  accountId: string;
  accountName: string;
  statementClosingDate: Date | null;
  statementDueDate: Date | null;
  creditLimit: number | null;
  closedBills: ClosedBill[];
  /** Soma das transações do cartão desde o último fechamento. */
  openCycleSoFar: number;
  /** Gasto mediano por dia neste cartão, para prorratear o resto do ciclo. */
  dailyCardRate: number;
  /** Mediana das faturas anteriores, base dos ciclos futuros. */
  medianBill: number;
  /** Parcelas conhecidas que caem em ciclos futuros deste cartão. */
  futureInstallments: InstallmentOccurrence[];
}

export interface CardSummary {
  accountId: string;
  accountName: string;
  closedAmount: number | null;
  closedDueDate: Date | null;
  openSoFar: number;
  openProjected: number;
  openClosingDate: Date | null;
  openDueDate: Date | null;
  creditLimit: number | null;
  limitBreachDate: Date | null;
  excludedReason: "no-credit-data" | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / DAY_MS));
}

function addMonths(base: Date, months: number): Date {
  const lastDay = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months + 1, 0)
  ).getUTCDate();
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth() + months,
      Math.min(base.getUTCDate(), lastDay)
    )
  );
}

/** O dia em que o acumulado do ciclo cruza o limite, mantido o ritmo atual. */
export function limitBreachDate(args: {
  soFar: number;
  dailyRate: number;
  creditLimit: number | null;
  today: Date;
  closingDate: Date | null;
}): Date | null {
  const { soFar, dailyRate, creditLimit, today, closingDate } = args;
  if (creditLimit === null || dailyRate <= 0 || soFar >= creditLimit) return null;

  const daysToBreach = Math.ceil((creditLimit - soFar) / dailyRate);
  const breach = new Date(today.getTime() + daysToBreach * DAY_MS);

  if (closingDate && breach > closingDate) return null;
  return breach;
}

export function cardEvents(
  card: CardInput,
  ctx: { today: Date; horizonEnd: Date }
): { events: ProjectionEvent[]; summary: CardSummary } {
  const events: ProjectionEvent[] = [];

  const base = {
    categoryId: null,
    categoryName: card.accountName,
    categoryIcon: null,
    categoryColorKey: null,
    type: "EXPENSE" as const,
    source: "bill" as const,
  };

  // Camada 1: fatura fechada e não paga. Valor exato, data exata — a saída de
  // caixa mais certa que a projeção tem.
  const pending = card.closedBills
    .filter((b) => b.dueDate >= ctx.today && b.totalAmount > b.paidAmount)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  let closedAmount: number | null = null;
  let closedDueDate: Date | null = null;

  for (const bill of pending) {
    const amount = bill.totalAmount - bill.paidAmount;
    if (closedAmount === null) {
      closedAmount = amount;
      closedDueDate = bill.dueDate;
    }
    events.push({
      ...base,
      date: bill.dueDate,
      amount,
      nature: "committed",
      label: `Fatura ${card.accountName} — fechada`,
    });
  }

  // Sem creditData e sem fatura o motor não sabe *quando* o cartão vira caixa.
  // Ficar de fora e dizer que ficou é melhor que inventar uma data.
  if (!card.statementDueDate && pending.length === 0) {
    return {
      events: [],
      summary: {
        accountId: card.accountId,
        accountName: card.accountName,
        closedAmount: null,
        closedDueDate: null,
        openSoFar: card.openCycleSoFar,
        openProjected: card.openCycleSoFar,
        openClosingDate: null,
        openDueDate: null,
        creditLimit: card.creditLimit,
        limitBreachDate: null,
        excludedReason: "no-credit-data",
      },
    };
  }

  // Camada 2: o ciclo aberto. O que já entrou, mais o ritmo até o fechamento.
  const daysToClose = card.statementClosingDate
    ? daysBetween(ctx.today, card.statementClosingDate)
    : 0;
  const openProjected = card.openCycleSoFar + card.dailyCardRate * daysToClose;

  if (card.statementDueDate && card.statementDueDate >= ctx.today && openProjected > 0) {
    events.push({
      ...base,
      date: card.statementDueDate,
      amount: openProjected,
      nature: "estimated",
      label: `Fatura ${card.accountName} — ciclo aberto`,
    });
  }

  // Camada 3: ciclos futuros. Mediana das faturas anteriores, mais as parcelas
  // conhecidas que caem naquele ciclo.
  if (card.statementDueDate) {
    for (let ahead = 1; ; ahead++) {
      const dueDate = addMonths(card.statementDueDate, ahead);
      if (dueDate > ctx.horizonEnd) break;

      const cycleStart = addMonths(card.statementDueDate, ahead - 1);
      const installments = card.futureInstallments
        .filter((i) => i.date > cycleStart && i.date <= dueDate)
        .reduce((sum, i) => sum + i.amount, 0);

      const amount = card.medianBill + installments;
      if (amount <= 0) continue;

      events.push({
        ...base,
        date: dueDate,
        amount,
        nature: "estimated",
        label: `Fatura ${card.accountName} — estimada`,
      });
    }
  }

  return {
    events,
    summary: {
      accountId: card.accountId,
      accountName: card.accountName,
      closedAmount,
      closedDueDate,
      openSoFar: card.openCycleSoFar,
      openProjected,
      openClosingDate: card.statementClosingDate,
      openDueDate: card.statementDueDate,
      creditLimit: card.creditLimit,
      limitBreachDate: limitBreachDate({
        soFar: card.openCycleSoFar,
        dailyRate: card.dailyCardRate,
        creditLimit: card.creditLimit,
        today: ctx.today,
        closingDate: card.statementClosingDate,
      }),
      excludedReason: null,
    },
  };
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm run test --workspace=apps/api -- bills`
Expected: PASS, 11 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/projection/bills.ts apps/api/src/lib/projection/bills.test.ts
git commit -m "Ciclo do cartao: fatura fechada, ciclo aberto e ciclos futuros"
```

---

### Task 9: A linha de saldo

**Files:**
- Create: `apps/api/src/lib/projection/balance.ts`
- Test: `apps/api/src/lib/projection/balance.test.ts`

**Interfaces:**
- Consumes: `ProjectionEvent`, `DailyPoint` de `types.ts`.
- Produces: `CashMovement`, `historicalLine(args): DailyPoint[]`, `projectedLine(args): DailyPoint[]`, `buildDailyLine(args): DailyPoint[]`

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/projection/balance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildDailyLine, historicalLine, projectedLine } from "./balance";
import type { ProjectionEvent } from "./types";

const u = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const evento = (over: Partial<ProjectionEvent>): ProjectionEvent => ({
  date: u(2026, 8, 25),
  categoryId: null,
  categoryName: "Aluguel",
  categoryIcon: null,
  categoryColorKey: null,
  type: "EXPENSE",
  amount: 100,
  nature: "committed",
  source: "merchant",
  label: "Aluguel",
  ...over,
});

describe("historicalLine", () => {
  it("reconstitui para trás e termina no saldo de hoje", () => {
    // Saldo hoje 1000. Dia 3 saiu 200, dia 5 entrou 500.
    const line = historicalLine({
      todayBalance: 1000,
      movements: [
        { date: u(2026, 8, 3), amount: 200, type: "EXPENSE" },
        { date: u(2026, 8, 5), amount: 500, type: "INCOME" },
      ],
      from: u(2026, 8, 1),
      today: u(2026, 8, 6),
    });

    expect(line).toHaveLength(6);
    expect(line[0].balanceExpected).toBe(700); // dia 1: 1000 - 500 + 200
    expect(line[2].balanceExpected).toBe(500); // dia 3, depois da saída
    expect(line[4].balanceExpected).toBe(1000); // dia 5, depois da entrada
    expect(line[5].balanceExpected).toBe(1000); // hoje
  });

  it("marca todos os pontos como reais", () => {
    const line = historicalLine({
      todayBalance: 1000, movements: [], from: u(2026, 8, 1), today: u(2026, 8, 3),
    });
    expect(line.every((p) => p.actual)).toBe(true);
  });

  it("mantém comprometido e esperado iguais no passado", () => {
    // O passado não tem incerteza: a banda tem largura zero até hoje.
    const line = historicalLine({
      todayBalance: 800,
      movements: [{ date: u(2026, 8, 2), amount: 200, type: "EXPENSE" }],
      from: u(2026, 8, 1),
      today: u(2026, 8, 3),
    });
    expect(line.every((p) => p.balanceCommitted === p.balanceExpected)).toBe(true);
  });
});

describe("projectedLine", () => {
  it("acumula a partir do saldo de hoje, um ponto por dia", () => {
    const line = projectedLine({
      startingBalance: 1000,
      events: [evento({ date: u(2026, 8, 22), amount: 300 })],
      from: u(2026, 8, 21),
      to: u(2026, 8, 23),
    });
    expect(line.map((p) => p.balanceExpected)).toEqual([1000, 700, 700]);
    expect(line.every((p) => p.actual)).toBe(false);
  });

  it("soma receita e subtrai despesa", () => {
    const line = projectedLine({
      startingBalance: 0,
      events: [
        evento({ date: u(2026, 8, 21), amount: 500, type: "INCOME" }),
        evento({ date: u(2026, 8, 22), amount: 200, type: "EXPENSE" }),
      ],
      from: u(2026, 8, 21),
      to: u(2026, 8, 22),
    });
    expect(line.map((p) => p.balanceExpected)).toEqual([500, 300]);
  });

  it("o comprometido ignora os eventos estimados", () => {
    // A banda de incerteza é justamente o intervalo entre as duas linhas.
    const line = projectedLine({
      startingBalance: 1000,
      events: [
        evento({ date: u(2026, 8, 21), amount: 300, nature: "committed" }),
        evento({ date: u(2026, 8, 21), amount: 200, nature: "estimated" }),
      ],
      from: u(2026, 8, 21),
      to: u(2026, 8, 21),
    });
    expect(line[0].balanceCommitted).toBe(700);
    expect(line[0].balanceExpected).toBe(500);
  });
});

describe("buildDailyLine", () => {
  it("emenda o passado reconstituído com o futuro projetado", () => {
    const line = buildDailyLine({
      todayBalance: 1000,
      movements: [{ date: u(2026, 8, 2), amount: 100, type: "EXPENSE" }],
      events: [evento({ date: u(2026, 8, 4), amount: 200 })],
      monthStart: u(2026, 8, 1),
      today: u(2026, 8, 3),
      horizonEnd: u(2026, 8, 5),
    });

    expect(line).toHaveLength(5);
    expect(line.filter((p) => p.actual)).toHaveLength(3);
    expect(line[2].balanceExpected).toBe(1000); // hoje, o ponto de emenda
    expect(line[3].balanceExpected).toBe(800);
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm run test --workspace=apps/api -- balance`
Expected: FAIL — `Failed to resolve import "./balance"`.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/lib/projection/balance.ts`:

```ts
/**
 * A linha do saldo, em duas metades que se emendam em hoje.
 *
 * Para trás ela é reconstituída a partir do saldo conhecido — o app não guarda
 * snapshot histórico, então o saldo do dia D é o de hoje menos tudo o que
 * aconteceu depois de D. Para frente ela é o acumulado dos eventos.
 */
import type { DailyPoint, ProjectionEvent, TransactionType } from "./types";

export interface CashMovement {
  date: Date;
  amount: number;
  type: TransactionType;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
    days.push(new Date(t));
  }
  return days;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Do saldo de hoje para trás. O passado não tem incerteza: `balanceCommitted` e
 * `balanceExpected` são o mesmo número, e a banda tem largura zero.
 */
export function historicalLine(args: {
  todayBalance: number;
  movements: CashMovement[];
  from: Date;
  today: Date;
}): DailyPoint[] {
  const { todayBalance, movements, from, today } = args;

  return eachDay(from, today).map((date) => {
    // Tudo o que aconteceu DEPOIS deste dia, desfeito.
    const after = movements.filter((m) => m.date > date && m.date <= today);
    const delta = after.reduce(
      (sum, m) => sum + (m.type === "INCOME" ? m.amount : -m.amount),
      0
    );
    const balance = todayBalance - delta;
    return { date, actual: true, balanceCommitted: balance, balanceExpected: balance };
  });
}

/** Do saldo de hoje para frente, acumulando os eventos. */
export function projectedLine(args: {
  startingBalance: number;
  events: ProjectionEvent[];
  from: Date;
  to: Date;
}): DailyPoint[] {
  const { startingBalance, events, from, to } = args;

  let committed = startingBalance;
  let expected = startingBalance;

  return eachDay(from, to).map((date) => {
    for (const event of events.filter((e) => sameDay(e.date, date))) {
      const signed = event.type === "INCOME" ? event.amount : -event.amount;
      // O comprometido é o teto da banda: só o que é explicável linha a linha.
      if (event.nature === "committed") committed += signed;
      expected += signed;
    }
    return { date, actual: false, balanceCommitted: committed, balanceExpected: expected };
  });
}

/** A linha inteira: reconstituída até hoje, projetada a partir de amanhã. */
export function buildDailyLine(args: {
  todayBalance: number;
  movements: CashMovement[];
  events: ProjectionEvent[];
  monthStart: Date;
  today: Date;
  horizonEnd: Date;
}): DailyPoint[] {
  const past = historicalLine({
    todayBalance: args.todayBalance,
    movements: args.movements,
    from: args.monthStart,
    today: args.today,
  });

  const future = projectedLine({
    startingBalance: args.todayBalance,
    events: args.events,
    from: new Date(args.today.getTime() + DAY_MS),
    to: args.horizonEnd,
  });

  return [...past, ...future];
}
```

- [ ] **Step 4: Rodar os testes**

Run: `npm run test --workspace=apps/api -- balance`
Expected: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/projection/balance.ts apps/api/src/lib/projection/balance.test.ts
git commit -m "Linha de saldo: passado reconstituido, futuro acumulado, banda entre as duas"
```

---

### Task 10: As leituras derivadas

**Files:**
- Create: `apps/api/src/lib/projection/derived.ts`
- Test: `apps/api/src/lib/projection/derived.test.ts`
- Create: `apps/api/src/lib/projection/index.ts`

**Interfaces:**
- Consumes: `DailyPoint`, `ProjectionEvent` de `types.ts`.
- Produces: `runwayMonths(liquid, costOfLiving): number | null`, `lowPoint(daily): { date: Date; balance: number } | null`, `zeroCrossing(daily): Date | null`, `dailyAllowance(args): number | null`, `committedIncomeRatio(committed, medianIncome): number | null`, `installmentFreedom(events): { date: Date; monthlyAmount: number } | null`; e o barril `index.ts` reexportando tudo de `types`, `medians`, `installments`, `events`, `bills`, `balance`, `derived`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `apps/api/src/lib/projection/derived.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  committedIncomeRatio,
  dailyAllowance,
  installmentFreedom,
  lowPoint,
  runwayMonths,
  zeroCrossing,
} from "./derived";
import type { DailyPoint, ProjectionEvent } from "./types";

const u = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

const ponto = (d: number, balance: number): DailyPoint => ({
  date: u(2026, 8, d),
  actual: false,
  balanceCommitted: balance,
  balanceExpected: balance,
});

describe("runwayMonths", () => {
  it("divide o saldo pelo custo de vida", () => {
    expect(runwayMonths(10200, 3000)).toBeCloseTo(3.4, 2);
  });

  it("devolve null quando o custo de vida é zero", () => {
    // Dividir por zero daria Infinity, e "você tem infinitos meses de folga" é
    // pior que não dizer nada.
    expect(runwayMonths(10200, 0)).toBeNull();
  });

  it("devolve zero quando o saldo é negativo", () => {
    expect(runwayMonths(-500, 3000)).toBe(0);
  });
});

describe("lowPoint", () => {
  it("acha o pior ponto da linha", () => {
    const found = lowPoint([ponto(1, 1000), ponto(2, 300), ponto(3, 800)]);
    expect(found).toEqual({ date: u(2026, 8, 2), balance: 300 });
  });

  it("devolve null com linha vazia", () => {
    expect(lowPoint([])).toBeNull();
  });
});

describe("zeroCrossing", () => {
  it("acha o primeiro dia negativo", () => {
    expect(zeroCrossing([ponto(1, 500), ponto(2, -20), ponto(3, -400)])).toEqual(u(2026, 8, 2));
  });

  it("devolve null quando a linha nunca fica negativa", () => {
    expect(zeroCrossing([ponto(1, 500), ponto(2, 10)])).toBeNull();
  });
});

describe("dailyAllowance", () => {
  it("desconta o comprometido e a reserva antes de dividir", () => {
    // 2000 - 800 de comprometido - 500 de reserva = 700, em 10 dias.
    expect(
      dailyAllowance({ balance: 2000, committedRemaining: 800, safetyReserve: 500, remainingDays: 10 })
    ).toBe(70);
  });

  it("devolve zero quando não sobra nada", () => {
    expect(
      dailyAllowance({ balance: 500, committedRemaining: 800, safetyReserve: 0, remainingDays: 10 })
    ).toBe(0);
  });

  it("devolve null no último dia do mês", () => {
    expect(
      dailyAllowance({ balance: 500, committedRemaining: 0, safetyReserve: 0, remainingDays: 0 })
    ).toBeNull();
  });
});

describe("committedIncomeRatio", () => {
  it("devolve a fração da renda já comprometida", () => {
    expect(committedIncomeRatio(3400, 5000)).toBeCloseTo(0.68, 4);
  });

  it("devolve null sem renda conhecida", () => {
    expect(committedIncomeRatio(3400, 0)).toBeNull();
  });
});

describe("installmentFreedom", () => {
  const parcela = (mes: number, amount: number, label: string): ProjectionEvent => ({
    date: u(2026, mes, 15),
    categoryId: null, categoryName: label, categoryIcon: null, categoryColorKey: null,
    type: "EXPENSE", amount, nature: "committed", source: "installment", label,
  });

  it("acha a última parcela e o quanto ela libera por mês", () => {
    const found = installmentFreedom([
      parcela(9, 250, "Magalu — parcela 11/12"),
      parcela(10, 250, "Magalu — parcela 12/12"),
      parcela(9, 180, "Móveis — parcela 4/10"),
    ]);
    expect(found).toEqual({ date: u(2026, 10, 15), monthlyAmount: 430 });
  });

  it("devolve null quando não há parcela nenhuma", () => {
    expect(installmentFreedom([])).toBeNull();
  });

  it("ignora eventos que não são parcela", () => {
    expect(
      installmentFreedom([
        { ...parcela(9, 250, "x"), source: "merchant" },
      ])
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `npm run test --workspace=apps/api -- derived`
Expected: FAIL — `Failed to resolve import "./derived"`.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/lib/projection/derived.ts`:

```ts
/**
 * As leituras que saem do mesmo calendário.
 *
 * Nenhuma delas é um cálculo novo: são agrupamentos e divisões sobre a lista de
 * eventos e a linha diária. Foi para isso que o motor produz um calendário em
 * vez de um número.
 */
import type { DailyPoint, ProjectionEvent } from "./types";

/** Quantos meses o saldo aguenta no custo de vida atual. */
export function runwayMonths(liquid: number, costOfLiving: number): number | null {
  if (costOfLiving <= 0) return null;
  return Math.max(0, liquid / costOfLiving);
}

/** Onde o mês aperta. Mais acionável que o saldo do último dia. */
export function lowPoint(daily: DailyPoint[]): { date: Date; balance: number } | null {
  if (daily.length === 0) return null;
  const worst = daily.reduce((min, p) => (p.balanceExpected < min.balanceExpected ? p : min));
  return { date: worst.date, balance: worst.balanceExpected };
}

export function zeroCrossing(daily: DailyPoint[]): Date | null {
  return daily.find((p) => p.balanceExpected < 0)?.date ?? null;
}

/** Quanto dá para gastar por dia sem furar a reserva. */
export function dailyAllowance(args: {
  balance: number;
  committedRemaining: number;
  safetyReserve: number;
  remainingDays: number;
}): number | null {
  if (args.remainingDays <= 0) return null;
  const free = args.balance - args.committedRemaining - args.safetyReserve;
  return Math.max(0, free / args.remainingDays);
}

/** Quanto da renda já tem dono antes de você acordar. */
export function committedIncomeRatio(
  committed: number,
  medianIncome: number
): number | null {
  if (medianIncome <= 0) return null;
  return committed / medianIncome;
}

/**
 * Quando as parcelas acabam, e o quanto isso libera por mês. O número mais
 * motivador que dá para extrair de um extrato, e sai de graça do calendário.
 */
export function installmentFreedom(
  events: ProjectionEvent[]
): { date: Date; monthlyAmount: number } | null {
  const installments = events.filter((e) => e.source === "installment");
  if (installments.length === 0) return null;

  const last = installments.reduce((max, e) => (e.date > max.date ? e : max));

  // Quanto sai do orçamento por mês: a soma de uma ocorrência de cada
  // parcelamento distinto, e não de todas as ocorrências futuras.
  const byLabel = new Map<string, number>();
  for (const e of installments) {
    // "Magalu — parcela 11/12" e "Magalu — parcela 12/12" são o mesmo carnê.
    const carne = e.label.replace(/\s*—\s*parcela\s+\d+\/\d+\s*$/i, "");
    byLabel.set(carne, e.amount);
  }
  const monthlyAmount = [...byLabel.values()].reduce((sum, v) => sum + v, 0);

  return { date: last.date, monthlyAmount };
}
```

- [ ] **Step 4: Criar o barril**

Crie `apps/api/src/lib/projection/index.ts`:

```ts
export * from "./types";
export * from "./medians";
export * from "./installments";
export * from "./events";
export * from "./bills";
export * from "./balance";
export * from "./derived";
```

- [ ] **Step 5: Rodar os testes**

Run: `npm run test --workspace=apps/api -- derived`
Expected: PASS, 14 testes.

Run: `npm run test --workspace=apps/api`
Expected: PASS — toda a suíte, incluindo a de categorização que já existia.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/projection/derived.ts apps/api/src/lib/projection/derived.test.ts apps/api/src/lib/projection/index.ts
git commit -m "Leituras derivadas: runway, dia do aperto, disponivel diario, liberdade das parcelas"
```

---

### Task 11: DTOs e a service que fala com o banco

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/modules/projection/projection.service.ts`
- Create: `apps/api/src/modules/projection/projection.routes.ts`
- Modify: `apps/api/src/app.ts:102` (registrar o router)
- Test: `apps/api/src/modules/projection/projection.service.test.ts`

**Interfaces:**
- Consumes: tudo de `lib/projection` (Tasks 6–10).
- Produces: `ProjectionDTO` e tipos irmãos em `@poup/shared`; `GET /api/projection?horizon=month|4m`; `resolveBasis(closedMonths: number, daysOfHistory: number): ProjectionBasis` exportado da service.

- [ ] **Step 1: Escrever os DTOs compartilhados**

Acrescente ao fim de `packages/shared/src/index.ts` o bloco de tipos exatamente como está na seção **API** do spec (`ProjectionBasis`, `ProjectionNature`, `ProjectionSource`, `ProjectionEventDTO`, `ProjectionDailyPointDTO`, `ProjectionCardDTO`, `ProjectionDerivedDTO`, `ProjectionDTO`), mais:

```ts
export type ProjectionHorizon = "month" | "4m";

export interface ProjectionQuery {
  horizon?: ProjectionHorizon;
}
```

Datas trafegam como `string` ISO nos DTOs — o motor trabalha com `Date`, e a conversão acontece na service.

- [ ] **Step 2: Escrever o teste do `basis`**

Crie `apps/api/src/modules/projection/projection.service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveBasis } from "./projection.service";

describe("resolveBasis", () => {
  it("usa mediana com dois meses fechados ou mais", () => {
    expect(resolveBasis(2, 70)).toBe("median");
    expect(resolveBasis(6, 200)).toBe("median");
  });

  it("cai para run-rate com menos de dois meses fechados mas histórico bastante", () => {
    expect(resolveBasis(1, 40)).toBe("run-rate");
    expect(resolveBasis(0, 14)).toBe("run-rate");
  });

  it("diz que não sabe quando o histórico é curto demais", () => {
    // O app não devolve zero disfarçado de resposta.
    expect(resolveBasis(0, 13)).toBe("insufficient");
    expect(resolveBasis(0, 0)).toBe("insufficient");
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `npm run test --workspace=apps/api -- projection.service`
Expected: FAIL — `Failed to resolve import "./projection.service"`.

- [ ] **Step 4: Escrever a service**

Crie `apps/api/src/modules/projection/projection.service.ts`. Ela é o único lugar do subsistema que fala com o Prisma, e é a maior task do plano — conte com umas 300 linhas. Todo o *cálculo* já existe e está testado nas tasks 6–10: o trabalho aqui é só montar os insumos e converter tipos. Quando estiver em dúvida sobre o estilo de query, `reports.service.ts` é o vizinho a copiar.

O filtro de transferências e de contas excluídas mora **aqui**, no SQL, e não nas funções puras — é por isso que `balance.test.ts` não os cobre. É o `WHERE` de cada query que precisa levá-los.

Estrutura obrigatória:

```ts
import { AccountType, CategoryNature, Prisma, SystemCategoryKey, TransactionType } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  buildDailyLine, cardEvents, closedMonthWindow, committedIncomeRatio, dailyAllowance,
  fixedCategoryEvents, installmentEvents, installmentFreedom, lowPoint, medianDayOfMonth,
  median, monthKeyOf, monthlyMedian, remainingInstallments, runwayMonths, variableCategoryEvents,
  zeroCrossing,
  type CashMovement, type CategoryInput, type InstallmentOccurrence, type ProjectionEvent,
} from "../../lib/projection";
import type { ProjectionBasis, ProjectionDTO, ProjectionHorizon } from "@poup/shared";

/** Até seis meses fechados. Além disso o comportamento antigo diz pouco. */
const MEDIAN_WINDOW_MONTHS = 6;

/**
 * De que o número foi feito. Sem isso a UI não teria como rotular — e um número
 * feito de duas semanas de extrato apresentado igual a um feito de seis meses é
 * uma promessa que o motor não pode cumprir.
 */
export function resolveBasis(closedMonths: number, daysOfHistory: number): ProjectionBasis {
  if (closedMonths >= 2) return "median";
  if (daysOfHistory >= 14) return "run-rate";
  return "insufficient";
}
```

E `getProjection(userId: string, horizon: ProjectionHorizon): Promise<ProjectionDTO>`, nesta ordem:

1. **Contas.** `prisma.account.findMany({ where: { userId, excludedFromBalance: false } })`. Separe em `cash` (`CHECKING`, `SAVINGS`) e `credit` (`CREDIT`). `INVESTMENT` fica fora. `startingBalance` = soma de `balance` das `cash`. `balanceAsOf` = menor `lastSyncedAt` entre as `cash`.
2. **Horizonte.** `month` → último dia do mês corrente. `4m` → último dia do mês corrente + 3.
3. **Histórico.** Primeira transação do usuário (`orderBy: { date: "asc" }, take: 1`) para o `firstMonth` e para `daysOfHistory`. `window = closedMonthWindow(today, firstMonth, MEDIAN_WINDOW_MONTHS)`. `basis = resolveBasis(window.length, daysOfHistory)`. Se `insufficient`, devolva o DTO com `projectedBalance: null`, `events: []`, `daily: []` e `derived` com tudo `null` — e pare aqui.
4. **Medianas por categoria, universo caixa.** Um `groupBy` por categoria e mês:

```ts
    const rows = await prisma.$queryRaw<
      { categoryId: string; month: string; total: Prisma.Decimal }[]
    >`
      SELECT t."categoryId",
             to_char(t."date", 'YYYY-MM') AS month,
             SUM(t."amount") AS total
      FROM "Transaction" t
      JOIN "Account" a ON a."id" = t."accountId"
      JOIN "Category" c ON c."id" = t."categoryId"
      WHERE t."userId" = ${userId}
        AND a."type" IN ('CHECKING', 'SAVINGS')
        AND a."excludedFromBalance" = false
        AND c."systemKey" IS NULL
        AND t."installmentTotal" IS NULL
        AND to_char(t."date", 'YYYY-MM') = ANY(${window})
      GROUP BY t."categoryId", month
    `;
```

   A soma é `numeric` no Postgres, exata — é a mesma razão que originou o `reports.service.ts`. `systemKey IS NULL` é o que tira `TRANSFER` e `UNCATEGORIZED` da conta.
5. **Comerciantes recorrentes das categorias fixas.** Query irmã, agrupada por `categoryId, merchantKey`, contando meses distintos, com `HAVING COUNT(DISTINCT to_char(t."date", 'YYYY-MM')) >= 2` e trazendo os valores e os dias para `median` / `medianDayOfMonth`. Só para categorias com `nature = 'FIXED'`.
6. **Gasto do mês corrente** por categoria, universo caixa, para `spentThisMonth`; e por comerciante fixo, para `paidThisMonth`.
7. **Eventos.** Para cada categoria monte um `CategoryInput` e chame `fixedCategoryEvents` ou `variableCategoryEvents` conforme `nature`. Para os meses futuros do horizonte, repita com `spentThisMonth: 0` e o `MonthContext` daquele mês.
8. **Parcelas.** Agrupe por `(merchantKey, installmentTotal, amount)` as transações com `installmentTotal IS NOT NULL`, monte `InstallmentGroup` (com `isCredit` conforme o tipo da conta), chame `remainingInstallments`, e passe as de caixa por `installmentEvents`. As de crédito vão para o `futureInstallments` do cartão.
9. **Cartões.** Para cada conta `CREDIT`, monte o `CardInput` — `closedBills` de `prisma.creditCardBill.findMany`, `openCycleSoFar` somando as transações desde o `closingDate` da última fatura, `dailyCardRate` = mediana diária do cartão, `medianBill` = mediana de `totalAmount` das faturas anteriores — e chame `cardEvents`.
10. **Linha.** `buildDailyLine` com os `movements` do mês corrente (universo caixa, sem `TRANSFER`) e todos os eventos.
11. **Derivados.** `lowPoint`, `zeroCrossing`, `runwayMonths` (custo de vida = mediana mensal das despesas de caixa), `dailyAllowance` (com `user.safetyReserve`), `committedIncomeRatio`, `installmentFreedom`.
12. **`uncategorizedCount`** = `prisma.transaction.count` das que estão na categoria `UNCATEGORIZED`.
13. Converta todo `Date` para ISO e todo `Prisma.Decimal` para `number` antes de devolver.

- [ ] **Step 5: Escrever a rota**

Crie `apps/api/src/modules/projection/projection.routes.ts`, no padrão de `reports.routes.ts`:

```ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";
import { getProjection } from "./projection.service";

export const projectionRouter = Router();

const querySchema = z.object({
  horizon: z.enum(["month", "4m"]).optional(),
});

projectionRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { horizon } = querySchema.parse(req.query);
    const projection = await getProjection(req.userId!, horizon ?? "month");
    res.json({ projection });
  })
);
```

Confira em `reports.routes.ts` de onde vem `asyncHandler` e siga o import de lá.

Em `apps/api/src/app.ts`, junto dos outros:

```ts
apiRouter.use("/projection", projectionRouter);
```

- [ ] **Step 6: Rodar os testes e compilar**

Run: `npm run test --workspace=apps/api -- projection.service`
Expected: PASS, 3 testes.

Run: `npm run build:shared && npm run build --workspace=apps/api`
Expected: sem erros.

- [ ] **Step 7: Verificar o endpoint à mão**

Suba `npm run dev:api`, pegue um token fazendo login pelo app, e:

```bash
curl -s -H "Authorization: Bearer <token>" "http://localhost:3000/api/projection?horizon=month" | head -c 2000
```

Esperado: JSON com `basis`, `projectedBalance`, `events` e `daily` não vazios. Confira à mão que `startingBalance` bate com o card de saldo do Dashboard — se não bater, o filtro de contas está diferente de `summarizeAccounts`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/modules/projection apps/api/src/app.ts
git commit -m "Endpoint GET /api/projection: insumos somados no banco, motor puro por cima"
```

---

### Task 12: O card no Dashboard e a folha de explicação

**Files:**
- Create: `apps/web/src/hooks/useProjection.ts`
- Create: `apps/web/src/components/dashboard/ProjectionCard.tsx`
- Create: `apps/web/src/components/dashboard/ProjectionBreakdownSheet.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx:217` (abaixo do `MonthSummaryPanel`)

**Interfaces:**
- Consumes: `ProjectionDTO` de `@poup/shared` (Task 11); `GET /api/projection`.
- Produces: `useProjection(enabled: boolean): { projection: ProjectionDTO | null; loading: boolean; error: string | null }`.

- [ ] **Step 1: Escrever o hook**

Crie `apps/web/src/hooks/useProjection.ts`, seguindo o padrão de `useSuggestionsCount.ts` (mesmo cliente `api`, mesmo tratamento de erro):

```ts
import { useEffect, useState } from "react";
import type { ProjectionDTO, ProjectionHorizon } from "@poup/shared";
import { api } from "../lib/api";

export function useProjection(enabled: boolean, horizon: ProjectionHorizon = "month") {
  const [projection, setProjection] = useState<ProjectionDTO | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setProjection(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    api
      .get<{ projection: ProjectionDTO }>(`/projection?horizon=${horizon}`)
      .then((res) => {
        if (!cancelled) {
          setProjection(res.projection);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, horizon]);

  return { projection, loading, error };
}
```

Confira a assinatura real de `api` em `apps/web/src/lib/api.ts` e adapte a chamada ao que existe lá.

- [ ] **Step 2: Escrever o card**

Crie `apps/web/src/components/dashboard/ProjectionCard.tsx`. Requisitos, todos obrigatórios:

- Título "No fim de \<mês por extenso\>", e o `projectedBalance` grande, dentro de `<Money>`.
- Linha secundária: "Comprometido \<committed\> · Estimado \<estimated\>", ambos em `<Money>`.
- Quando `derived.lowPoint` existir e for menor que o saldo final: "Aperta dia \<dia\>".
- Quando `derived.dailyAllowance` não for null: "\<valor\> por dia até o fim do mês", em `<Money>`.
- Quando `basis === "run-rate"`: um `Badge` discreto "estimativa por ritmo — menos de 2 meses de histórico".
- Quando `basis === "insufficient"`: renderize `EmptyState` com "Ainda não há histórico para projetar" e **não** mostre número nenhum.
- Quando `uncategorizedCount > 0`: uma linha com `<Link to="/revisao">` dizendo "N transações sem categoria não entraram nesta conta".
- Quando `balanceAsOf` for anterior a hoje: "saldo de \<N\> dias atrás" ao lado do título.
- Um botão "de onde vem esse número" que abre a folha.

- [ ] **Step 3: Escrever a folha de explicação**

Crie `apps/web/src/components/dashboard/ProjectionBreakdownSheet.tsx`: um `Modal` (que no toque já vira folha ancorada no rodapé, item 35 do `PLAN.md`) listando `projection.events` **agrupados por data**, em ordem crescente. Cada linha: ícone e nome da categoria (via `CategoryChip` ou `categoryIcons.tsx`), o `label` do evento, e o valor em `<Money>`. Marque a natureza com um `Badge` — "comprometido" ou "estimado".

Eventos `source === "variable"` são um por dia e poluiriam a lista: **agrupe-os por categoria num item só** por dia, ou some-os num item "Gastos do dia a dia" por data. Escolha um dos dois e siga consistente.

- [ ] **Step 4: Montar no Dashboard**

Em `DashboardPage.tsx`, logo abaixo do `MonthSummaryPanel`:

```tsx
{month.isCurrentMonth && (
  <ProjectionCard projection={projection} loading={projectionLoading} />
)}
```

com `const { projection, loading: projectionLoading } = useProjection(month.isCurrentMonth);`

O card **só existe no mês corrente**: projetar num mês fechado não quer dizer nada, e o Dashboard navega por mês.

- [ ] **Step 5: Verificar no navegador**

Suba `npm run dev`. No Dashboard, o card deve aparecer com um número. Navegue para o mês anterior: o card some. Ligue o modo discreto pelo olho da topbar: **todo** valor do card e da folha deve borrar — se algum não borrar, ele não está dentro de `<Money>`.

Abra a folha e confira que a soma dos eventos bate com `committed + estimated` do card.

- [ ] **Step 6: Compilar**

Run: `npm run build --workspace=apps/web`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/hooks/useProjection.ts apps/web/src/components/dashboard/ProjectionCard.tsx apps/web/src/components/dashboard/ProjectionBreakdownSheet.tsx apps/web/src/pages/DashboardPage.tsx
git commit -m "Card de saldo projetado no Dashboard, com a folha que explica o numero"
```

---

### Task 13: O gráfico da linha de saldo

**Files:**
- Create: `apps/web/src/components/dashboard/ProjectionChart.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx` (junto do `MonthlyFlowChart`, por volta da linha 234)

**Interfaces:**
- Consumes: `ProjectionDailyPointDTO[]` do `useProjection` (Task 12).
- Produces: nada que outras tasks consumam.

- [ ] **Step 1: Ler o gráfico que já existe**

Abra `apps/web/src/components/dashboard/MonthlyFlowChart.tsx` inteiro antes de escrever qualquer coisa. O gráfico novo tem de seguir o mesmo padrão: SVG à mão (o projeto não tem biblioteca de gráfico), os mesmos tokens de cor, e o **mesmo tratamento de acesso** — balão no `hover` **e no `focus`**, e `aria-label` descritivo por ponto.

- [ ] **Step 2: Escrever o gráfico**

Crie `apps/web/src/components/dashboard/ProjectionChart.tsx`. Requisitos:

- Uma linha de `balanceExpected` ao longo de `daily`.
- **Traço sólido** nos pontos com `actual === true`, **pontilhado** (`strokeDasharray`) nos com `actual === false`. Os dois segmentos se encontram no ponto de hoje.
- **Banda sombreada** (um `<path>` preenchido com opacidade baixa) entre `balanceCommitted` e `balanceExpected`, só na parte projetada. A banda **é** a incerteza: não há estatística nenhuma por trás, e os dois extremos são explicáveis em uma frase cada.
- Uma **marca** no `derived.lowPoint` (um círculo, com `aria-label` "ponto de aperto: \<data\>, \<valor\>").
- Uma linha horizontal no zero quando algum ponto for negativo.
- `aria-label` no `<svg>` resumindo a série, e um ponto focável por dia com `tabIndex={0}` e `aria-label` "\<data\>: \<valor\>".

Valores no balão passam por `<Money>`.

- [ ] **Step 3: Montar no Dashboard**

Dentro do mesmo `Card` do `MonthlyFlowChart`, ou num `Card` irmão logo abaixo, e também só quando `month.isCurrentMonth`.

- [ ] **Step 4: Verificar no navegador**

Confira: a emenda entre sólido e pontilhado cai em hoje; a banda abre a partir de hoje e tem largura zero antes; navegando por teclado (Tab) os pontos recebem foco e o balão aparece; no modo discreto o valor do balão borra.

Redimensione para 375px de largura: o gráfico não pode causar rolagem horizontal na página.

- [ ] **Step 5: Compilar**

Run: `npm run build --workspace=apps/web`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/dashboard/ProjectionChart.tsx apps/web/src/pages/DashboardPage.tsx
git commit -m "Grafico da linha de saldo: solido ate hoje, pontilhado adiante, banda no meio"
```

---

### Task 14: O card do cartão

**Files:**
- Create: `apps/web/src/components/dashboard/CreditCardPanel.tsx`
- Modify: `apps/web/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `ProjectionCardDTO[]` (`projection.cards`) do `useProjection`.
- Produces: nada que outras tasks consumam.

- [ ] **Step 1: Escrever o painel**

Crie `apps/web/src/components/dashboard/CreditCardPanel.tsx`, um card por elemento de `projection.cards`. Conteúdo, por cartão:

- Nome da conta e o logo da instituição (`InstitutionLogo`, que já existe).
- Quando `closedAmount` não for null: "Fatura fechada: \<valor\> · vence \<data\>", com destaque — é a saída de caixa mais certa que existe.
- Sempre: "Ciclo aberto: \<openSoFar\> até agora · deve fechar em \<openProjected\>", e "fecha \<openClosingDate\>, vence \<openDueDate\>".
- Quando `limitBreachDate` não for null: um alerta em tom de aviso, "No seu ritmo você bate o limite dia \<dia\>".
- Quando `excludedReason === "no-credit-data"`: em vez de tudo isso, a frase honesta — "Este cartão ficou fora da projeção: o banco não informa fechamento nem vencimento." Nunca omita em silêncio.

Todos os valores em `<Money>`.

- [ ] **Step 2: Montar no Dashboard**

Abaixo do gráfico, e só quando `projection.cards.length > 0`.

- [ ] **Step 3: Verificar no navegador**

Com um cartão conectado, confira que `openSoFar` bate com o que o app do banco mostra de fatura atual. Se divergir muito, o `closingDate` usado para somar o ciclo aberto está errado — confira no Prisma Studio o `CreditCardBill.closingDate` mais recente daquela conta.

- [ ] **Step 4: Compilar**

Run: `npm run build --workspace=apps/web`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/dashboard/CreditCardPanel.tsx apps/web/src/pages/DashboardPage.tsx
git commit -m "Card do cartao: fatura fechada, ciclo aberto e alerta de limite"
```

---

### Task 15: Runway, comprometimento e a reserva de segurança

**Files:**
- Modify: `packages/shared/src/index.ts` (`UpdateProfileRequest`, `UserDTO`)
- Modify: `apps/api/src/modules/auth/auth.service.ts` (`updateProfile`, `getUserById`)
- Modify: `apps/api/src/modules/auth/auth.routes.ts` (`updateProfileSchema`)
- Create: `apps/web/src/components/planning/FinancialHealthTab.tsx`
- Modify: `apps/web/src/pages/PlanningPage.tsx` (terceira aba)
- Modify: `apps/web/src/components/profile/EditProfileModal.tsx`

**Interfaces:**
- Consumes: `projection.derived` (Task 11); `User.safetyReserve` (Task 1).
- Produces: `UserDTO.safetyReserve: number`; `UpdateProfileRequest.safetyReserve?: number`.

- [ ] **Step 1: Levar a reserva até a API**

Em `packages/shared/src/index.ts`:

```ts
export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  currentPassword?: string;
  /** Colchão descontado do "disponível diário". */
  safetyReserve?: number;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  safetyReserve: number;
}
```

Em `auth.routes.ts`, no `updateProfileSchema`:

```ts
  safetyReserve: z.number().min(0).optional(),
```

Em `auth.service.ts`, inclua `safetyReserve` no `select` de `getUserById`, converta com `Number(user.safetyReserve)` ao montar o DTO, e grave `new Prisma.Decimal(input.safetyReserve)` no `updateProfile` quando vier.

- [ ] **Step 2: Campo no perfil**

Em `EditProfileModal.tsx`, um `Field` com `CurrencyInput` (que já existe), rotulado "Reserva de segurança", com a ajuda: "Um colchão que o app desconta antes de dizer quanto dá para gastar por dia."

- [ ] **Step 3: Aba de saúde financeira**

Crie `apps/web/src/components/planning/FinancialHealthTab.tsx` — Planejamento é onde se olha para o mês inteiro, e não o Dashboard. Use `useProjection(true, "4m")`. Conteúdo:

- **Runway**: "\<derived.runwayMonths\> meses de folga", com o custo de vida logo abaixo em `<Money>`. Quando `null`: "ainda não dá para calcular seu custo de vida".
- **Comprometimento da renda**: `committedIncomeRatio` como porcentagem, com uma `ProgressBar` (o componente já existe). Texto: "\<N\>% do que você ganha já tem dono."
- **Liberdade das parcelas**: quando `installmentFreedom` não for null, "Suas parcelas acabam em \<mês/ano\>, liberando \<valor\> por mês", com o valor em `<Money>`.
- **Dia do cruzamento**: quando `zeroCrossingDate` não for null, um aviso "Sua projeção fica negativa em \<data\>".

- [ ] **Step 4: Registrar a aba**

Em `PlanningPage.tsx`, acrescente a terceira aba ao lado de Orçamentos e Metas, seguindo exatamente o padrão das duas que já estão lá.

- [ ] **Step 5: Verificar no navegador**

Mude a reserva no perfil para R$ 500 e confira que o "disponível diário" do card do Dashboard cai — se não cair, `safetyReserve` não está chegando na projeção, e o problema está no `select` da service (Task 11, passo 11).

- [ ] **Step 6: Compilar**

Run: `npm run build:shared && npm run build --workspace=apps/api && npm run build --workspace=apps/web`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/modules/auth apps/web/src/components/planning apps/web/src/pages/PlanningPage.tsx apps/web/src/components/profile/EditProfileModal.tsx
git commit -m "Aba de saude financeira: runway, comprometimento e reserva de seguranca"
```

---

### Task 16: A notificação de projeção negativa

**Files:**
- Modify: `apps/api/src/modules/notifications/notifications.service.ts` (`generateAutomaticAlerts`, por volta da linha 106)
- Test: `apps/api/src/modules/notifications/notifications.service.test.ts`

**Interfaces:**
- Consumes: `getProjection` de `modules/projection/projection.service.ts` (Task 11).
- Produces: `shouldWarnNegativeProjection(projection): boolean` exportado da service de notificações.

- [ ] **Step 1: Ler o padrão que já existe**

Abra `createReviewNotification` em `notifications.service.ts`. Ele resolve exatamente o problema que esta task tem: **uma notificação por assunto, atualizada em vez de duplicada**, encontrando a anterior não lida pelo `link`. Siga o mesmo desenho — sem isso o usuário recebe um aviso por dia enquanto a projeção estiver negativa.

- [ ] **Step 2: Escrever o teste que falha**

Crie `apps/api/src/modules/notifications/notifications.service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldWarnNegativeProjection } from "./notifications.service";

const base = {
  basis: "median" as const,
  projectedBalance: 1200,
  derived: { zeroCrossingDate: null as string | null },
};

describe("shouldWarnNegativeProjection", () => {
  it("avisa quando o mês fecha negativo", () => {
    expect(shouldWarnNegativeProjection({ ...base, projectedBalance: -300 })).toBe(true);
  });

  it("avisa quando a linha cruza zero no meio do mês, mesmo fechando positivo", () => {
    // Fechar positivo não ajuda quem fica sem dinheiro no dia 12.
    expect(
      shouldWarnNegativeProjection({
        ...base,
        projectedBalance: 400,
        derived: { zeroCrossingDate: "2026-08-12" },
      })
    ).toBe(true);
  });

  it("não avisa quando o mês fecha positivo e a linha nunca cruza", () => {
    expect(shouldWarnNegativeProjection(base)).toBe(false);
  });

  it("não avisa quando o motor não sabe", () => {
    // Sem histórico não há número, e alarmar a partir de null seria inventar.
    expect(
      shouldWarnNegativeProjection({ ...base, basis: "insufficient", projectedBalance: null })
    ).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar para ver falhar**

Run: `npm run test --workspace=apps/api -- notifications.service`
Expected: FAIL — `shouldWarnNegativeProjection` não existe.

- [ ] **Step 4: Implementar**

Em `notifications.service.ts`:

```ts
const PROJECTION_LINK = "/";

/**
 * Fechar o mês positivo não ajuda quem fica sem dinheiro no dia 12 — por isso o
 * cruzamento no meio do mês também dispara. E `insufficient` nunca dispara:
 * alarmar a partir de um número que o motor se recusou a dar seria inventar.
 */
export function shouldWarnNegativeProjection(projection: {
  basis: string;
  projectedBalance: number | null;
  derived: { zeroCrossingDate: string | null };
}): boolean {
  if (projection.basis === "insufficient" || projection.projectedBalance === null) {
    return false;
  }
  return projection.projectedBalance < 0 || projection.derived.zeroCrossingDate !== null;
}
```

E dentro de `generateAutomaticAlerts`, depois dos alertas de orçamento:

```ts
  const projection = await getProjection(userId, "month");
  if (shouldWarnNegativeProjection(projection)) {
    const title = "Sua projeção ficou negativa";
    const body = projection.derived.zeroCrossingDate
      ? `No ritmo atual seu saldo fica negativo em ${formatDay(projection.derived.zeroCrossingDate)}.`
      : `Do jeito que está, o mês fecha negativo.`;

    // Uma por assunto, atualizada em vez de duplicada — o mesmo desenho de
    // createReviewNotification. Sem isso vira um aviso por dia.
    const existing = await prisma.notification.findFirst({
      where: { userId, link: PROJECTION_LINK, read: false, title },
    });

    if (existing) {
      await prisma.notification.update({ where: { id: existing.id }, data: { body } });
    } else {
      await prisma.notification.create({
        data: { userId, title, body, severity: NotificationSeverity.WARNING, link: PROJECTION_LINK },
      });
      created++;
    }
  }
```

O helper `formatDay`, no mesmo arquivo — sem dependência nova:

```ts
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-08-12" → "12 de agosto". Em UTC, como o resto das datas do projeto. */
function formatDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npm run test --workspace=apps/api -- notifications.service`
Expected: PASS, 4 testes.

Run: `npm run test --workspace=apps/api`
Expected: PASS, a suíte inteira.

- [ ] **Step 6: Verificar à mão**

Com a sessão aberta, chame `POST /notifications/check` e confira o painel de notificações. Chame duas vezes: a segunda **não** pode criar uma segunda notificação.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/notifications
git commit -m "Notificacao quando a projecao vira negativa, uma por assunto"
```

---

### Task 17: Atualizar o PLAN.md

O `PLAN.md` tem uma regra escrita nele: descreve o que **existe**. A revisão de 19/08 encontrou cinco itens marcados como prontos sem código nenhum, e esta task é o que impede a sexta.

**Files:**
- Modify: `PLAN.md`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Registrar o que passou a existir**

Na seção "O que está pronto", acrescente itens numerados na continuação da numeração atual (que termina em 42), em **Backend** e **Frontend**, cobrindo: o enriquecimento do sync (comerciante, parcela, `creditData`, faturas), a natureza da categoria, o motor de projeção e o endpoint, o card e a folha de explicação, o gráfico da linha, o card do cartão, a aba de saúde financeira e a notificação.

Cada item segue o tom dos existentes: o que é, e a decisão não óbvia por trás. Por exemplo, o item do motor precisa dizer que caixa e crédito são universos separados, e por quê.

- [ ] **Step 2: Corrigir o backlog**

Na tabela "Backlog (planejado, **não** implementado)", a linha "Detecção automática de recorrência" continua verdadeira — o motor não detecta recorrência, ele lê a natureza da categoria. Deixe-a, e acrescente uma nota deixando isso explícito, para ninguém achar que a projeção resolveu esse item.

Acrescente ao backlog as limitações declaradas desta entrega: despesas anuais, lançamentos agendados, split de transação, e `isRecurring` órfão.

Em "Outros pendentes conhecidos", atualize a linha de testes: a suíte da API passou a cobrer o motor de projeção inteiro.

- [ ] **Step 3: Rodar a suíte inteira uma última vez**

```bash
npm run test --workspace=apps/api && npm run test --workspace=apps/web && npm run build
```

Expected: tudo passa e o build completo (shared → api → web) termina sem erro.

- [ ] **Step 4: Commit**

```bash
git add PLAN.md
git commit -m "PLAN.md: registrar o saldo projetado e o que ele deliberadamente nao resolve"
```

---

## Ordem e paralelismo

As tasks 2, 6, 7, 8, 9 e 10 são o motor puro — nenhuma toca banco ou tela, e todas dependem só da anterior no seu próprio arquivo. As tasks 4/5 (natureza da categoria) são independentes das 6–10 e podem correr em paralelo com elas, desde que a Task 1 já tenha sido aplicada.

A Task 11 é o gargalo: precisa de 1, 3, 4 e de todo o motor. As de frontend (12–15) precisam da 11. A 16 precisa da 11. A 17 é a última.
