# Faturas de cartão e webhooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer a fatura do cartão existir no app, reconhecer o pagamento dela na conta corrente como transferência — para que a despesa não conte duas vezes — e receber da Pluggy, por webhook, o vínculo entre transação e fatura sem depender de sync manual.

**Architecture:** A fatura vira um model próprio (`CreditCardBill`), alimentado por `fetchCreditCardBills` e ligado às transações por `creditCardMetadata.billId`. O reconhecimento do pagamento é uma função pura sobre duas listas — faturas pagas e débitos candidatos — testável sem banco, com heurística de descrição só como reserva. O webhook vive num router **fora** do `pluggyRouter`, porque aquele exige autenticação de usuário e quem chama aqui é a Pluggy; a autenticação é um header secreto registrado junto com o webhook.

**Tech Stack:** Node + Express + TypeScript + Prisma (Postgres/Neon), React + Vite + Tailwind, vitest, pluggy-sdk.

**Spec:** `docs/superpowers/specs/2026-08-23-competencia-faturas-e-webhooks-design.md` (seções 4 e 5)

**Plano irmão:** `docs/superpowers/plans/2026-08-23-competencia-e-agrupamento.md` cobre as seções 1 a 3. **Execute-o primeiro:** a Task 3 daqui grava `competenceDate` junto com o vínculo da fatura, e essa coluna nasce lá.

## Global Constraints

- **Datas são gravadas e comparadas em UTC.** Use `Date.UTC(...)`, `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()` — nunca os equivalentes locais.
- **Chave de mês é `"YYYY-MM"`**, com o mês em dois dígitos (`padStart(2, "0")`).
- **Migrações são SQL escrito à mão** em `apps/api/prisma/migrations/<timestamp>_<nome_snake_case>/migration.sql`, com um comentário no topo explicando *por que* a coluna existe. **Nunca rode `prisma migrate dev`.** Aplique com `npm run prisma:deploy --workspace=apps/api` (o `.env` com `DATABASE_URL` vive em `apps/api/`, então rodar da raiz falha com `Environment variable not found`).
- **O banco `DATABASE_URL` tem mais de uma conta real.** Todo `UPDATE`/`DELETE` de manutenção precisa ser escopado por `userId`. Nenhum backfill deste plano é global.
- **Moeda no banco é `Decimal(14, 2)`**; nos DTOs trafega como `number`.
- **`amount` é sempre positivo.** O sinal mora em `type`.
- **Todo valor em dinheiro exibido no web passa por `<Money>`** (`apps/web/src/components/ui/Money.tsx`).
- **Nada de `any` novo.** Cada workspace compila com `tsc`.
- **Testes ficam ao lado do fonte.**
  - API: `npm run test --workspace=apps/api`
  - Web: `npm run test --workspace=apps/web`
- **Comentário explica o porquê, não o quê**, em português, no tom dos comentários já existentes.
- **`packages/shared` precisa ser recompilado** depois de mexer em `packages/shared/src/index.ts`: `npm run build:shared`.
- **Segredo nunca vai para o repositório.** O segredo do webhook vive em `PLUGGY_WEBHOOK_SECRET`, lido de `process.env`, e entra no `.env.example` só como nome.

---

## Mapa de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/lib/pagamentoDeFatura.ts` | Casar fatura paga com o débito na conta corrente. Puro |
| `apps/api/src/lib/pagamentoDeFatura.test.ts` | Testes das acima |
| `apps/api/src/modules/bills/bills.service.ts` | Importar faturas da Pluggy e aplicar o casamento |
| `apps/api/src/modules/pluggy/webhook.routes.ts` | A rota pública e a conferência do header |
| `apps/api/prisma/migrations/20260823160000_faturas_de_cartao/migration.sql` | `CreditCardBill`, `Transaction.pluggyBillId`, `Item.hasPendingSync` |

**Modificados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/prisma/schema.prisma` | O model novo e as duas colunas |
| `apps/api/src/lib/pluggyMapping.ts` | `dadosDeParcela` passa a devolver `pluggyBillId` |
| `apps/api/src/lib/pluggyMapping.test.ts` | Casos novos |
| `apps/api/src/modules/pluggy/pluggy.service.ts` | Importa faturas no sync; `camposDaTransacao` grava `pluggyBillId`; `sincronizarPorIds` para o webhook |
| `apps/api/src/app.ts` | Monta o router do webhook antes do `pluggyRouter` |
| `apps/api/src/modules/auth/auth.service.ts` | Registra o webhook quando as credenciais são salvas |
| `packages/shared/src/index.ts` | `ItemDTO.hasPendingSync` |
| `apps/web/src/pages/ProfilePage.tsx` | Ponto na conexão que tem novidade |
| `apps/api/.env.example` | `PLUGGY_WEBHOOK_SECRET` e `PUBLIC_API_URL` |
| `docs/PLAN.md` | Registra o que passou a existir |

---

### Task 1: Schema e migração

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260823160000_faturas_de_cartao/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: model `CreditCardBill`; `Transaction.pluggyBillId: string | null`; `Item.hasPendingSync: boolean`.

- [ ] **Step 1: Acrescentar o model `CreditCardBill`**

Em `apps/api/prisma/schema.prisma`, logo **abaixo** do `model Account` (para ficar junto do que ela descreve):

```prisma
/// A fatura do cartao, como a instituicao a fecha.
///
/// Existe por duas razoes. A primeira e o `payments[]` que a Pluggy devolve: e
/// a propria instituicao dizendo que a fatura foi paga, em que dia e por quanto
/// — o unico jeito de reconhecer o debito na conta corrente sem adivinhar pela
/// descricao. A segunda e servir de ancora para `Transaction.pluggyBillId`.
///
/// Nunca vira linha de despesa. A despesa sao as compras; a fatura e o agregado
/// delas, e soma-la ao lado das transacoes contaria tudo duas vezes.
model CreditCardBill {
  id           String    @id @default(uuid())
  userId       String
  accountId    String
  pluggyBillId String    @unique
  dueDate      DateTime
  /// Quando a instituicao fechou a fatura. Nulo enquanto ela esta aberta.
  closingDate  DateTime?
  totalAmount  Decimal   @db.Decimal(14, 2)
  /// Data e valor do pagamento reportado pela instituicao. Nulos enquanto a
  /// fatura nao foi paga — e e a presenca deles que dispara o reconhecimento.
  paidAt       DateTime?
  paidAmount   Decimal?  @db.Decimal(14, 2)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([userId, dueDate])
  @@index([accountId])
}
```

E declare o lado inverso das relações. Em `model User`, junto das outras listas:

```prisma
  creditCardBills CreditCardBill[]
```

Em `model Account`, junto de `transactions Transaction[]`:

```prisma
  creditCardBills CreditCardBill[]
```

- [ ] **Step 2: Acrescentar as duas colunas**

Em `model Transaction`, logo depois de `purchaseKey         String?`:

```prisma
  /// A fatura a que a Pluggy vinculou esta linha, quando ja vinculou. Chega
  /// vazio enquanto a fatura esta aberta (`status: PENDING`) e e preenchido no
  /// fechamento — e o evento `transactions/updated` que avisa.
  pluggyBillId        String?
```

E o índice, junto dos demais no fim do model:

```prisma
  @@index([pluggyBillId])
```

Em `model Item`, logo depois de `lastSyncedAt   DateTime?`:

```prisma
  /// O webhook avisou que ha transacao nova nesta conexao, e o sync ainda nao
  /// rodou. E so um aviso na tela: o app nunca sincroniza sozinho, porque o
  /// tempo de uma funcao serverless nao comporta um sync de tamanho
  /// desconhecido disparado por evento externo.
  hasPendingSync Boolean    @default(false)
```

- [ ] **Step 3: Escrever a migração**

Crie `apps/api/prisma/migrations/20260823160000_faturas_de_cartao/migration.sql`:

```sql
-- Faturas de cartao e o aviso do webhook.
--
-- A fatura existe para responder "esta paga, quando e por quanto?" com o dado
-- da propria instituicao (`payments[]` da Pluggy), em vez de adivinhar pela
-- descricao do debito na conta corrente. Reconhecer o pagamento e o que permite
-- marca-lo como transferencia — e transferencia ja e ignorada em todos os
-- totais, entao a despesa para de contar duas vezes.
CREATE TABLE "CreditCardBill" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "accountId"    TEXT NOT NULL,
  "pluggyBillId" TEXT NOT NULL,
  "dueDate"      TIMESTAMP(3) NOT NULL,
  "closingDate"  TIMESTAMP(3),
  "totalAmount"  DECIMAL(14,2) NOT NULL,
  "paidAt"       TIMESTAMP(3),
  "paidAmount"   DECIMAL(14,2),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditCardBill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditCardBill_pluggyBillId_key" ON "CreditCardBill"("pluggyBillId");
CREATE INDEX "CreditCardBill_userId_dueDate_idx" ON "CreditCardBill"("userId", "dueDate");
CREATE INDEX "CreditCardBill_accountId_idx" ON "CreditCardBill"("accountId");

ALTER TABLE "CreditCardBill" ADD CONSTRAINT "CreditCardBill_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditCardBill" ADD CONSTRAINT "CreditCardBill_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O vinculo do lado da transacao: a Pluggy nao expoe, neste SDK, um endpoint
-- que va da fatura para as transacoes dela.
ALTER TABLE "Transaction" ADD COLUMN "pluggyBillId" TEXT;
CREATE INDEX "Transaction_pluggyBillId_idx" ON "Transaction"("pluggyBillId");

-- Aviso de que o webhook viu transacao nova. Nasce falso para todo mundo: o
-- estado de hoje e "ninguem foi avisado de nada".
ALTER TABLE "Item" ADD COLUMN "hasPendingSync" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 4: Aplicar e regenerar**

```bash
npm run prisma:deploy --workspace=apps/api
```

Esperado: `1 migration applied`.

```bash
npm run prisma:generate
```

Esperado: `Generated Prisma Client`.

- [ ] **Step 5: Compilar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS. As colunas são nulas ou têm default, e nada as usa ainda.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): fatura de cartao, vinculo da transacao e aviso de sync pendente"
```

---

### Task 2: O casamento do pagamento

Função pura sobre duas listas. É onde mora o risco de marcar uma despesa real como transferência, e por isso é a parte mais testada do plano.

**Files:**
- Create: `apps/api/src/lib/pagamentoDeFatura.ts`
- Test: `apps/api/src/lib/pagamentoDeFatura.test.ts`

**Interfaces:**
- Consumes: `normalizeDescription` de `./categorization/normalize`.
- Produces:
  - `JANELA_DE_PAGAMENTO_DIAS: 3`
  - `interface FaturaPaga { billId: string; accountId: string; paidAt: Date; paidAmount: number }`
  - `interface DebitoCandidato { id: string; accountId: string; date: Date; amount: number }`
  - `interface Casamento { transactionId: string; billId: string }`
  - `casarPagamentos(faturas: FaturaPaga[], candidatos: DebitoCandidato[]): Casamento[]`
  - `parecePagamentoDeFatura(description: string): boolean` — **nome exato:** `parecePagamentoDeFatura`

- [ ] **Step 1: Escrever o teste**

Crie `apps/api/src/lib/pagamentoDeFatura.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { casarPagamentos, parecePagamentoDeFatura } from "./pagamentoDeFatura";

const fatura = {
  billId: "fatura-1",
  accountId: "cartao-1",
  paidAt: new Date("2026-09-10T00:00:00Z"),
  paidAmount: 300,
};

const debito = {
  id: "tx-1",
  accountId: "corrente-1",
  date: new Date("2026-09-10T00:00:00Z"),
  amount: 300,
};

describe("casarPagamentos", () => {
  it("casa valor igual no mesmo dia", () => {
    expect(casarPagamentos([fatura], [debito])).toEqual([
      { transactionId: "tx-1", billId: "fatura-1" },
    ]);
  });

  it("casa dentro da janela de tres dias", () => {
    const doisDiasAntes = { ...debito, date: new Date("2026-09-08T00:00:00Z") };
    expect(casarPagamentos([fatura], [doisDiasAntes])).toHaveLength(1);
  });

  it("nao casa fora da janela", () => {
    // Uma despesa de mesmo valor duas semanas depois nao e o pagamento.
    const longe = { ...debito, date: new Date("2026-09-25T00:00:00Z") };
    expect(casarPagamentos([fatura], [longe])).toEqual([]);
  });

  it("nao casa valor diferente", () => {
    // Pagamento parcial existe, mas casar por aproximacao transformaria
    // qualquer despesa parecida em transferencia.
    expect(casarPagamentos([fatura], [{ ...debito, amount: 299.9 }])).toEqual([]);
  });

  it("nao casa um debito na propria conta do cartao", () => {
    // A outra ponta do pagamento mora no cartao e ja e tratada pelo pareamento
    // de transferencia que existe. Casar aqui duplicaria o vinculo.
    expect(casarPagamentos([fatura], [{ ...debito, accountId: "cartao-1" }])).toEqual([]);
  });

  it("cada debito casa com uma fatura so", () => {
    // Duas faturas de mesmo valor no mesmo dia (dois cartoes) e um debito so:
    // o debito paga uma delas, e escolher as duas inventaria dinheiro.
    const outra = { ...fatura, billId: "fatura-2", accountId: "cartao-2" };
    expect(casarPagamentos([fatura, outra], [debito])).toHaveLength(1);
  });

  it("cada fatura casa com um debito so", () => {
    const outroDebito = { ...debito, id: "tx-2" };
    expect(casarPagamentos([fatura], [debito, outroDebito])).toHaveLength(1);
  });

  it("prefere o debito mais proximo da data do pagamento", () => {
    const longe = { ...debito, id: "tx-longe", date: new Date("2026-09-08T00:00:00Z") };
    const perto = { ...debito, id: "tx-perto", date: new Date("2026-09-10T00:00:00Z") };
    expect(casarPagamentos([fatura], [longe, perto])).toEqual([
      { transactionId: "tx-perto", billId: "fatura-1" },
    ]);
  });

  it("lista vazia nao quebra", () => {
    expect(casarPagamentos([], [debito])).toEqual([]);
    expect(casarPagamentos([fatura], [])).toEqual([]);
  });
});

describe("parecePagamentoDeFatura", () => {
  it("reconhece as formas comuns", () => {
    expect(parecePagamentoDeFatura("PAGTO FATURA CARTAO")).toBe(true);
    expect(parecePagamentoDeFatura("PAGAMENTO FATURA")).toBe(true);
    expect(parecePagamentoDeFatura("PAGTO CARTAO DE CREDITO")).toBe(true);
    expect(parecePagamentoDeFatura("PAGAMENTO DE FATURA")).toBe(true);
  });

  it("ignora acento e caixa", () => {
    expect(parecePagamentoDeFatura("pagamento de fatura")).toBe(true);
    expect(parecePagamentoDeFatura("Pagto Cartão")).toBe(true);
  });

  it("nao confunde outros pagamentos", () => {
    // A heuristica so entra quando a API nao deu resposta, entao errar aqui
    // marca uma despesa real como transferencia e ela some dos relatorios.
    expect(parecePagamentoDeFatura("PAGAMENTO ALUGUEL")).toBe(false);
    expect(parecePagamentoDeFatura("PAGTO BOLETO ENERGIA")).toBe(false);
    expect(parecePagamentoDeFatura("FATURA DE ENERGIA")).toBe(false);
    expect(parecePagamentoDeFatura("SUPERMERCADO")).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npm run test --workspace=apps/api
```

Esperado: FAIL — `Failed to resolve import "./pagamentoDeFatura"`.

- [ ] **Step 3: Escrever a implementação**

Crie `apps/api/src/lib/pagamentoDeFatura.ts`:

```ts
import { normalizeDescription } from "./categorization/normalize";

/**
 * Reconhecer que um debito na conta corrente e o pagamento de uma fatura.
 *
 * O motivo e a duplicidade: a compra de R$ 300 no cartao ja e despesa, e o
 * debito de R$ 300 que quita a fatura nao e uma segunda despesa — e o mesmo
 * dinheiro saindo. Reconhecido, o debito vira transferencia, e transferencia ja
 * e excluida de todos os totais.
 *
 * Errar aqui e caro nas duas direcoes: nao reconhecer duplica o gasto;
 * reconhecer errado faz uma despesa real sumir do relatorio. Por isso o
 * casamento exige valor **exato** e proximidade de data, e nunca aproxima.
 */

/** Mesma janela do pareamento de transferencia, e pela mesma razao: a data que o banco registra nem sempre e a que o dinheiro andou. */
export const JANELA_DE_PAGAMENTO_DIAS = 3;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface FaturaPaga {
  billId: string;
  /** A conta **do cartao**. Serve para nao casar o debito com a propria fatura dele. */
  accountId: string;
  paidAt: Date;
  paidAmount: number;
}

export interface DebitoCandidato {
  id: string;
  accountId: string;
  date: Date;
  amount: number;
}

export interface Casamento {
  transactionId: string;
  billId: string;
}

/**
 * Casa faturas pagas com os debitos que as pagaram.
 *
 * Um debito casa com no maximo uma fatura, e uma fatura com no maximo um
 * debito: dois cartoes com faturas de mesmo valor no mesmo dia existem, e
 * deixar um debito quitar as duas inventaria dinheiro que nao saiu.
 *
 * Empate resolve pela proximidade da data — e, persistindo, pelo id, para que a
 * saida seja estavel entre execucoes.
 */
export function casarPagamentos(
  faturas: FaturaPaga[],
  candidatos: DebitoCandidato[]
): Casamento[] {
  const casamentos: Casamento[] = [];
  const usados = new Set<string>();

  for (const fatura of faturas) {
    const compativeis = candidatos
      .filter(
        (c) =>
          !usados.has(c.id) &&
          // O debito sai de outra conta: a ponta que mora no cartao ja e
          // tratada pelo pareamento de transferencia que existe.
          c.accountId !== fatura.accountId &&
          c.amount === fatura.paidAmount &&
          Math.abs(c.date.getTime() - fatura.paidAt.getTime()) <=
            JANELA_DE_PAGAMENTO_DIAS * DIA_MS
      )
      .sort((a, b) => {
        const distA = Math.abs(a.date.getTime() - fatura.paidAt.getTime());
        const distB = Math.abs(b.date.getTime() - fatura.paidAt.getTime());
        return distA === distB ? a.id.localeCompare(b.id) : distA - distB;
      });

    const escolhido = compativeis[0];
    if (!escolhido) continue;

    usados.add(escolhido.id);
    casamentos.push({ transactionId: escolhido.id, billId: fatura.billId });
  }

  return casamentos;
}

/**
 * A reserva, para o conector que nao devolve fatura nenhuma.
 *
 * Deliberadamente estreita: exige a palavra do pagamento **e** a do cartao ou da
 * fatura, juntas. "PAGAMENTO ALUGUEL" tem a primeira e nao passa; "FATURA DE
 * ENERGIA" tem a segunda e nao passa.
 */
export function parecePagamentoDeFatura(description: string): boolean {
  const texto = normalizeDescription(description);
  const temPagamento = /\b(pagto|pagamento)\b/.test(texto);
  if (!temPagamento) return false;
  return /\b(fatura|cartao)\b/.test(texto);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS. Se `parecePagamentoDeFatura` falhar no acento, confira que `normalizeDescription` remove diacríticos e baixa a caixa — ele já faz as duas coisas para a categorização.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/pagamentoDeFatura.ts apps/api/src/lib/pagamentoDeFatura.test.ts
git commit -m "feat(api): casamento entre fatura paga e o debito que a pagou"
```

---

### Task 3: O vínculo da transação com a fatura

**Files:**
- Modify: `apps/api/src/lib/pluggyMapping.ts`
- Test: `apps/api/src/lib/pluggyMapping.test.ts`
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`

**Interfaces:**
- Consumes: `DadosDeParcela` (existente).
- Produces: `DadosDeParcela.pluggyBillId: string | null` — **o tipo ganhou um campo**, e `camposDaTransacao` o propaga por já espalhar `...parcela`.

- [ ] **Step 1: Escrever os testes**

Em `apps/api/src/lib/pluggyMapping.test.ts`, dentro do `describe("dadosDeParcela")`, acrescente:

```ts
  it("le o billId quando a fatura ja fechou", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          billId: "bill-abc",
        },
      } as any).pluggyBillId
    ).toBe("bill-abc");
  });

  it("fatura ainda aberta vem sem billId", () => {
    // Enquanto a fatura nao fecha, a transacao e PENDING e nao tem vinculo. O
    // evento `transactions/updated` e quem avisa que passou a ter.
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 },
      } as any).pluggyBillId
    ).toBeNull();
  });

  it("sem creditCardMetadata nao ha fatura", () => {
    expect(
      dadosDeParcela({ date: new Date("2026-08-10T00:00:00Z"), creditCardMetadata: null } as any)
        .pluggyBillId
    ).toBeNull();
  });
```

**Atenção:** os casos existentes desse `describe` usam `toEqual` sobre o objeto inteiro e vão falhar com o campo novo. Acrescente `pluggyBillId: null` a cada objeto esperado nos testes "le numero e total do creditCardMetadata", "prefere o billForecastDate para o mes da fatura", "sem creditCardMetadata, os tres campos ficam nulos" e "compra a vista no cartao tem fatura, mas nao tem parcela". Exemplo do primeiro:

```ts
    ).toEqual({
      installmentIndex: 3,
      installmentTotal: 10,
      billMonth: "2026-09",
      pluggyBillId: null,
    });
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npm run test --workspace=apps/api
```

Esperado: FAIL — `pluggyBillId` é `undefined`, não `null`.

- [ ] **Step 3: Ampliar `DadosDeParcela`**

Em `apps/api/src/lib/pluggyMapping.ts`, na interface `DadosDeParcela`, acrescente:

```ts
  /**
   * A fatura a que a Pluggy ja vinculou a linha. Nulo enquanto a fatura esta
   * aberta — o vinculo nasce no fechamento.
   */
  pluggyBillId: string | null;
```

- [ ] **Step 4: Preencher nos três retornos**

Ainda em `dadosDeParcela`, o corpo passa a ser:

```ts
  const meta = pTx.creditCardMetadata;
  if (!meta) {
    return {
      installmentIndex: null,
      installmentTotal: null,
      billMonth: null,
      pluggyBillId: null,
    };
  }

  const total = inteiroNaFaixa(meta.totalInstallments, 1, 999);
  const indice = total === null ? null : inteiroNaFaixa(meta.installmentNumber, 1, total);

  // O deslocamento usa o indice **ja validado**: uma parcela "0 de 10" nao pode
  // empurrar a fatura para tras.
  const billMonth = mesDaFatura(new Date(pTx.date), meta.billForecastDate, indice);
  const pluggyBillId = meta.billId ?? null;

  return indice === null
    ? { installmentIndex: null, installmentTotal: null, billMonth, pluggyBillId }
    : { installmentIndex: indice, installmentTotal: total, billMonth, pluggyBillId };
```

- [ ] **Step 5: Trazer o campo para a comparação do sync**

Em `apps/api/src/modules/pluggy/pluggy.service.ts`, no `select` de `buscarPorPluggyIds`, acrescente:

```ts
        pluggyBillId: true,
```

E em `naoMudou`, acrescente uma comparação antes do fecho:

```ts
    existente.pluggyBillId === campos.pluggyBillId &&
```

`camposDaTransacao` não precisa mudar: ele já espalha `...parcela`, e o campo novo vem junto.

- [ ] **Step 6: Rodar e compilar**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS.

```bash
npm run build --workspace=apps/api
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/pluggyMapping.ts apps/api/src/lib/pluggyMapping.test.ts apps/api/src/modules/pluggy/pluggy.service.ts
git commit -m "feat(api): vinculo da transacao com a fatura da Pluggy"
```

---

### Task 4: Importar faturas e reconhecer o pagamento

**Files:**
- Create: `apps/api/src/modules/bills/bills.service.ts`
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`

**Interfaces:**
- Consumes: `casarPagamentos`, `parecePagamentoDeFatura`, `JANELA_DE_PAGAMENTO_DIAS` de `../../lib/pagamentoDeFatura`; `ensureSystemCategories` de `../../lib/systemCategories`.
- Produces:
  - `sincronizarFaturas(client: PluggyClient, userId: string, accountId: string, pluggyAccountId: string): Promise<number>` — devolve quantas faturas foram gravadas
  - `reconhecerPagamentos(userId: string): Promise<number>` — devolve quantos débitos viraram transferência

- [ ] **Step 1: Escrever o service**

Crie `apps/api/src/modules/bills/bills.service.ts`:

```ts
import type { PluggyClient } from "pluggy-sdk";
import { Prisma, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import { ensureSystemCategories } from "../../lib/systemCategories";
import {
  JANELA_DE_PAGAMENTO_DIAS,
  casarPagamentos,
  parecePagamentoDeFatura,
  type DebitoCandidato,
  type FaturaPaga,
} from "../../lib/pagamentoDeFatura";

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Traz as faturas de uma conta de credito e as guarda.
 *
 * O `payments[]` que vem junto e o ponto: e a instituicao dizendo que a fatura
 * foi paga, quando e por quanto. Sem ele, reconhecer o pagamento na conta
 * corrente seria adivinhacao por descricao.
 *
 * Falha de rede nao derruba o sync: uma conta sem fatura importada se comporta
 * como se comportava antes desta feature existir.
 */
export async function sincronizarFaturas(
  client: PluggyClient,
  userId: string,
  accountId: string,
  pluggyAccountId: string
): Promise<number> {
  const resposta = await client.fetchCreditCardBills(pluggyAccountId).catch((err: any) => {
    console.warn(`Erro ao buscar faturas da conta ${pluggyAccountId}:`, err?.message);
    return null;
  });

  if (!resposta) return 0;

  let gravadas = 0;

  for (const bill of resposta.results) {
    // A Pluggy pode devolver varios pagamentos por fatura (parcial e depois o
    // resto). O ultimo e o que quita, e e o unico que interessa para casar com
    // o debito na conta corrente.
    const ultimoPagamento = [...(bill.payments ?? [])].sort(
      (a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()
    ).pop();

    const dados = {
      userId,
      accountId,
      dueDate: new Date(bill.dueDate),
      closingDate: bill.billClosingDate ? new Date(bill.billClosingDate) : null,
      totalAmount: new Prisma.Decimal(bill.totalAmount ?? 0),
      paidAt: ultimoPagamento ? new Date(ultimoPagamento.paymentDate) : null,
      paidAmount: ultimoPagamento ? new Prisma.Decimal(ultimoPagamento.amount) : null,
    };

    await prisma.creditCardBill.upsert({
      where: { pluggyBillId: bill.id },
      update: dados,
      create: { pluggyBillId: bill.id, ...dados },
    });

    gravadas++;
  }

  return gravadas;
}

/**
 * Marca como transferencia os debitos que pagaram faturas.
 *
 * Roda depois do sync, sobre o usuario inteiro, porque as duas pontas moram em
 * contas diferentes e podem ter chegado em sincronizacoes diferentes.
 *
 * So mexe em linha que ainda nao tem categoria de transferencia: um debito que
 * o usuario ja categorizou a mao nao e reclassificado por um palpite nosso.
 */
export async function reconhecerPagamentos(userId: string): Promise<number> {
  const systemIds = await ensureSystemCategories(prisma, userId);
  const transferId = systemIds[SystemCategoryKey.TRANSFER];

  const faturasPagas = await prisma.creditCardBill.findMany({
    where: { userId, paidAt: { not: null }, paidAmount: { not: null } },
    select: { pluggyBillId: true, accountId: true, paidAt: true, paidAmount: true },
  });

  if (faturasPagas.length === 0) return 0;

  const faturas: FaturaPaga[] = faturasPagas.map((f) => ({
    billId: f.pluggyBillId,
    accountId: f.accountId,
    paidAt: f.paidAt!,
    paidAmount: Number(f.paidAmount!),
  }));

  // A janela de busca e a das faturas mais a folga do casamento: buscar o
  // periodo inteiro traria transacoes que nao podem casar com nada.
  const datas = faturas.map((f) => f.paidAt.getTime());
  const folga = JANELA_DE_PAGAMENTO_DIAS * DIA_MS;

  const linhas = await prisma.transaction.findMany({
    where: {
      userId,
      type: "EXPENSE",
      categoryId: { not: transferId },
      date: {
        gte: new Date(Math.min(...datas) - folga),
        lte: new Date(Math.max(...datas) + folga),
      },
      // Conta de credito nao paga fatura de cartao: a ponta de la e um credito
      // no proprio cartao, e o pareamento de transferencia ja cuida dela.
      account: { type: { not: "CREDIT" } },
    },
    select: { id: true, accountId: true, date: true, amount: true },
  });

  const candidatos: DebitoCandidato[] = linhas.map((l) => ({
    id: l.id,
    accountId: l.accountId,
    date: l.date,
    amount: Number(l.amount),
  }));

  const casamentos = casarPagamentos(faturas, candidatos);
  const idsCasados = new Set(casamentos.map((c) => c.transactionId));

  // A reserva, para conector que nao devolveu fatura: descricao explicita de
  // pagamento de fatura, sobre o que sobrou.
  const porDescricao = await prisma.transaction.findMany({
    where: {
      userId,
      type: "EXPENSE",
      categoryId: { not: transferId },
      id: { notIn: [...idsCasados] },
      account: { type: { not: "CREDIT" } },
    },
    select: { id: true, description: true },
  });

  const idsPorDescricao = porDescricao
    .filter((t) => parecePagamentoDeFatura(t.description))
    .map((t) => t.id);

  const todos = [...idsCasados, ...idsPorDescricao];
  if (todos.length === 0) return 0;

  await prisma.transaction.updateMany({
    where: { id: { in: todos }, userId },
    data: { categoryId: transferId },
  });

  return todos.length;
}
```

- [ ] **Step 2: Chamar as duas no sync**

Em `apps/api/src/modules/pluggy/pluggy.service.ts`, acrescente o import no topo:

```ts
import { reconhecerPagamentos, sincronizarFaturas } from "../bills/bills.service";
```

Dentro de `syncItem`, logo **depois** do bloco que semeia `creditCardDueDay` (o `if (tipoDaConta === AccountType.CREDIT) { await prisma.account.updateMany(...) }`), acrescente:

```ts
    // Fatura só existe em conta de crédito, e é uma chamada a mais por conta:
    // por isso só para elas.
    if (tipoDaConta === AccountType.CREDIT) {
      await sincronizarFaturas(client, userId, accountRecord.id, pAccount.id);
    }
```

E no fim de `syncItem`, imediatamente **antes** do `return`, acrescente:

```ts
  // Depois de tudo importado: as duas pontas de um pagamento moram em contas
  // diferentes e podem ter chegado em sincronizações diferentes.
  await reconhecerPagamentos(userId).catch((err: any) => {
    // Reconhecimento é melhoria, não requisito: falhar aqui não pode desfazer
    // um sync que já gravou tudo.
    console.warn(`Erro ao reconhecer pagamentos de fatura:`, err?.message || err);
    return 0;
  });
```

- [ ] **Step 3: Compilar e testar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS.

```bash
npm run test --workspace=apps/api
```

Esperado: PASS.

- [ ] **Step 4: Verificar à mão**

Com `npm run dev`, sincronize a conexão do cartão no Perfil. Depois confirme:
- em Transações, o débito de pagamento da fatura na conta corrente está com a categoria "Transferência entre contas";
- em Relatórios, o total de despesas **não** cresceu pelo valor da fatura;
- a soma das compras do cartão continua aparecendo por categoria.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/bills apps/api/src/modules/pluggy/pluggy.service.ts
git commit -m "feat(api): importar faturas e reconhecer o pagamento como transferencia"
```

---

### Task 5: O webhook

**Files:**
- Create: `apps/api/src/modules/pluggy/webhook.routes.ts`
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `camposDaTransacao`, `buscarPorPluggyIds`, `naoMudou` (internos de `pluggy.service.ts`); `getPluggyClientForUser`.
- Produces:
  - `sincronizarPorIds(userId: string, pluggyAccountId: string, transactionIds: string[]): Promise<number>` exportada de `pluggy.service.ts`
  - `webhookRouter` exportado de `webhook.routes.ts`
  - Rota: `POST /api/pluggy/webhook`

- [ ] **Step 1: Escrever `sincronizarPorIds`**

No fim de `apps/api/src/modules/pluggy/pluggy.service.ts`:

```ts
/**
 * Reescreve **exatamente** as transações que o webhook nomeou.
 *
 * É o caminho barato: `transactions/updated` traz os ids, e buscar só eles
 * mantém a requisição num tamanho conhecido — que é o que o teto de sessenta
 * segundos de uma função serverless exige de algo disparado de fora.
 *
 * Como o sync e o reparo, só atualiza o que já existe: transação que o app
 * nunca importou não nasce por webhook.
 */
export async function sincronizarPorIds(
  userId: string,
  pluggyAccountId: string,
  transactionIds: string[]
): Promise<number> {
  if (transactionIds.length === 0) return 0;

  const account = await prisma.account.findFirst({
    where: { pluggyAccountId, userId },
    select: { id: true },
  });

  // Conta de outro usuário, ou que o app não conhece: nada a fazer, e sem erro
  // — um webhook que responde erro é um webhook que a Pluggy desativa.
  if (!account) return 0;

  const client = await getPluggyClientForUser(userId);

  // `emLotes` usa LOTE = 500, que é exatamente o teto de ids por requisição do
  // SDK — serve aqui sem ajuste. Dentro do lote ainda há paginação: o cursor é
  // seguido até o fim, porque parar na primeira página perderia transações em
  // silêncio, que é o pior modo de falhar num vínculo de fatura.
  const transactions: PluggyTransaction[] = [];

  for (const lote of emLotes(transactionIds)) {
    let after: string | undefined;

    do {
      const pagina = await client
        .fetchTransactionsCursor(pluggyAccountId, { ids: lote, after })
        .catch((err: any) => {
          console.warn(`Erro ao buscar transações do webhook:`, err?.message);
          return null;
        });

      if (!pagina) break;

      transactions.push(...pagina.results);
      after = pagina.next ?? undefined;
    } while (after);
  }

  if (transactions.length === 0) return 0;

  const existentes = await buscarPorPluggyIds(transactions.map((t) => t.id));
  const existentePorPluggyId = new Map(
    existentes.map((t) => [t.pluggyTransactionId!, t] as const)
  );

  const alteracoes: Prisma.PrismaPromise<unknown>[] = [];

  for (const pTx of transactions) {
    const existente = existentePorPluggyId.get(pTx.id);
    if (!existente) continue;

    const campos = camposDaTransacao(pTx, account.id);
    if (naoMudou(existente, campos)) continue;

    alteracoes.push(prisma.transaction.update({ where: { id: existente.id }, data: campos }));
  }

  for (const lote of emLotes(alteracoes)) {
    await prisma.$transaction(lote);
  }

  return alteracoes.length;
}
```

- [ ] **Step 2: Escrever a rota**

Crie `apps/api/src/modules/pluggy/webhook.routes.ts`:

```ts
import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../middleware/errorHandler";
import { sincronizarPorIds } from "./pluggy.service";

export const webhookRouter = Router();

/**
 * O header que autentica a Pluggy.
 *
 * A Pluggy não assina os webhooks deste SDK: `createWebhook` aceita headers
 * arbitrários, e é esse o mecanismo previsto. O segredo é registrado junto com o
 * webhook e conferido aqui.
 */
const HEADER = "x-poup-webhook-secret";

/** Comparação em tempo constante — comparar segredo com `===` vaza o prefixo. */
function segredoConfere(recebido: unknown): boolean {
  const esperado = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!esperado || typeof recebido !== "string") return false;

  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // `timingSafeEqual` exige o mesmo tamanho, e o próprio tamanho é informação:
  // por isso a checagem sai antes, e o retorno é o mesmo `false` de sempre.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Onde a Pluggy avisa que algo mudou.
 *
 * Fica fora do `pluggyRouter` de propósito: aquele exige sessão de usuário, e
 * aqui quem chama é um servidor. A autenticação é o header, e nada acontece
 * antes de ele conferir.
 *
 * Responde 200 para evento que não interessa em vez de 4xx: a Pluggy desativa
 * webhook que responde erro, e "não é comigo" não é erro.
 */
webhookRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!segredoConfere(req.header(HEADER))) {
      res.status(401).json({ error: "Não autorizado." });
      return;
    }

    const evento = req.body?.event;
    const itemId = req.body?.itemId;

    if (typeof itemId !== "string") {
      res.json({ ok: true });
      return;
    }

    const item = await prisma.item.findFirst({
      where: { pluggyItemId: itemId },
      select: { id: true, userId: true },
    });

    if (!item) {
      res.json({ ok: true });
      return;
    }

    if (evento === "transactions/updated") {
      // Os ids vêm no payload: dá para resolver o vínculo agora, num tamanho
      // conhecido. É o "sem polling" que a fatura fechada exige.
      const ids: unknown = req.body?.transactionIds;
      const accountId: unknown = req.body?.accountId;

      if (Array.isArray(ids) && typeof accountId === "string") {
        const atualizadas = await sincronizarPorIds(
          item.userId,
          accountId,
          ids.filter((id): id is string => typeof id === "string")
        );
        res.json({ ok: true, updated: atualizadas });
        return;
      }
    }

    if (evento === "transactions/created") {
      // O payload traz um link, e não os ids: o volume não tem tamanho
      // conhecido, e o sync normal resolve. Aqui só fica o aviso.
      await prisma.item.update({
        where: { id: item.id },
        data: { hasPendingSync: true },
      });
    }

    res.json({ ok: true });
  })
);
```

- [ ] **Step 3: Montar o router antes do `pluggyRouter`**

Em `apps/api/src/app.ts`, acrescente o import junto dos outros routers:

```ts
import { webhookRouter } from "./modules/pluggy/webhook.routes";
```

E monte **antes** da linha `apiRouter.use("/pluggy", pluggyRouter);`:

```ts
// Antes do `/pluggy` de propósito: aquele router aplica `requireAuth` a tudo
// que casa, e quem chama o webhook é a Pluggy, sem sessão. O Express casa
// prefixos na ordem em que foram montados.
apiRouter.use("/pluggy/webhook", webhookRouter);
```

- [ ] **Step 4: Limpar o aviso quando o sync roda**

Em `apps/api/src/modules/pluggy/pluggy.service.ts`, dentro de `syncItem`, no `prisma.item.update` que grava `lastSyncedAt` ao fim (procure por `lastSyncedAt: new Date()` no update do item), acrescente ao `data`:

```ts
      // O sync rodou: o aviso do webhook cumpriu o papel.
      hasPendingSync: false,
```

Se `syncItem` não tiver um update final do item, acrescente-o imediatamente antes do `return`:

```ts
  await prisma.item.update({
    where: { id: itemRecord.id },
    data: { lastSyncedAt: new Date(), hasPendingSync: false },
  });
```

- [ ] **Step 5: Registrar o webhook quando as credenciais são salvas**

Em `apps/api/src/modules/auth/auth.service.ts`, acrescente no topo:

```ts
import { createPluggyClient } from "../../lib/pluggy";
```

`createPluggyClient` e usado no lugar de `new PluggyClient(...)` de proposito: ele
passa `baseUrl: env.PLUGGY_BASE_URL` junto, e instanciar o cliente a mao deixaria
o registro do webhook falando com o ambiente errado da Pluggy.

E, logo acima de `updatePluggyCredentials`, acrescente:

```ts
/**
 * Registra os webhooks na aplicação Pluggy **do usuário**.
 *
 * Cada usuário fala com a Pluggy com a própria aplicação, então o webhook
 * precisa ser registrado uma vez por aplicação — e não uma vez no app. O
 * `itemId` do payload é quem diz depois de quem é o evento.
 *
 * Nunca derruba o salvamento das credenciais: um webhook que não registrou
 * deixa o app exatamente como ele é hoje, que é sincronizando pelo botão.
 */
async function registrarWebhooks(clientId: string, clientSecret: string): Promise<void> {
  const base = process.env.PUBLIC_API_URL;
  const segredo = process.env.PLUGGY_WEBHOOK_SECRET;

  if (!base || !segredo) {
    console.warn("PUBLIC_API_URL ou PLUGGY_WEBHOOK_SECRET ausentes: webhooks não registrados.");
    return;
  }

  try {
    const client = createPluggyClient(clientId, clientSecret);
    const url = `${base.replace(/\/$/, "")}/api/pluggy/webhook`;
    const existentes = await client.fetchWebhooks();

    for (const evento of ["transactions/created", "transactions/updated"] as const) {
      const jaTem = existentes.results.some(
        (w) => w.event === evento && w.url === url && !w.disabledAt
      );
      if (jaTem) continue;
      await client.createWebhook(evento, url, { "x-poup-webhook-secret": segredo });
    }
  } catch (err: any) {
    console.warn("Não foi possível registrar os webhooks na Pluggy:", err?.message || err);
  }
}
```

E chame-a dentro de `updatePluggyCredentials`, logo **depois** da linha que confirma `credentialsOk` e antes do `prisma.user.update`:

```ts
  await registrarWebhooks(clientId, clientSecret);
```

Faça o mesmo em `register` (a função que cria o usuário, por volta da linha 129), no mesmo ponto — depois de `verifyPluggyCredentials` e antes de gravar.

- [ ] **Step 6: Documentar as variáveis**

Em `apps/api/.env.example`, acrescente:

```
# URL pública desta API, sem barra no fim. É para onde a Pluggy manda os
# webhooks — em desenvolvimento, o endereço de um túnel.
PUBLIC_API_URL=

# Segredo que a Pluggy devolve no header `x-poup-webhook-secret`. Gere um valor
# longo e aleatório; sem ele os webhooks não são registrados nem aceitos.
PLUGGY_WEBHOOK_SECRET=
```

- [ ] **Step 7: Compilar e testar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS.

```bash
npm run test --workspace=apps/api
```

Esperado: PASS.

- [ ] **Step 8: Verificar a rota à mão**

Com a API rodando, confirme os três comportamentos:

```bash
curl -s -o /dev/null -w "sem header -> %{http_code}\n" -X POST http://localhost:4000/api/pluggy/webhook -H "Content-Type: application/json" -d '{"event":"transactions/created","itemId":"x"}'
```

Esperado: `401`.

```bash
curl -s -w "\n" -X POST http://localhost:4000/api/pluggy/webhook -H "Content-Type: application/json" -H "x-poup-webhook-secret: $PLUGGY_WEBHOOK_SECRET" -d '{"event":"transactions/created","itemId":"item-que-nao-existe"}'
```

Esperado: `{"ok":true}` — e nenhum erro no log. Um item desconhecido não é erro.

Por fim, com um `pluggyItemId` real seu, o mesmo POST tem de deixar `hasPendingSync` verdadeiro naquela conexão.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/pluggy apps/api/src/modules/auth/auth.service.ts apps/api/src/app.ts apps/api/.env.example
git commit -m "feat(api): webhook da Pluggy com header secreto e vinculo resolvido na hora"
```

---

### Task 6: Web — o aviso de novidade

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`
- Modify: `apps/web/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `ItemDTO` de `@poup/shared`.
- Produces: `ItemDTO.hasPendingSync: boolean`.

- [ ] **Step 1: Ampliar `ItemDTO`**

Em `packages/shared/src/index.ts`, em `ItemDTO`, logo depois de `lastSyncedAt`:

```ts
  /**
   * O webhook avisou que ha transacao nova nesta conexao e o sync ainda nao
   * rodou. O app nunca sincroniza sozinho: isto e um convite, nao um estado.
   */
  hasPendingSync: boolean;
```

- [ ] **Step 2: Devolver o campo**

Em `apps/api/src/modules/pluggy/pluggy.service.ts`, na função `toItemDTO`, acrescente ao objeto devolvido:

```ts
    hasPendingSync: item.hasPendingSync,
```

Se o `select` de alguma leitura de item listar colunas explicitamente, acrescente `hasPendingSync: true` a ele.

- [ ] **Step 3: Compilar o shared**

```bash
npm run build:shared
```

Esperado: PASS.

- [ ] **Step 4: Mostrar o ponto na conexão**

Em `apps/web/src/pages/ProfilePage.tsx`, no botão "Sincronizar" de cada conexão, substitua o texto do botão por um que mostre a novidade:

```tsx
                        {item.hasPendingSync ? "Sincronizar •" : "Sincronizar"}
```

E, logo abaixo do `<span>` da última sincronização, acrescente:

```tsx
                        {item.hasPendingSync && (
                          <span className="text-[11px] text-primary block mt-0.5">
                            Há transações novas nesta conexão.
                          </span>
                        )}
```

- [ ] **Step 5: Compilar**

```bash
npm run build --workspace=apps/web
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/modules/pluggy/pluggy.service.ts apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): aviso de transacao nova na conexao, vindo do webhook"
```

---

### Task 7: Verificação de ponta a ponta e documentação

**Files:**
- Modify: `docs/PLAN.md`

**Interfaces:**
- Consumes: tudo acima.
- Produces: nada.

- [ ] **Step 1: Rodar tudo**

```bash
npm run build
```

Esperado: PASS nos três workspaces.

```bash
npm run test --workspace=apps/api
```

Esperado: PASS.

```bash
npm run test --workspace=apps/web
```

Esperado: PASS.

- [ ] **Step 2: Verificar o caminho completo**

Com `npm run dev`:

1. **Faturas importadas** — sincronize a conexão do cartão e confirme no banco que `CreditCardBill` tem linhas, com `dueDate` batendo com a fatura real.
2. **Pagamento neutro** — o débito da fatura na conta corrente está como "Transferência entre contas", e o total de despesas do Relatório **não** inclui o valor da fatura.
3. **Nada sumiu** — as compras do cartão continuam aparecendo por categoria, com os mesmos valores.
4. **Desconto não duplica** — um estorno no cartão aparece uma vez, como receita, no mês da fatura dele.
5. **Idempotência** — sincronize de novo. Nenhuma transação muda de categoria, e nenhuma fatura duplica.
6. **Webhook** — os três `curl` da Task 5, Step 8.

- [ ] **Step 3: Registrar no `docs/PLAN.md`**

Na lista numerada, acrescente ao fim (o último item, depois do plano irmão, é o 52):

```markdown
53. Faturas do cartão importadas da Pluggy (`CreditCardBill`), com vencimento,
    fechamento, total e o pagamento que a instituição reporta
54. Pagamento de fatura reconhecido na conta corrente e categorizado como
    transferência — a despesa do cartão parou de contar duas vezes
55. Webhook da Pluggy: `transactions/updated` resolve o vínculo com a fatura na
    hora, `transactions/created` avisa que há novidade na conexão
```

Na tabela de **Backlog**, acrescente:

```markdown
| Guardar os eventos de webhook recebidos | Evento perdido só chega no próximo sync |
| Pluggy Payments (ITP) | Poup lê; não inicia pagamento |
```

- [ ] **Step 4: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs: registrar faturas, pagamento neutro e webhooks no PLAN.md"
```

---

## Notas para quem executar

- **Execute o plano irmão primeiro.** `camposDaTransacao`, `naoMudou` e `competenceDate` nascem lá, e as Tasks 3 e 5 daqui os usam como se já existissem.
- **Se o webhook responder 404**, ele foi montado depois do `pluggyRouter` em `app.ts`. O Express casa prefixos na ordem de montagem, e `/pluggy` engole `/pluggy/webhook`.
- **Se o webhook responder 401 com o header certo**, `PLUGGY_WEBHOOK_SECRET` não está no ambiente do processo da API — confira `apps/api/.env`, não a raiz.
- **Em desenvolvimento a Pluggy não alcança `localhost`.** Para testar de verdade é preciso um túnel, e `PUBLIC_API_URL` tem de apontar para ele **antes** de salvar as credenciais, porque é no salvamento que o webhook é registrado. Sem túnel, os `curl` da Task 5 cobrem o comportamento da rota.
- **Se um débito real virar transferência**, a heurística de descrição foi longe demais. Ela exige a palavra do pagamento **e** a do cartão ou da fatura juntas; se ainda assim errar, o caminho é restringi-la, e não afrouxar o casamento por valor.
- **A fatura nunca vira linha de despesa.** Se em algum lugar novo você somar `CreditCardBill.totalAmount` ao lado das transações, o gasto conta duas vezes — é exatamente o bug que este plano existe para fechar.
