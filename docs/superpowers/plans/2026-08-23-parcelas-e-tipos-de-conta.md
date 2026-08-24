# Parcelas, tipos de conta e o sinal do `type` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Poup parar de inverter estornos, mostrar em que parcela e em que fatura cada compra de cartão cai, classificar contas (inclusive cartão de débito, que a Pluggy não tem), e tirar a poupança do saldo disponível por padrão.

**Architecture:** Toda a regra de mapeamento sai do meio do `syncItem` e vira funções puras em `apps/api/src/lib/pluggyMapping.ts`, testáveis sem banco e sem rede — é o padrão já estabelecido por `lib/categorization/`. A data de vencimento de uma parcela **não é gravada**: a transação guarda o mês da fatura (`billMonth`) e a conta guarda o dia de vencimento (`creditCardDueDay`); o DTO combina os dois na leitura, para que corrigir o dia do cartão conserte todas as parcelas de uma vez. O tipo da conta vira duas colunas — a que o sync escreve e a que o usuário escolhe — no mesmo padrão de `name`/`customName` que já existe.

**Tech Stack:** Node + Express + TypeScript + Prisma (Postgres/Neon), React + Vite + Tailwind, vitest, pluggy-sdk.

**Spec:** `docs/superpowers/specs/2026-08-23-parcelas-e-tipos-de-conta-design.md`

## Global Constraints

- **Datas são gravadas e comparadas em UTC.** Use `Date.UTC(...)`, `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()` — nunca os equivalentes locais. `reports.service.ts` e `pluggy.service.ts` já fazem assim; divergir quebra a chave de mês e desloca vencimento em um dia para quem está em GMT-3.
- **Chave de mês é `"YYYY-MM"`**, com o mês em dois dígitos (`padStart(2, "0")`).
- **Migrações são SQL escrito à mão** em `apps/api/prisma/migrations/<timestamp>_<nome_snake_case>/migration.sql`, com um comentário no topo explicando *por que* a coluna existe. **Nunca rode `prisma migrate dev`** (ele tentaria gerar a migração sozinho e pode resetar o banco): crie o diretório e o arquivo, e aplique com `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma`.
- **O banco `DATABASE_URL` tem mais de uma conta real.** Todo `UPDATE`/`DELETE` de manutenção precisa ser escopado por `userId`, **exceto** os dois backfills da Task 1, que são padrões novos do app e valem para todos os usuários de propósito.
- **Moeda no banco é `Decimal(14, 2)`**; nos DTOs trafega como `number`. Nenhuma coluna de dinheiro nova aqui.
- **`amount` é sempre positivo.** O sinal mora em `type`. Isso já valia e continua valendo.
- **Todo valor em dinheiro exibido no web passa por `<Money>`** (`apps/web/src/components/ui/Money.tsx`). Sem isso o modo discreto vaza.
- **Nada de `any` novo.** Cada workspace compila com `tsc`.
- **Testes ficam ao lado do fonte**, como `apps/api/src/lib/categorization/normalize.test.ts`.
  - API: `npm run test --workspace=apps/api`
  - Web: `npm run test --workspace=apps/web`
- **Comentário explica o porquê, não o quê**, em português, no tom dos comentários já existentes em `schema.prisma` e `lib/categorization/`.
- **`packages/shared` precisa ser recompilado** depois de mexer em `packages/shared/src/index.ts`, ou a API e o web seguem vendo os tipos antigos: `npm run build:shared`.

---

## Mapa de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/lib/pluggyMapping.ts` | Todas as decisões puras sobre o que a Pluggy manda: sinal, valor absoluto, parcela, mês da fatura, vencimento, dia inicial |
| `apps/api/src/lib/pluggyMapping.test.ts` | Testes das acima |
| `apps/api/prisma/migrations/20260823120000_parcelas_e_tipos_de_conta/migration.sql` | Colunas novas e os dois backfills |
| `apps/web/src/components/profile/EditAccountModal.tsx` | Substitui `RenameAccountModal`: nome, tipo e dia de vencimento |

**Modificados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/prisma/schema.prisma` | `DEBIT_CARD`; `Account.customType`, `Account.creditCardDueDay`; `Transaction.installmentIndex`, `installmentTotal`, `billMonth` |
| `apps/api/src/modules/pluggy/pluggy.service.ts` | Consome `pluggyMapping`; semeia poupança e dia de vencimento; grava parcela; ganha `repairAccount` |
| `apps/api/src/modules/pluggy/pluggy.routes.ts` | Rota de reparo |
| `apps/api/src/modules/accounts/accounts.service.ts` | `resolveAccountType`; campos novos no DTO; validação do dia de vencimento |
| `apps/api/src/modules/accounts/accounts.routes.ts` | zod dos campos novos |
| `apps/api/src/modules/transactions/transactions.service.ts` | `formatTransactionDTO` exportado, com parcela e `dueDate` |
| `apps/api/src/modules/categorization/suggestions.service.ts` | Passa a reusar `formatTransactionDTO` |
| `apps/api/src/modules/categorization/similar.service.ts` | Passa a reusar `formatTransactionDTO` |
| `packages/shared/src/index.ts` | `AccountType`, `AccountDTO`, `TransactionDTO`, `UpdateAccountRequest` |
| `apps/web/src/lib/accounts.ts` | `DEBIT_CARD` no líquido; rótulos dos cinco tipos |
| `apps/web/src/lib/accounts.test.ts` | Casos novos |
| `apps/web/src/lib/api.ts` | `repairAccount` |
| `apps/web/src/pages/ProfilePage.tsx` | Selo de tipo; botão "Reparar histórico" |
| `apps/web/src/pages/TransactionsPage.tsx` | Selo `3/10` nas duas listas |
| `apps/web/src/components/transactions/TransactionDetailModal.tsx` | Linha de parcela e vencimento |
| `docs/PLAN.md` | Registra o que passou a existir |

**Removido**

| Arquivo | Motivo |
|---|---|
| `apps/web/src/components/profile/RenameAccountModal.tsx` | Vira `EditAccountModal` |

---

### Task 1: Schema e migração

Todas as colunas numa migração só. Separá-las não daria rollback útil — são um pacote — e multiplicaria o custo de aplicar no Neon.

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260823120000_parcelas_e_tipos_de_conta/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: valor `DEBIT_CARD` no enum Prisma `AccountType`; campos `Account.customType: AccountType | null`, `Account.creditCardDueDay: number | null`, `Transaction.installmentIndex: number | null`, `Transaction.installmentTotal: number | null`, `Transaction.billMonth: string | null`.

- [ ] **Step 1: Adicionar `DEBIT_CARD` ao enum**

Em `apps/api/prisma/schema.prisma`, substitua o enum inteiro:

```prisma
enum AccountType {
  CHECKING
  SAVINGS
  CREDIT
  /// Inalcancavel pelo sync: a Pluggy nao tem "cartao de debito" — para ela um
  /// cartao de debito e a propria conta corrente a que esta preso. Este valor
  /// so chega aqui por `customType`, quando o usuario rotula a conta a mao.
  DEBIT_CARD
  INVESTMENT
}
```

- [ ] **Step 2: Adicionar os campos de `Account`**

Em `model Account`, logo depois da linha `excludedFromBalance Boolean  @default(false)`:

```prisma
  /// Tipo escolhido pelo usuario. Tem precedencia sobre `type`, que o sync
  /// reescreve a cada atualizacao a partir do que a Pluggy derivou. Mesma
  /// divisao de `name`/`customName`: o sync escreve uma coluna e nunca a outra.
  customType       AccountType?
  /// Dia do mes em que a fatura do cartao vence, 1 a 31. Semeado do
  /// `creditData.balanceDueDate` da Pluggy no primeiro contato e, dali em
  /// diante, so o usuario muda. E o que transforma o mes da fatura de uma
  /// parcela (`Transaction.billMonth`) numa data de vencimento — por isso mora
  /// na conta, e nao repetido em cada transacao: corrigir o dia aqui conserta
  /// todas as parcelas de uma vez.
  creditCardDueDay Int?
```

- [ ] **Step 3: Adicionar os campos de `Transaction`**

Em `model Transaction`, logo depois de `isRecurring Boolean @default(false)`:

```prisma
  /// Numero desta parcela e total de parcelas, como a Pluggy os entrega em
  /// `creditCardMetadata`. Os dois andam juntos: meia parcela nao e parcela, e
  /// quando so um dos dois vem, ambos ficam nulos.
  installmentIndex    Int?
  installmentTotal    Int?
  /// A fatura em que a linha cai, como "YYYY-MM". Vem do `billForecastDate` da
  /// Pluggy quando o conector e Open Finance; senao e derivado do mes da
  /// transacao. Nulo fora de cartao de credito.
  billMonth           String?
```

- [ ] **Step 4: Escrever a migração**

Crie `apps/api/prisma/migrations/20260823120000_parcelas_e_tipos_de_conta/migration.sql`:

```sql
-- Parcelas, tipos de conta e vencimento de cartao.
--
-- `DEBIT_CARD` existe porque a Pluggy nao tem esse conceito: para ela um cartao
-- de debito e a conta corrente a que esta preso. O valor so e alcancado por
-- `customType`, preenchido a mao.
--
-- ATENCAO: no Postgres um valor de enum recem-adicionado nao pode ser USADO na
-- mesma transacao em que foi criado. Os dois UPDATE abaixo so mencionam valores
-- que ja existiam ('SAVINGS', 'CREDIT'), entao esta migracao e segura como esta
-- — mas nao acrescente aqui nenhum comando que escreva 'DEBIT_CARD'.
ALTER TYPE "AccountType" ADD VALUE 'DEBIT_CARD';

ALTER TABLE "Account" ADD COLUMN "customType" "AccountType";
ALTER TABLE "Account" ADD COLUMN "creditCardDueDay" INTEGER;

ALTER TABLE "Transaction" ADD COLUMN "installmentIndex" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "installmentTotal" INTEGER;
ALTER TABLE "Transaction" ADD COLUMN "billMonth" TEXT;

-- Poupanca nasce fora do saldo disponivel: ela e reserva, nao e o que se pode
-- gastar hoje. Vale para as contas que ja estao no banco tambem, e nao so para
-- as que chegarem depois — senao a regra so valeria para quem conectar de novo.
-- O olhinho da tela de Perfil e o caminho de volta, conta a conta.
--
-- Escopo global de proposito: e um padrao novo do app, nao dado de um usuario.
UPDATE "Account" SET "excludedFromBalance" = true WHERE "type" = 'SAVINGS';

-- Cartao existente ganha o padrao 10. O `balanceDueDate` da Pluggy nunca foi
-- guardado, entao nao ha de onde tirar o dia certo para quem ja esta aqui;
-- cartao novo recebe o valor real no primeiro sync.
UPDATE "Account" SET "creditCardDueDay" = 10 WHERE "type" = 'CREDIT';
```

- [ ] **Step 5: Aplicar a migração e regenerar o client**

```bash
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

Depois:

```bash
npm run prisma:generate
```

Esperado: `migrate deploy` reporta `1 migration applied`, e `prisma generate` termina com `Generated Prisma Client`.

- [ ] **Step 6: Verificar que a API ainda compila**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS. As colunas são todas nulas e nenhum código as usa ainda.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): parcelas, tipo customizado de conta e dia de vencimento do cartao"
```

---

### Task 2: `pluggyMapping.ts` — as decisões puras, com teste

Todo o julgamento sobre o que a Pluggy mandou fica aqui: nada de Prisma, nada de rede. É o que permite testar o caso do estorno — o bug que abriu este trabalho — sem um cartão de crédito real.

**Files:**
- Create: `apps/api/src/lib/pluggyMapping.ts`
- Test: `apps/api/src/lib/pluggyMapping.test.ts`

**Interfaces:**
- Consumes: os tipos `Account` e `Transaction` do `pluggy-sdk`.
- Produces:
  - `valorAbsoluto(raw: number | null | undefined): number`
  - `sinalDaTransacao(type: string | null | undefined, raw: number | null | undefined): "INCOME" | "EXPENSE"`
  - `mesDaFatura(data: Date, billForecastDate?: string | null): string`
  - `interface DadosDeParcela { installmentIndex: number | null; installmentTotal: number | null; billMonth: string | null }`
  - `dadosDeParcela(pTx: Pick<PluggyTransaction, "date" | "creditCardMetadata">): DadosDeParcela`
  - `vencimentoDaFatura(billMonth: string | null, dueDay: number | null): Date | null`
  - `diaDeVencimentoInicial(pAccount: Pick<PluggyAccount, "creditData">): number`
  - `DIA_DE_VENCIMENTO_PADRAO: 10`

- [ ] **Step 1: Escrever o teste, inteiro, antes de qualquer implementação**

Crie `apps/api/src/lib/pluggyMapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DIA_DE_VENCIMENTO_PADRAO,
  dadosDeParcela,
  diaDeVencimentoInicial,
  mesDaFatura,
  sinalDaTransacao,
  valorAbsoluto,
  vencimentoDaFatura,
} from "./pluggyMapping";

describe("sinalDaTransacao", () => {
  // O `type` da Pluggy e a direcao do dinheiro, e e dado — nao palpite. O
  // sinal do valor so entra quando o conector nao mandou `type`.
  it("DEBIT e despesa, com valor positivo", () => {
    expect(sinalDaTransacao("DEBIT", 120.5)).toBe("EXPENSE");
  });

  it("DEBIT e despesa mesmo com valor negativo", () => {
    expect(sinalDaTransacao("DEBIT", -120.5)).toBe("EXPENSE");
  });

  it("CREDIT e receita, com valor positivo", () => {
    expect(sinalDaTransacao("CREDIT", 300)).toBe("INCOME");
  });

  // ESTE e o bug que abriu o trabalho: num cartao, estorno vem CREDIT com
  // valor negativo, e a regra antiga (`|| raw < 0`) o transformava em despesa.
  it("CREDIT com valor negativo e receita — o estorno de cartao", () => {
    expect(sinalDaTransacao("CREDIT", -89.9)).toBe("INCOME");
  });

  it("sem type, o sinal do valor decide", () => {
    expect(sinalDaTransacao(undefined, -10)).toBe("EXPENSE");
    expect(sinalDaTransacao(undefined, 10)).toBe("INCOME");
    expect(sinalDaTransacao(null, -10)).toBe("EXPENSE");
  });

  it("type desconhecido cai no sinal do valor", () => {
    expect(sinalDaTransacao("QUALQUERCOISA", -10)).toBe("EXPENSE");
    expect(sinalDaTransacao("QUALQUERCOISA", 10)).toBe("INCOME");
  });

  it("aceita type em caixa baixa", () => {
    expect(sinalDaTransacao("credit", -50)).toBe("INCOME");
  });

  it("zero sem type e receita, nao despesa", () => {
    // Arbitrario, mas precisa ser estavel: `0 < 0` e falso.
    expect(sinalDaTransacao(undefined, 0)).toBe("INCOME");
  });
});

describe("valorAbsoluto", () => {
  it("devolve sempre o modulo", () => {
    expect(valorAbsoluto(-89.9)).toBe(89.9);
    expect(valorAbsoluto(89.9)).toBe(89.9);
  });

  it("trata ausencia como zero", () => {
    expect(valorAbsoluto(null)).toBe(0);
    expect(valorAbsoluto(undefined)).toBe(0);
  });

  it("trata valor nao-finito como zero", () => {
    // Um NaN viraria `Decimal` invalido e derrubaria o lote inteiro do sync.
    expect(valorAbsoluto(NaN)).toBe(0);
    expect(valorAbsoluto(Infinity)).toBe(0);
    expect(valorAbsoluto(-Infinity)).toBe(0);
  });
});

describe("mesDaFatura", () => {
  it("usa o billForecastDate quando a Pluggy manda", () => {
    // E o mes que o proprio banco projetou. Vence qualquer derivacao nossa.
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09")).toBe("2026-09");
  });

  it("ignora billForecastDate malformado e deriva", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "setembro")).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-9")).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "")).toBe("2026-09");
  });

  it("sem billForecastDate, deriva do mes da transacao mais um", () => {
    expect(mesDaFatura(new Date("2026-08-22T14:00:00Z"))).toBe("2026-09");
  });

  it("vira o ano em dezembro", () => {
    expect(mesDaFatura(new Date("2026-12-15T00:00:00Z"))).toBe("2027-01");
  });

  it("mantem o mes em dois digitos", () => {
    expect(mesDaFatura(new Date("2026-01-05T00:00:00Z"))).toBe("2026-02");
  });
});

describe("dadosDeParcela", () => {
  it("le numero e total do creditCardMetadata", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 3, totalInstallments: 10 },
      } as any)
    ).toEqual({ installmentIndex: 3, installmentTotal: 10, billMonth: "2026-09" });
  });

  it("prefere o billForecastDate para o mes da fatura", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 10,
          billForecastDate: "2026-11",
        },
      } as any)
    ).toEqual({ installmentIndex: 3, installmentTotal: 10, billMonth: "2026-11" });
  });

  it("sem creditCardMetadata, os tres campos ficam nulos", () => {
    // O caso da conta corrente: nao ha fatura, entao nao ha vencimento.
    expect(
      dadosDeParcela({ date: new Date("2026-08-10T00:00:00Z"), creditCardMetadata: null } as any)
    ).toEqual({ installmentIndex: null, installmentTotal: null, billMonth: null });
  });

  it("compra a vista no cartao tem fatura, mas nao tem parcela", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { payeeMCC: 5812 },
      } as any)
    ).toEqual({ installmentIndex: null, installmentTotal: null, billMonth: "2026-09" });
  });

  it("meia parcela nao e parcela", () => {
    // Um sem o outro nao diz nada exibivel: "3 de ?" e "? de 10" sao ruido.
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 3 },
      } as any).installmentIndex
    ).toBeNull();

    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { totalInstallments: 10 },
      } as any).installmentTotal
    ).toBeNull();
  });

  it("descarta parcela com numero fora de faixa", () => {
    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 0, totalInstallments: 10 },
      } as any).installmentIndex
    ).toBeNull();

    expect(
      dadosDeParcela({
        date: new Date("2026-08-10T00:00:00Z"),
        creditCardMetadata: { installmentNumber: 11, totalInstallments: 10 },
      } as any).installmentIndex
    ).toBeNull();
  });
});

describe("vencimentoDaFatura", () => {
  it("combina o mes da fatura com o dia da conta", () => {
    expect(vencimentoDaFatura("2026-09", 10)?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("limita ao ultimo dia do mes", () => {
    // Vencimento 31 em fevereiro nao pode virar 3 de marco em silencio, que e
    // o que `Date.UTC(2026, 1, 31)` faz sozinho.
    expect(vencimentoDaFatura("2026-02", 31)?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("respeita ano bissexto", () => {
    expect(vencimentoDaFatura("2028-02", 31)?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("sem dia de vencimento, nao ha data", () => {
    expect(vencimentoDaFatura("2026-09", null)).toBeNull();
  });

  it("sem mes de fatura, nao ha data", () => {
    expect(vencimentoDaFatura(null, 10)).toBeNull();
  });

  it("recusa mes malformado em vez de inventar data", () => {
    expect(vencimentoDaFatura("2026-13", 10)).toBeNull();
    expect(vencimentoDaFatura("setembro", 10)).toBeNull();
  });

  it("recusa dia fora de 1..31", () => {
    expect(vencimentoDaFatura("2026-09", 0)).toBeNull();
    expect(vencimentoDaFatura("2026-09", 32)).toBeNull();
  });
});

describe("diaDeVencimentoInicial", () => {
  it("usa o dia do balanceDueDate da Pluggy", () => {
    expect(
      diaDeVencimentoInicial({
        creditData: { balanceDueDate: new Date("2026-08-15T00:00:00Z") },
      } as any)
    ).toBe(15);
  });

  it("aceita balanceDueDate como string", () => {
    // O SDK tipa como Date, mas o que chega do JSON e string ate o transform.
    expect(diaDeVencimentoInicial({ creditData: { balanceDueDate: "2026-08-05" } } as any)).toBe(5);
  });

  it("cai no padrao quando a Pluggy nao manda", () => {
    expect(diaDeVencimentoInicial({ creditData: null } as any)).toBe(DIA_DE_VENCIMENTO_PADRAO);
    expect(diaDeVencimentoInicial({ creditData: { balanceDueDate: null } } as any)).toBe(10);
    expect(diaDeVencimentoInicial({} as any)).toBe(10);
  });

  it("cai no padrao quando a data e invalida", () => {
    expect(diaDeVencimentoInicial({ creditData: { balanceDueDate: "amanha" } } as any)).toBe(10);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
npm run test --workspace=apps/api
```

Esperado: FAIL — `Failed to resolve import "./pluggyMapping"`.

- [ ] **Step 3: Escrever a implementação**

Crie `apps/api/src/lib/pluggyMapping.ts`:

```ts
import type { Account as PluggyAccount, Transaction as PluggyTransaction } from "pluggy-sdk";

/**
 * O que a Pluggy manda, traduzido — e nada mais.
 *
 * Estas decisoes viviam dentro do laco do `syncItem`, cercadas de Prisma e de
 * rede, e por isso nunca tiveram teste. Uma delas estava errada havia meses: o
 * estorno de cartao, que chega como CREDIT com valor negativo, era gravado como
 * despesa. Aqui elas sao funcoes puras, e o caso do estorno e um teste de
 * quatro linhas.
 */

/** Quando a Pluggy nao diz quando a fatura vence, o app assume dia 10. */
export const DIA_DE_VENCIMENTO_PADRAO = 10;

/**
 * O valor, sempre positivo — o sinal mora em `type`, e essa e a invariante que
 * o resto do app assume (filtro de faixa de valor, soma de relatorio).
 *
 * Nao-finito vira zero de proposito: um `NaN` viraria `Prisma.Decimal`
 * invalido e derrubaria o `createMany` do lote inteiro, e nao so a linha ruim.
 */
export function valorAbsoluto(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.abs(raw);
}

/**
 * A direcao do dinheiro.
 *
 * `type` e o dado; o sinal do valor e o palpite. A versao antiga usava os dois
 * ao mesmo tempo (`type === "DEBIT" || raw < 0`), e num cartao de credito isso
 * inverte todo estorno: compra vem DEBIT com valor positivo, devolucao vem
 * CREDIT com valor **negativo**. O `raw < 0` ganhava, e a devolucao virava
 * despesa.
 */
export function sinalDaTransacao(
  type: string | null | undefined,
  raw: number | null | undefined
): "INCOME" | "EXPENSE" {
  const normalizado = String(type ?? "").toUpperCase();
  if (normalizado === "CREDIT") return "INCOME";
  if (normalizado === "DEBIT") return "EXPENSE";
  // Conector que nao mandou `type`: so resta o sinal.
  return (raw ?? 0) < 0 ? "EXPENSE" : "INCOME";
}

/** "YYYY-MM" a partir de um ano e um mes 1-based. */
function chaveDeMes(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/**
 * O mes da fatura em que a transacao cai, como "YYYY-MM".
 *
 * Quando o conector e Open Finance, a Pluggy manda `billForecastDate` — o mes
 * que o proprio banco projetou, valido inclusive para lancamento pendente. Ele
 * ganha sempre.
 *
 * Sem ele, deriva: mes da transacao mais um. Cada parcela ja chega como uma
 * transacao na fatura dela, entao o numero da parcela nao entra nesta conta.
 *
 * A derivacao erra em um mes para compra feita depois do fechamento da fatura.
 * Modelar fechamento exigiria guardar o dia de fechamento e decidir o que fazer
 * quando ele muda, e so melhoraria os conectores que ja nao mandam
 * `billForecastDate`. Esta anotado no Backlog do spec.
 */
export function mesDaFatura(data: Date, billForecastDate?: string | null): string {
  if (billForecastDate && /^\d{4}-(0[1-9]|1[0-2])$/.test(billForecastDate)) {
    return billForecastDate;
  }

  const proximo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 1));
  return chaveDeMes(proximo.getUTCFullYear(), proximo.getUTCMonth() + 1);
}

export interface DadosDeParcela {
  installmentIndex: number | null;
  installmentTotal: number | null;
  /** "YYYY-MM". Nulo fora de cartao de credito. */
  billMonth: string | null;
}

/** Um inteiro dentro de uma faixa, ou null. */
function inteiroNaFaixa(valor: unknown, min: number, max: number): number | null {
  if (typeof valor !== "number" || !Number.isInteger(valor)) return null;
  return valor >= min && valor <= max ? valor : null;
}

/**
 * Os tres campos de cartao de uma transacao.
 *
 * `creditCardMetadata` presente e o unico sinal confiavel de que a linha e de
 * cartao — dai `billMonth` sair preenchido mesmo para compra a vista, que tem
 * fatura sem ter parcela.
 *
 * Numero e total andam juntos: "3 de ?" e "? de 10" nao sao exibiveis, entao um
 * sem o outro derruba os dois.
 */
export function dadosDeParcela(
  pTx: Pick<PluggyTransaction, "date" | "creditCardMetadata">
): DadosDeParcela {
  const meta = pTx.creditCardMetadata;
  if (!meta) {
    return { installmentIndex: null, installmentTotal: null, billMonth: null };
  }

  const billMonth = mesDaFatura(new Date(pTx.date), meta.billForecastDate);
  const total = inteiroNaFaixa(meta.totalInstallments, 1, 999);
  const indice = total === null ? null : inteiroNaFaixa(meta.installmentNumber, 1, total);

  return indice === null
    ? { installmentIndex: null, installmentTotal: null, billMonth }
    : { installmentIndex: indice, installmentTotal: total, billMonth };
}

/**
 * A data de vencimento, do cruzamento do mes da fatura com o dia da conta.
 *
 * Nao e coluna de propósito: derivar na leitura faz com que corrigir o dia de
 * vencimento do cartao conserte todas as parcelas de uma vez, sem backfill.
 *
 * O limite ao ultimo dia do mes existe para vencimento 31 em fevereiro. Sem
 * ele, `Date.UTC(2026, 1, 31)` vira 3 de marco em silencio.
 */
export function vencimentoDaFatura(billMonth: string | null, dueDay: number | null): Date | null {
  if (!billMonth || dueDay == null) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billMonth)) return null;
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return null;

  const [ano, mes] = billMonth.split("-").map(Number);
  // Dia 0 do mes seguinte e o ultimo dia deste.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1, Math.min(dueDay, ultimoDia)));
}

/**
 * O dia de vencimento com que uma conta de credito nasce.
 *
 * A Pluggy manda a data de vencimento da fatura corrente; o dia dela e o que
 * vale para as proximas. Sem esse dado, 10 — um numero comum, e sobretudo um
 * numero, porque a tela exige que o campo nunca fique vazio.
 */
export function diaDeVencimentoInicial(pAccount: Pick<PluggyAccount, "creditData">): number {
  const bruta = pAccount?.creditData?.balanceDueDate;
  if (!bruta) return DIA_DE_VENCIMENTO_PADRAO;

  const data = bruta instanceof Date ? bruta : new Date(bruta);
  if (Number.isNaN(data.getTime())) return DIA_DE_VENCIMENTO_PADRAO;

  const dia = data.getUTCDate();
  return dia >= 1 && dia <= 31 ? dia : DIA_DE_VENCIMENTO_PADRAO;
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS, todos. Se `mesDaFatura` falhar na virada de ano, o erro está em usar `getMonth()` em vez de `getUTCMonth()`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/pluggyMapping.ts apps/api/src/lib/pluggyMapping.test.ts
git commit -m "feat(api): funcoes puras de mapeamento da Pluggy, com o caso do estorno coberto"
```

---

### Task 3: O sync passa a usar o mapeamento

Aqui o bug do estorno some de verdade, e as colunas da Task 1 param de ser nulas.

**Files:**
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`

**Interfaces:**
- Consumes: `dadosDeParcela`, `diaDeVencimentoInicial`, `sinalDaTransacao`, `valorAbsoluto` de `../../lib/pluggyMapping`.
- Produces: nada de novo para outras tasks — o efeito é no banco.

- [ ] **Step 1: Importar o módulo novo**

Em `apps/api/src/modules/pluggy/pluggy.service.ts`, depois do import de `buscarEmLotes, emLotes`:

```ts
import {
  dadosDeParcela,
  diaDeVencimentoInicial,
  sinalDaTransacao,
  valorAbsoluto,
} from "../../lib/pluggyMapping";
```

- [ ] **Step 2: Trazer os campos novos para a busca das existentes**

Em `buscarPorPluggyIds`, o `select` precisa dos três campos novos, ou a comparação de "mudou?" nunca veria diferença neles. Substitua o `select` inteiro:

```ts
      select: {
        id: true,
        pluggyTransactionId: true,
        description: true,
        amount: true,
        type: true,
        date: true,
        accountId: true,
        installmentIndex: true,
        installmentTotal: true,
        billMonth: true,
      },
```

- [ ] **Step 3: Trocar o mapeamento da transação**

Dentro de `syncItem`, no `for (const pTx of transactions)`, substitua o bloco que começa em `const rawAmount = pTx.amount ?? 0;` e termina no fecho de `campos`:

```ts
      const campos = {
        description: (pTx.description || pTx.descriptionRaw || "Transação sem descrição").trim(),
        amount: new Prisma.Decimal(valorAbsoluto(pTx.amount)),
        // O `type` da Pluggy manda. A versão antiga misturava `type` com o sinal
        // do valor, e num cartão isso invertia todo estorno.
        type: sinalDaTransacao(pTx.type, pTx.amount) as TransactionType,
        date: new Date(pTx.date),
        accountId: accountRecord.id,
        ...dadosDeParcela(pTx),
      };
```

- [ ] **Step 4: Incluir os campos novos na comparação de "não mudou"**

Logo abaixo, substitua o `if` que decide pular a linha idêntica:

```ts
      if (
        existente.description === campos.description &&
        existente.amount.equals(campos.amount) &&
        existente.type === campos.type &&
        existente.date.getTime() === campos.date.getTime() &&
        existente.accountId === campos.accountId &&
        existente.installmentIndex === campos.installmentIndex &&
        existente.installmentTotal === campos.installmentTotal &&
        existente.billMonth === campos.billMonth
      ) {
        continue;
      }
```

- [ ] **Step 5: Semear poupança e dia de vencimento no `create` da conta**

No `prisma.account.upsert` de dentro do laço de contas, extraia o tipo antes do upsert e acrescente os dois campos **só no `create`**. Substitua o trecho de `const accountRecord = await prisma.account.upsert({` até o fecho do `create`:

```ts
    const tipoDaConta = mapAccountType(pAccount);

    const accountRecord = await prisma.account.upsert({
      where: { pluggyAccountId: pAccount.id },
      update: {
        name: formatAccountName(pAccount, accountInstitution),
        type: tipoDaConta,
        balance: new Prisma.Decimal(pAccount.balance ?? 0),
        institutionName: accountInstitution,
        itemId: itemRecord.id,
        lastSyncedAt: new Date(),
        // `excludedFromBalance`, `customType` e `creditCardDueDay` ficam de fora
        // de propósito: são escolha do usuário, e o sync não desfaz escolha.
      },
      create: {
        userId,
        itemId: itemRecord.id,
        pluggyAccountId: pAccount.id,
        name: formatAccountName(pAccount, accountInstitution),
        type: tipoDaConta,
        balance: new Prisma.Decimal(pAccount.balance ?? 0),
        institutionName: accountInstitution,
        lastSyncedAt: new Date(),
        // Poupança é reserva, não é o que se pode gastar hoje: nasce fora dos
        // cards de saldo. O olhinho da Perfil é o caminho de volta.
        excludedFromBalance: tipoDaConta === AccountType.SAVINGS,
        ...(tipoDaConta === AccountType.CREDIT && {
          creditCardDueDay: diaDeVencimentoInicial(pAccount),
        }),
      },
    });

    // Uma conta que a Pluggy passou a classificar como crédito (ou que existia
    // antes da coluna) fica sem dia de vencimento, e a tela exige um. O
    // `where` com `creditCardDueDay: null` é o que impede o sync de reescrever
    // por cima do que o usuário corrigiu.
    if (tipoDaConta === AccountType.CREDIT) {
      await prisma.account.updateMany({
        where: { id: accountRecord.id, creditCardDueDay: null },
        data: { creditCardDueDay: diaDeVencimentoInicial(pAccount) },
      });
    }
```

- [ ] **Step 6: Compilar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS. Se `sinalDaTransacao(...) as TransactionType` reclamar, confirme que `TransactionType` é o enum do `@prisma/client` já importado no topo do arquivo.

- [ ] **Step 7: Rodar os testes**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS. `sync.test.ts` cobre `emLotes` e `dataInicialDaBusca`, que não foram tocados.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pluggy/pluggy.service.ts
git commit -m "fix(sync): o sinal vem do type da Pluggy, e as parcelas param de ser descartadas"
```

---

### Task 4: Os tipos compartilhados

Os DTOs mudam antes dos consumidores, para que o compilador aponte cada lugar que precisa acompanhar.

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type AccountType = "CHECKING" | "SAVINGS" | "CREDIT" | "DEBIT_CARD" | "INVESTMENT"`
  - `AccountDTO.type: AccountType`, `AccountDTO.originalType: AccountType`, `AccountDTO.customType: AccountType | null`, `AccountDTO.creditCardDueDay: number | null`
  - `TransactionDTO.installmentIndex: number | null`, `TransactionDTO.installmentTotal: number | null`, `TransactionDTO.dueDate: string | null`
  - `UpdateAccountRequest.customType?: AccountType | null`, `UpdateAccountRequest.creditCardDueDay?: number | null`

- [ ] **Step 1: Declarar `AccountType`**

Em `packages/shared/src/index.ts`, logo abaixo de `export type TransactionType = "INCOME" | "EXPENSE";`:

```ts
/**
 * Os quatro primeiros vem da Pluggy. `DEBIT_CARD` nao: para ela um cartao de
 * debito e a conta corrente a que esta preso, entao o rotulo so existe quando o
 * usuario o escolhe a mao.
 */
export type AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CREDIT"
  | "DEBIT_CARD"
  | "INVESTMENT";
```

- [ ] **Step 2: Atualizar `AccountDTO`**

Substitua a linha `type: string;` de `AccountDTO` por:

```ts
  /** O tipo **efetivo**: o escolhido pelo usuario quando existe, senao o da Pluggy. */
  type: AccountType;
  /** O que a Pluggy derivou. Preservado para permitir voltar atras. */
  originalType: AccountType;
  /** A escolha do usuario. Null quando ele nunca reclassificou a conta. */
  customType: AccountType | null;
  /** Dia do mes em que a fatura vence, 1 a 31. Obrigatorio em cartao de credito. */
  creditCardDueDay: number | null;
```

- [ ] **Step 3: Atualizar `TransactionDTO`**

No fim de `TransactionDTO`, depois de `categoryName: string | null;`:

```ts
  /** Numero desta parcela. Null quando a compra nao foi parcelada. */
  installmentIndex: number | null;
  /** Total de parcelas. Anda junto com `installmentIndex`: ou vem os dois, ou nenhum. */
  installmentTotal: number | null;
  /**
   * Vencimento da fatura em que a transacao cai (ISO). Derivado do mes da fatura
   * mais o dia de vencimento da conta — nao e coluna, para que corrigir o dia do
   * cartao conserte todas as parcelas de uma vez.
   */
  dueDate: string | null;
```

- [ ] **Step 4: Atualizar `UpdateAccountRequest`**

Substitua a interface inteira:

```ts
export interface UpdateAccountRequest {
  /** Novo nome. String vazia ou null volta ao nome original do banco. */
  name?: string | null;
  /** Ligada, a conta sai dos cards de saldo do Dashboard. */
  excludedFromBalance?: boolean;
  /** Reclassificacao manual. Null volta ao tipo que a Pluggy derivou. */
  customType?: AccountType | null;
  /** Dia do vencimento da fatura, 1 a 31. Obrigatorio quando o tipo efetivo e CREDIT. */
  creditCardDueDay?: number | null;
}
```

- [ ] **Step 5: Compilar o pacote**

```bash
npm run build:shared
```

Esperado: PASS.

- [ ] **Step 6: Confirmar que a API e o web agora quebram, e onde**

```bash
npm run build --workspace=apps/api
```

Esperado: **FAIL**, com erros em `accounts.service.ts` (falta `originalType`, `customType`, `creditCardDueDay`), `transactions.service.ts`, `suggestions.service.ts` e `similar.service.ts` (falta `installmentIndex`, `installmentTotal`, `dueDate`). É o resultado desejado: são exatamente os arquivos das Tasks 5 e 6.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): AccountType, tipo customizado e parcela nos DTOs"
```

---

### Task 5: Contas — tipo efetivo e a regra do dia de vencimento

**Files:**
- Modify: `apps/api/src/modules/accounts/accounts.service.ts`
- Modify: `apps/api/src/modules/accounts/accounts.routes.ts`

**Interfaces:**
- Consumes: `AccountDTO`, `AccountType` de `@poup/shared`.
- Produces: `resolveAccountType(account: { type: AccountType; customType: AccountType | null }): AccountType`, exportada de `accounts.service.ts`; `UpdateAccountInput` com `customType?: AccountType | null` e `creditCardDueDay?: number | null`.

- [ ] **Step 1: Adicionar `resolveAccountType`**

Em `apps/api/src/modules/accounts/accounts.service.ts`, logo abaixo de `resolveAccountName`:

```ts
/**
 * O tipo que vale na tela. Mesma divisao do nome: o sync reescreve `type` a
 * cada atualizacao, entao a escolha do usuario mora em `customType` e ganha.
 *
 * E o unico caminho ate `DEBIT_CARD` — a Pluggy nunca devolve esse tipo.
 */
export function resolveAccountType(account: {
  type: AccountType;
  customType: AccountType | null;
}): AccountType {
  return account.customType ?? account.type;
}
```

E acrescente `AccountType` ao import de `@poup/shared`, no topo:

```ts
import type { AccountDTO, AccountType } from "@poup/shared";
```

- [ ] **Step 2: Devolver os campos novos no DTO**

Em `listAccounts`, dentro do `accounts.map`, substitua a linha `type: acc.type,` por:

```ts
      type: resolveAccountType(acc),
      originalType: acc.type,
      customType: acc.customType,
      creditCardDueDay: acc.creditCardDueDay,
```

- [ ] **Step 3: Aceitar os campos novos na entrada**

Substitua `UpdateAccountInput` por:

```ts
export interface UpdateAccountInput {
  /** Vazio ou null remove o apelido e volta ao nome vindo do banco. */
  name?: string | null;
  excludedFromBalance?: boolean;
  /** Null volta ao tipo que a Pluggy derivou. */
  customType?: AccountType | null;
  creditCardDueDay?: number | null;
}
```

- [ ] **Step 4: Validar a regra do cartão e gravar**

Substitua o corpo de `updateAccount`, do `if (!existing)` até o `prisma.account.update`:

```ts
  const existing = await prisma.account.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new AccountNotFoundError();
  }

  // O tipo efetivo **depois** deste PATCH — ele e quem decide se o dia de
  // vencimento e obrigatorio, e ele depende de duas colunas. E por isso que
  // esta regra vive aqui e nao no zod: o schema nao ve o que ja esta no banco.
  const tipoEfetivo =
    input.customType !== undefined
      ? (input.customType ?? existing.type)
      : resolveAccountType(existing);

  const diaEfetivo =
    input.creditCardDueDay !== undefined ? input.creditCardDueDay : existing.creditCardDueDay;

  if (tipoEfetivo === "CREDIT" && diaEfetivo == null) {
    throw new UnprocessableError(
      "Informe o dia de vencimento da fatura (1 a 31) para uma conta de cartão de crédito."
    );
  }

  await prisma.account.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { customName: input.name?.trim() || null }),
      ...(input.excludedFromBalance !== undefined && {
        excludedFromBalance: input.excludedFromBalance,
      }),
      ...(input.customType !== undefined && { customType: input.customType }),
      // O dia sobrevive a uma troca de tipo: quem volta para cartao de credito
      // reencontra o que tinha cadastrado, em vez de digitar de novo.
      ...(input.creditCardDueDay !== undefined && {
        creditCardDueDay: input.creditCardDueDay,
      }),
    },
  });
```

E acrescente `UnprocessableError` ao import de erros, no topo do arquivo:

```ts
import { AccountNotFoundError, UnprocessableError } from "../../lib/errors";
```

- [ ] **Step 5: Validar a forma no zod**

Em `apps/api/src/modules/accounts/accounts.routes.ts`, substitua `updateAccountSchema`:

```ts
const accountTypeSchema = z.enum([
  "CHECKING",
  "SAVINGS",
  "CREDIT",
  "DEBIT_CARD",
  "INVESTMENT",
]);

const updateAccountSchema = z.object({
  name: z.string().max(80, "Nome muito longo").nullable().optional(),
  excludedFromBalance: z.boolean().optional(),
  customType: accountTypeSchema.nullable().optional(),
  // O zod valida a forma; se o campo e *obrigatorio* depende do tipo efetivo
  // depois do PATCH, que so a service conhece.
  creditCardDueDay: z
    .number()
    .int("O dia de vencimento tem de ser um número inteiro")
    .min(1, "O dia de vencimento vai de 1 a 31")
    .max(31, "O dia de vencimento vai de 1 a 31")
    .nullable()
    .optional(),
});
```

- [ ] **Step 6: Compilar**

```bash
npm run build --workspace=apps/api
```

Esperado: ainda FAIL, mas **só** em `transactions.service.ts`, `suggestions.service.ts` e `similar.service.ts` — os arquivos da Task 6. Nenhum erro restante em `accounts.*`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/accounts
git commit -m "feat(api): tipo efetivo da conta e dia de vencimento obrigatorio no cartao"
```

---

### Task 6: Transações — parcela e data de vencimento no DTO

Três arquivos montam `TransactionDTO` à mão hoje. Em vez de acrescentar os campos novos nos três, os dois de fora passam a chamar a função que já existe — o mesmo motivo que fez `toItemDTO` nascer em `pluggy.service.ts` ("um campo novo entraria em duas das três").

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts`
- Modify: `apps/api/src/modules/categorization/suggestions.service.ts`
- Modify: `apps/api/src/modules/categorization/similar.service.ts`

**Interfaces:**
- Consumes: `vencimentoDaFatura` de `../../lib/pluggyMapping`.
- Produces: `formatTransactionDTO` **exportada** de `transactions.service.ts`, e a constante `TX_INCLUDE` exportada do mesmo arquivo:
  ```ts
  export const TX_INCLUDE: {
    account: { select: { name: true; creditCardDueDay: true } };
    category: { select: { name: true } };
  };
  export function formatTransactionDTO(tx: TransactionComRelacoes): TransactionDTO;
  ```

- [ ] **Step 1: Exportar o `include` e ampliar o `formatTransactionDTO`**

Em `apps/api/src/modules/transactions/transactions.service.ts`, substitua a função `formatTransactionDTO` inteira (e acrescente `TX_INCLUDE` logo antes dela):

```ts
/**
 * O `include` de toda leitura de transacao. Existe como constante porque o
 * `creditCardDueDay` precisa vir junto em **todas** elas: sem ele o DTO nao tem
 * como calcular o vencimento, e a parcela apareceria sem data em algumas telas
 * e com data em outras.
 */
export const TX_INCLUDE = {
  account: { select: { name: true, creditCardDueDay: true } },
  category: { select: { name: true } },
} as const;

export function formatTransactionDTO(tx: {
  id: string;
  description: string;
  amount: Prisma.Decimal;
  type: PrismaTransactionType;
  date: Date;
  note: string | null;
  isRecurring: boolean;
  accountId: string;
  account: { name: string; creditCardDueDay: number | null };
  categoryId: string | null;
  category: { name: string } | null;
  installmentIndex: number | null;
  installmentTotal: number | null;
  billMonth: string | null;
}): TransactionDTO {
  return {
    id: tx.id,
    description: tx.description,
    amount: Number(tx.amount),
    type: tx.type as TransactionType,
    date: tx.date.toISOString(),
    note: tx.note,
    isRecurring: tx.isRecurring,
    accountId: tx.accountId,
    accountName: tx.account.name,
    categoryId: tx.categoryId,
    categoryName: tx.category?.name ?? null,
    installmentIndex: tx.installmentIndex,
    installmentTotal: tx.installmentTotal,
    // Derivado, nao guardado: o dia de vencimento mora na conta, e mudar la tem
    // de consertar todas as parcelas de uma vez.
    dueDate: vencimentoDaFatura(tx.billMonth, tx.account.creditCardDueDay)?.toISOString() ?? null,
  };
}
```

E acrescente o import, no topo:

```ts
import { vencimentoDaFatura } from "../../lib/pluggyMapping";
```

- [ ] **Step 2: Usar `TX_INCLUDE` nas quatro leituras do arquivo**

Ainda em `transactions.service.ts`, há quatro blocos idênticos:

```ts
    include: {
      account: { select: { name: true } },
      category: { select: { name: true } },
    },
```

em `listTransactions`, `getTransactionById`, `createTransaction` e `updateTransaction`. Substitua os quatro por:

```ts
    include: TX_INCLUDE,
```

- [ ] **Step 3: Reusar em `suggestions.service.ts`**

Em `apps/api/src/modules/categorization/suggestions.service.ts`, apague a constante `TX_INCLUDE` local (as quatro linhas de `const TX_INCLUDE = { ... } as const;`) e importe as duas do módulo de transações:

```ts
import { TX_INCLUDE, formatTransactionDTO } from "../transactions/transactions.service";
```

Depois, no `rows.map`, substitua o objeto `transaction: { ... }` montado à mão por:

```ts
    transaction: formatTransactionDTO(row.transaction),
```

- [ ] **Step 4: Reusar em `similar.service.ts`**

Em `apps/api/src/modules/categorization/similar.service.ts`, substitua o `include` do `findMany` de candidatas:

```ts
    include: TX_INCLUDE,
```

e substitua a construção do `dto` por:

```ts
    const dto: SimilarTransactionDTO = { ...formatTransactionDTO(tx), score };
```

Acrescente o import:

```ts
import { TX_INCLUDE, formatTransactionDTO } from "../transactions/transactions.service";
```

- [ ] **Step 5: Compilar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS, sem nenhum erro restante.

- [ ] **Step 6: Rodar os testes**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS. Nenhum teste da API monta `TransactionDTO` hoje — `reopen.test.ts` mocka só `categorySuggestion.upsert`, e os demais vivem em `lib/categorization/`.

A cadeia de imports que os Steps 3 e 4 criam é acíclica hoje: `suggestions.service` → `transactions.service` → `categorization.service`, e `categorization.service` não importa nenhum dos dois (confira com `grep "^import" apps/api/src/modules/categorization/categorization.service.ts`). Se um import futuro fechar esse ciclo, a saída é mover `TX_INCLUDE` e `formatTransactionDTO` para um arquivo próprio, `apps/api/src/modules/transactions/transaction.dto.ts`, que não importa nada de `modules/`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/transactions apps/api/src/modules/categorization
git commit -m "feat(api): parcela e data de vencimento no DTO da transacao"
```

---

### Task 7: Reparo do histórico

**Files:**
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`
- Modify: `apps/api/src/modules/pluggy/pluggy.routes.ts`

**Interfaces:**
- Consumes: `buscarPorPluggyIds`, `dadosDeParcela`, `sinalDaTransacao`, `valorAbsoluto`, `getPluggyClientForUser`, `emLotes`.
- Produces:
  ```ts
  export interface RepairResult { examined: number; updated: number }
  export async function repairAccount(userId: string, accountId: string): Promise<RepairResult>
  ```
  Rota: `POST /api/pluggy/accounts/:accountId/repair` → `{ examined: number, updated: number }`

- [ ] **Step 1: Escrever `repairAccount`**

No fim de `apps/api/src/modules/pluggy/pluggy.service.ts`:

```ts
export interface RepairResult {
  /** Quantas transações a Pluggy devolveu para esta conta. */
  examined: number;
  /** Quantas linhas locais de fato mudaram. */
  updated: number;
}

/**
 * Reescreve o histórico já importado de **uma** conta com as regras de hoje.
 *
 * Existe porque a correção do sinal e os campos de parcela não alcançam
 * sozinhos o que já está no banco: o sync só revisita trinta dias, e o resto
 * ficaria para sempre com o estorno invertido e sem parcela.
 *
 * Duas restrições deliberadas:
 *
 * - **Só atualiza; nunca insere.** O primeiro sync de uma conexão traz de
 *   propósito só o mês corrente, para caber no tempo da função. Um reparo que
 *   importasse tudo que a Pluggy conhece encheria a fila de revisão com
 *   centenas de transações antigas que ninguém pediu — deixaria de ser
 *   "consertar o que está errado" e viraria "importar cinco anos de extrato".
 * - **Uma conta por chamada.** O extrato completo não tem tamanho conhecido, e
 *   o teto de uma função serverless é de sessenta segundos. Quem itera as
 *   contas é a tela, uma requisição de cada vez.
 *
 * Não chama `processNewTransactions`: nenhuma sugestão nasce daqui, e nenhuma
 * notificação é criada. É idempotente — rodar duas vezes na mesma conta
 * devolve `updated: 0` na segunda.
 */
export async function repairAccount(userId: string, accountId: string): Promise<RepairResult> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
    select: { id: true, pluggyAccountId: true },
  });

  // O par (id, userId) é o que prova posse. Id sozinho não prova nada.
  if (!account) {
    throw new AccountNotFoundError();
  }

  if (!account.pluggyAccountId) {
    throw new UnprocessableError(
      "Esta conta não veio de uma conexão da Pluggy, então não há histórico a reparar."
    );
  }

  const client = await getPluggyClientForUser(userId);

  // Sem `dateFrom`: aqui o histórico inteiro é o ponto.
  const transactions: PluggyTransaction[] = await client
    .fetchAllTransactions(account.pluggyAccountId)
    .catch((err: any) => {
      throw new UpstreamError(`Erro ao buscar transações na Pluggy: ${err?.message}`, {
        details: err?.message,
      });
    });

  if (transactions.length === 0) {
    return { examined: 0, updated: 0 };
  }

  const existentes = await buscarPorPluggyIds(transactions.map((t) => t.id));
  const existentePorPluggyId = new Map(
    existentes.map((t) => [t.pluggyTransactionId!, t] as const)
  );

  const alteracoes: Prisma.PrismaPromise<unknown>[] = [];

  for (const pTx of transactions) {
    const existente = existentePorPluggyId.get(pTx.id);
    if (!existente) continue;

    const campos = {
      description: (pTx.description || pTx.descriptionRaw || "Transação sem descrição").trim(),
      amount: new Prisma.Decimal(valorAbsoluto(pTx.amount)),
      type: sinalDaTransacao(pTx.type, pTx.amount) as TransactionType,
      date: new Date(pTx.date),
      accountId: account.id,
      ...dadosDeParcela(pTx),
    };

    if (
      existente.description === campos.description &&
      existente.amount.equals(campos.amount) &&
      existente.type === campos.type &&
      existente.date.getTime() === campos.date.getTime() &&
      existente.accountId === campos.accountId &&
      existente.installmentIndex === campos.installmentIndex &&
      existente.installmentTotal === campos.installmentTotal &&
      existente.billMonth === campos.billMonth
    ) {
      continue;
    }

    alteracoes.push(prisma.transaction.update({ where: { id: existente.id }, data: campos }));
  }

  for (const lote of emLotes(alteracoes)) {
    await prisma.$transaction(lote);
  }

  return { examined: transactions.length, updated: alteracoes.length };
}
```

- [ ] **Step 2: Importar os erros que faltam**

No topo do mesmo arquivo, o import de `../../lib/errors` já traz `ConflictError`, `ItemNotFoundError`, `UnprocessableError` e `UpstreamError`. Acrescente `AccountNotFoundError`:

```ts
import {
  AccountNotFoundError,
  ConflictError,
  ItemNotFoundError,
  UnprocessableError,
  UpstreamError,
} from "../../lib/errors";
```

- [ ] **Step 3: Expor a rota**

Em `apps/api/src/modules/pluggy/pluggy.routes.ts`, acrescente `repairAccount` ao import do service e, depois da rota `PATCH /items/:id/image`:

```ts
/**
 * Reparo do histórico, uma conta por vez. O corte por conta não é detalhe de
 * implementação: é o que mantém cada requisição dentro do teto de tempo da
 * função. Quem itera as contas de uma conexão é a tela.
 */
pluggyRouter.post(
  "/accounts/:accountId/repair",
  asyncHandler(async (req, res) => {
    const result = await repairAccount(req.userId!, req.params.accountId);
    res.json(result);
  })
);
```

- [ ] **Step 4: Compilar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS.

- [ ] **Step 5: Verificar à mão contra a Pluggy**

Suba a API e o web (`npm run dev`), pegue o id de uma conta de cartão em `GET /api/accounts`, e chame:

```bash
curl -X POST http://localhost:4000/api/pluggy/accounts/<accountId>/repair -H "Authorization: Bearer <token>"
```

Esperado: `{"examined":N,"updated":M}` com `M > 0` na primeira vez. Rode de novo: `updated` tem de ser `0` — é a prova de que é idempotente. Depois, confira no app que um estorno conhecido virou receita.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/pluggy
git commit -m "feat(api): reparo do historico ja importado, uma conta por requisicao"
```

---

### Task 8: Web — totais, rótulos e o cliente da rota de reparo

**Files:**
- Modify: `apps/web/src/lib/accounts.ts`
- Test: `apps/web/src/lib/accounts.test.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes: `AccountType` de `@poup/shared`.
- Produces:
  - `ACCOUNT_TYPE_LABELS: Record<AccountType, string>` em `lib/accounts.ts`
  - `ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[]` em `lib/accounts.ts`
  - `repairAccount(accountId: string): Promise<{ examined: number; updated: number }>` em `lib/api.ts`

- [ ] **Step 1: Escrever os testes novos**

Em `apps/web/src/lib/accounts.test.ts`, acrescente ao `describe("summarizeAccounts")`:

```ts
  it("cartão de débito é dinheiro disponível, como a conta corrente que ele é", () => {
    // A Pluggy não tem esse tipo: ele só existe quando o usuário rotula a
    // conta à mão. O saldo, porém, é o da conta corrente a que o cartão está
    // preso — tratá-lo como outra coisa tiraria dinheiro real do total.
    const totais = summarizeAccounts([
      conta({ id: "corrente", type: "CHECKING", balance: 1000 }),
      conta({ id: "debito", type: "DEBIT_CARD", balance: 250 }),
    ]);

    expect(totais).toEqual({
      liquid: 1250,
      liquidCount: 2,
      investments: 0,
      creditInvoices: 0,
    });
  });

  it("poupança fora do saldo não entra no disponível nem na contagem", () => {
    // O padrão novo: poupança nasce com `excludedFromBalance`. O que este teste
    // protege é que ela sai também do `liquidCount` — um rodapé dizendo "2
    // contas" sobre a soma de uma só é pior que não ter rodapé.
    const totais = summarizeAccounts([
      conta({ id: "corrente", type: "CHECKING", balance: 1000 }),
      conta({ id: "poupanca", type: "SAVINGS", balance: 5000, excludedFromBalance: true }),
    ]);

    expect(totais).toEqual({
      liquid: 1000,
      liquidCount: 1,
      investments: 0,
      creditInvoices: 0,
    });
  });
```

E acrescente um `describe` novo no fim do arquivo:

```ts
describe("ACCOUNT_TYPE_LABELS", () => {
  it("tem rótulo para todos os cinco tipos", () => {
    // O select de tipo é montado a partir daqui; um tipo sem rótulo apareceria
    // como uma opção em branco.
    expect(Object.keys(ACCOUNT_TYPE_LABELS).sort()).toEqual([
      "CHECKING",
      "CREDIT",
      "DEBIT_CARD",
      "INVESTMENT",
      "SAVINGS",
    ]);
  });
});
```

Ajuste o import do topo do arquivo:

```ts
import { ACCOUNT_TYPE_LABELS, summarizeAccounts } from "./accounts";
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

```bash
npm run test --workspace=apps/web
```

Esperado: FAIL — `ACCOUNT_TYPE_LABELS` não existe, e o caso do `DEBIT_CARD` dá `liquid: 1000`.

- [ ] **Step 3: Implementar os rótulos e o `DEBIT_CARD`**

Em `apps/web/src/lib/accounts.ts`, troque o import do topo e acrescente as duas constantes logo abaixo dele:

```ts
import type { AccountDTO, AccountType } from "@poup/shared";

/**
 * O nome de cada tipo na tela, num lugar só.
 *
 * "Cartão de débito" não vem da Pluggy — para ela um cartão de débito é a conta
 * corrente a que está preso. O rótulo existe porque é assim que a pessoa chama
 * a conta, e é o usuário quem o aplica.
 */
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CHECKING: "Conta corrente",
  SAVINGS: "Poupança",
  CREDIT: "Cartão de crédito",
  DEBIT_CARD: "Cartão de débito",
  INVESTMENT: "Investimento",
};

/** A mesma tabela na forma que o `<Select>` consome. */
export const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = (
  Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]
).map((value) => ({ value, label: ACCOUNT_TYPE_LABELS[value] }));
```

No `switch` de `summarizeAccounts`, o `default` já cobre `CHECKING`, `SAVINGS` e `DEBIT_CARD` — mas o comentário do bloco precisa dizer isso. Substitua o `default`:

```ts
      default:
        // CHECKING, SAVINGS e DEBIT_CARD. Cartão de débito é a conta corrente
        // com outro nome, então o saldo dele é dinheiro disponível.
        totals.liquid += account.balance;
        totals.liquidCount++;
```

E atualize o comentário do campo `liquid` na interface:

```ts
  /** Dinheiro disponível: conta corrente, cartão de débito e poupança. */
  liquid: number;
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

```bash
npm run test --workspace=apps/web
```

Esperado: PASS, todos.

- [ ] **Step 5: Acrescentar o cliente da rota de reparo**

Em `apps/web/src/lib/api.ts`, na seção `PLUGGY`, depois de `updateItemImage`:

```ts
/**
 * Repara o histórico já importado de **uma** conta. O corte por conta é do
 * servidor: cada chamada tem de caber no tempo de uma função. Quem itera as
 * contas de uma conexão é a tela.
 */
export async function repairAccount(
  accountId: string
): Promise<{ examined: number; updated: number }> {
  return request<{ examined: number; updated: number }>(
    `/pluggy/accounts/${accountId}/repair`,
    { method: "POST" }
  );
}
```

- [ ] **Step 6: Compilar o web**

```bash
npm run build --workspace=apps/web
```

Esperado: **FAIL**, em `RenameAccountModal.tsx` e/ou `ProfilePage.tsx` se algum deles já referenciar campos ausentes — e nada mais. É o escopo das Tasks 9 e 10. Se passar, melhor ainda.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/accounts.ts apps/web/src/lib/accounts.test.ts apps/web/src/lib/api.ts
git commit -m "feat(web): rotulos de tipo de conta, cartao de debito no saldo e cliente do reparo"
```

---

### Task 9: Web — `EditAccountModal`

**Files:**
- Create: `apps/web/src/components/profile/EditAccountModal.tsx`
- Delete: `apps/web/src/components/profile/RenameAccountModal.tsx`

**Interfaces:**
- Consumes: `updateAccount` de `../../lib/api`; `ACCOUNT_TYPE_OPTIONS` de `../../lib/accounts`; `Select` de `../ui/Select`.
- Produces:
  ```ts
  export interface EditAccountModalProps {
    account: AccountDTO | null;
    onClose: () => void;
    onSaved: (account: AccountDTO) => void;
  }
  export function EditAccountModal(props: EditAccountModalProps): JSX.Element | null
  ```
  **Nota:** `onSaved` agora recebe a conta atualizada (o `RenameAccountModal` chamava `onSaved()` sem argumento e a página recarregava tudo). A Task 10 acompanha.

- [ ] **Step 1: Escrever o componente**

Crie `apps/web/src/components/profile/EditAccountModal.tsx`:

```tsx
import React, { useState, useEffect, FormEvent } from "react";
import type { AccountDTO, AccountType } from "@poup/shared";
import { updateAccount } from "../../lib/api";
import { ACCOUNT_TYPE_OPTIONS } from "../../lib/accounts";
import { Modal } from "../ui/Modal";
import { Field } from "../ui/Field";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import { useToast } from "../ui/Toast";

export interface EditAccountModalProps {
  account: AccountDTO | null;
  onClose: () => void;
  onSaved: (account: AccountDTO) => void;
}

/** O que o formulário assume quando a conta ainda não tem dia cadastrado. */
const DIA_PADRAO = 10;

export function EditAccountModal({ account, onClose, onSaved }: EditAccountModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("CHECKING");
  const [dueDay, setDueDay] = useState<string>(String(DIA_PADRAO));
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!account) return;
    setName(account.customName ?? "");
    setType(account.type);
    // Nunca vazio: o campo é obrigatório em cartão, e um formulário que abre em
    // branco convida a salvar em branco.
    setDueDay(String(account.creditCardDueDay ?? DIA_PADRAO));
  }, [account]);

  if (!account) return null;

  const isCredit = type === "CREDIT";
  const diaNumerico = Number(dueDay);
  const diaInvalido =
    isCredit && (!Number.isInteger(diaNumerico) || diaNumerico < 1 || diaNumerico > 31);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!account || diaInvalido) return;

    try {
      setSaving(true);
      const atualizada = await updateAccount(account.id, {
        // Vazio limpa o apelido e devolve o nome que vem do banco.
        name: name.trim() || null,
        // Escolher de volta o tipo que a Pluggy derivou é apagar a customização,
        // e não gravá-la: assim a conta volta a acompanhar o banco se ele mudar.
        customType: type === account.originalType ? null : type,
        ...(isCredit && { creditCardDueDay: diaNumerico }),
      });
      toast.success("Conta atualizada.");
      onSaved(atualizada);
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao atualizar a conta.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen={!!account}
      onClose={onClose}
      title="Editar conta"
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="edit-account-form"
            variant="primary"
            size="sm"
            loading={saving}
            disabled={diaInvalido}
          >
            Salvar
          </Button>
        </>
      }
    >
      <form id="edit-account-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* O `hint` do Field é renderizado na mesma linha do rótulo, alinhado à
            direita: cabe uma palavra, não uma frase. Explicação mais longa vai
            num <p> abaixo do campo. */}
        <Field id="account-name" label="Nome da conta" hint="Opcional">
          <Input
            id="account-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={account.originalName}
            maxLength={80}
          />
          <p className="text-[11px] text-text-secondary">
            Em branco, volta a "{account.originalName}".
          </p>
        </Field>

        <Field id="account-type" label="Tipo">
          <Select
            id="account-type"
            value={type}
            onChange={setType}
            options={ACCOUNT_TYPE_OPTIONS}
            aria-label="Tipo da conta"
          />
          <p className="text-[11px] text-text-secondary">
            O banco não informa cartão de débito. Se esta é a conta do seu cartão de
            débito, marque aqui.
          </p>
        </Field>

        {/* Só cartão de crédito tem fatura, e aí o dia não pode faltar: é ele
            que transforma o mês da parcela numa data de vencimento. */}
        {isCredit && (
          <Field
            id="account-due-day"
            label="Dia de vencimento da fatura"
            required
            error={diaInvalido ? "Informe um dia entre 1 e 31." : undefined}
          >
            <Input
              id="account-due-day"
              type="number"
              min={1}
              max={31}
              required
              value={dueDay}
              onChange={(e) => setDueDay(e.target.value)}
              hasError={diaInvalido}
            />
            <p className="text-[11px] text-text-secondary">
              É a partir daqui que o app calcula o vencimento de cada parcela.
            </p>
          </Field>
        )}
      </form>
    </Modal>
  );
}
```

- [ ] **Step 2: Apagar o modal antigo**

```bash
git rm apps/web/src/components/profile/RenameAccountModal.tsx
```

- [ ] **Step 3: Compilar**

```bash
npm run build --workspace=apps/web
```

Esperado: FAIL, só em `ProfilePage.tsx` — `RenameAccountModal` não existe mais. É a Task 10.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/profile
git commit -m "feat(web): EditAccountModal com tipo e dia de vencimento"
```

---

### Task 10: Web — Perfil com selo de tipo e reparo

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `EditAccountModal`, `repairAccount` de `../lib/api`, `ACCOUNT_TYPE_LABELS` de `../lib/accounts`.
- Produces: nada para outras tasks.

- [ ] **Step 1: Trocar os imports**

Em `apps/web/src/pages/ProfilePage.tsx`, substitua a linha do `RenameAccountModal`:

```tsx
import { EditAccountModal } from "../components/profile/EditAccountModal";
```

Acrescente `repairAccount` ao import de `../lib/api` (junto de `updateAccount`), e um import novo:

```tsx
import { ACCOUNT_TYPE_LABELS } from "../lib/accounts";
```

- [ ] **Step 2: Trocar o estado do modal e acrescentar o do reparo**

Onde hoje está `const [renamingAccount, setRenamingAccount] = useState<AccountDTO | null>(null);` (procure por `renamingAccount`), substitua por:

```tsx
  const [editingAccount, setEditingAccount] = useState<AccountDTO | null>(null);
  /** Conexão sendo reparada, e o progresso conta a conta. */
  const [repairing, setRepairing] = useState<{
    itemId: string;
    atual: number;
    total: number;
  } | null>(null);
```

- [ ] **Step 3: Escrever o handler do reparo**

Logo depois de `handleToggleAccountBalance`:

```tsx
  /**
   * Repara o histórico de uma conexão, uma conta por requisição.
   *
   * O laço é do cliente de propósito: o servidor corta por conta para caber no
   * tempo de uma função, e é aqui que dá para mostrar em qual delas está.
   */
  async function handleRepairItem(item: ItemDTO) {
    const contas = accounts.filter((a) => a.itemId === item.id && a.pluggyAccountId);
    if (contas.length === 0) {
      toast.error("Esta conexão não tem contas importadas para reparar.");
      return;
    }

    const ok = await confirm({
      title: "Reparar histórico",
      message: `Vamos reler o extrato de ${contas.length} conta(s) de ${item.institutionName} na Pluggy e corrigir o que já está no app — valores devolvidos lançados ao contrário e parcelas sem número. Nada é apagado, e nenhuma transação nova é importada.`,
      confirmText: "Reparar",
    });
    if (!ok) return;

    let corrigidas = 0;
    let falhas = 0;

    try {
      for (let i = 0; i < contas.length; i++) {
        setRepairing({ itemId: item.id, atual: i + 1, total: contas.length });
        try {
          const res = await repairAccount(contas[i].id);
          corrigidas += res.updated;
        } catch (err: any) {
          // Uma conta que falha não interrompe as outras: o reparo é
          // idempotente, e reparar três de quatro é melhor que nenhuma.
          console.warn(`Falha ao reparar a conta ${contas[i].id}:`, err?.message || err);
          falhas++;
        }
      }
    } finally {
      setRepairing(null);
    }

    if (falhas > 0) {
      toast.error(
        `${corrigidas} transação(ões) corrigida(s), mas ${falhas} conta(s) falharam. Tente de novo.`
      );
    } else if (corrigidas === 0) {
      toast.success("Nada a corrigir: o histórico desta conexão já está em dia.");
    } else {
      toast.success(`${corrigidas} transação(ões) corrigida(s).`);
    }

    await loadData();
  }
```

- [ ] **Step 4: Acrescentar o botão de reparo**

No bloco de botões da conexão, entre "Sincronizar" e o botão de lixeira, acrescente:

```tsx
                      {/* O histórico anterior à correção do sinal e às colunas
                          de parcela só se conserta relendo o extrato: o sync
                          normal só revisita trinta dias. */}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRepairItem(item)}
                        loading={repairing?.itemId === item.id}
                        disabled={repairing !== null}
                        title="Reler o extrato e corrigir o que já está importado"
                      >
                        {repairing?.itemId === item.id
                          ? `Conta ${repairing.atual} de ${repairing.total}`
                          : "Reparar histórico"}
                      </Button>
```

- [ ] **Step 5: Mostrar o tipo em cada conta**

No card de conta (o `div` com `key={acc.id}`), logo depois do `<span>` do saldo e antes do bloco `{acc.excludedFromBalance && ...}`:

```tsx
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <Badge size="sm" variant={acc.customType ? "info" : "neutral"}>
                                {ACCOUNT_TYPE_LABELS[acc.type]}
                              </Badge>
                              {acc.type === "CREDIT" && acc.creditCardDueDay && (
                                <span className="text-[10px] text-text-secondary tnum">
                                  vence dia {acc.creditCardDueDay}
                                </span>
                              )}
                            </div>
```

O bloco `{acc.excludedFromBalance && ...}` que mostra "Fora do saldo" **não muda** — só passa a vir depois do selo de tipo. A ordem final dentro do card é: nome, saldo, selo de tipo (e "vence dia N"), "Fora do saldo".

- [ ] **Step 6: Trocar o botão de renomear e o modal**

Troque `onClick={() => setRenamingAccount(acc)}` por `onClick={() => setEditingAccount(acc)}`, e os dois `title`/`aria-label` de "Renomear conta" para "Editar conta" / `` `Editar a conta ${acc.name}` ``.

E, onde está o `<RenameAccountModal ... />` no fim do arquivo, substitua por:

```tsx
      <EditAccountModal
        account={editingAccount}
        onClose={() => setEditingAccount(null)}
        onSaved={(atualizada) =>
          setAccounts((atuais) =>
            atuais.map((a) => (a.id === atualizada.id ? atualizada : a))
          )
        }
      />
```

- [ ] **Step 7: Compilar**

```bash
npm run build --workspace=apps/web
```

Esperado: PASS.

- [ ] **Step 8: Verificar na tela**

Com `npm run dev` rodando, abra o Perfil e confirme:
- cada conta mostra um selo com o tipo;
- um cartão de crédito mostra "vence dia N";
- "Editar conta" abre o modal com nome, tipo e — só em cartão — o dia;
- trocar o tipo para "Cartão de débito" e salvar muda o selo, e o selo fica azul (`info`), sinalizando escolha manual;
- "Reparar histórico" pede confirmação, mostra "Conta 1 de N" e termina com um toast.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): tipo da conta e reparo de historico no Perfil"
```

---

### Task 11: Web — parcela nas transações

**Files:**
- Modify: `apps/web/src/pages/TransactionsPage.tsx`
- Modify: `apps/web/src/components/transactions/TransactionDetailModal.tsx`

**Interfaces:**
- Consumes: `TransactionDTO.installmentIndex`, `installmentTotal`, `dueDate`; `formatDate` de `../lib/format`.
- Produces: nada para outras tasks.

- [ ] **Step 1: Selo de parcela na lista mobile**

Em `apps/web/src/pages/TransactionsPage.tsx`, na `<ul className="md:hidden ...">`, substitua o `<div>` da descrição:

```tsx
                            <div className="font-semibold text-sm text-text-primary truncate">
                              {tx.description}
                            </div>
```

por:

```tsx
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-sm text-text-primary truncate">
                                {tx.description}
                              </span>
                              {tx.installmentTotal && (
                                <span className="shrink-0 text-[10px] font-bold tnum px-1.5 py-0.5 rounded-chip bg-surface-sunken border border-border text-text-secondary">
                                  {tx.installmentIndex}/{tx.installmentTotal}
                                </span>
                              )}
                            </div>
```

- [ ] **Step 2: Selo de parcela na tabela desktop**

Mais abaixo, na `<table>`, faça a mesma substituição — o bloco é idêntico, com `text-xs md:text-sm` em vez de `text-sm`:

```tsx
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="font-semibold text-xs md:text-sm text-text-primary truncate">
                                  {tx.description}
                                </span>
                                {tx.installmentTotal && (
                                  <span className="shrink-0 text-[10px] font-bold tnum px-1.5 py-0.5 rounded-chip bg-surface-sunken border border-border text-text-secondary">
                                    {tx.installmentIndex}/{tx.installmentTotal}
                                  </span>
                                )}
                              </div>
```

- [ ] **Step 3: Parcela e vencimento no modal de detalhe**

Em `apps/web/src/components/transactions/TransactionDetailModal.tsx`, logo depois do `</div>` que fecha o `grid grid-cols-2` de Valor e Data/Conta, e antes do `<Field id="tx-desc" ...>`:

```tsx
        {/* Parcela só aparece quando existe — a maioria das transações não é
            parcelada, e um "Parcela —" ocuparia linha para dizer nada. O
            vencimento vem do dia cadastrado no cartão; sem ele, some. */}
        {transaction.installmentTotal && (
          <div className="p-3.5 rounded-card bg-surface-alt/60 border border-border flex items-center justify-between gap-3">
            <div>
              <span className="text-overline uppercase tracking-wider text-text-secondary block">
                Parcelamento
              </span>
              <span className="text-xs font-semibold text-text-primary tnum">
                Parcela {transaction.installmentIndex} de {transaction.installmentTotal}
              </span>
            </div>
            {transaction.dueDate && (
              <div className="text-right shrink-0">
                <span className="text-overline uppercase tracking-wider text-text-secondary block">
                  Vencimento
                </span>
                <span className="text-xs font-semibold text-text-primary tnum">
                  {formatDate(transaction.dueDate)}
                </span>
              </div>
            )}
          </div>
        )}
```

`formatDate` já está importado no arquivo.

- [ ] **Step 4: Compilar**

```bash
npm run build --workspace=apps/web
```

Esperado: PASS.

- [ ] **Step 5: Verificar na tela**

Com `npm run dev`, abra Transações num mês que tenha uma compra parcelada no cartão (rode o reparo da Task 10 antes, se necessário) e confirme:
- o selo `3/10` aparece ao lado da descrição, no celular e no desktop;
- transação não parcelada não ganha selo nenhum;
- abrir a transação mostra "Parcela 3 de 10" e o vencimento;
- mudar o dia de vencimento do cartão no Perfil e voltar aqui muda a data exibida — é a prova de que ela é derivada, e não gravada.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/TransactionsPage.tsx apps/web/src/components/transactions/TransactionDetailModal.tsx
git commit -m "feat(web): numero da parcela e data de vencimento nas transacoes"
```

---

### Task 12: Verificação de ponta a ponta e documentação

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

- [ ] **Step 2: Verificar o caminho completo à mão**

Com `npm run dev`:

1. **Estorno** — encontre no app uma devolução conhecida. Antes do reparo ela está como despesa; rode "Reparar histórico" no Perfil e confirme que virou receita, com o valor positivo.
2. **Poupança** — confirme no Dashboard que o saldo disponível não inclui mais a poupança, e que o olhinho da poupança no Perfil a traz de volta ao total.
3. **Cartão** — no Perfil, edite o cartão, troque o dia de vencimento para 25, salve. Abra uma parcela em Transações e confirme que o vencimento passou a cair no dia 25.
4. **Obrigatoriedade** — no modal do cartão, apague o dia e tente salvar. O botão fica desabilitado e o campo mostra o erro.
5. **Cartão de débito** — reclassifique uma conta corrente como "Cartão de débito" e confirme no Dashboard que o saldo disponível **não** mudou.

- [ ] **Step 3: Registrar no `docs/PLAN.md`**

Na lista numerada do que existe, acrescente ao fim (continuando a numeração — o último item hoje é o 42):

```markdown
43. Sinal da transação vindo do `type` da Pluggy, e não do sinal do valor —
    devolução em cartão parou de ser lançada como despesa
44. Parcelas estruturadas (`installmentIndex`, `installmentTotal`, `billMonth`)
    vindas do `creditCardMetadata`, com o número da parcela na lista e no
    detalhe
45. Data de vencimento da parcela, derivada na leitura do mês da fatura mais o
    dia cadastrado no cartão — mudar o dia reajusta todas as parcelas
46. Classificação de conta em duas colunas: o tipo que a Pluggy deriva e o
    rótulo que o usuário escolhe, incluindo "Cartão de débito", que a Pluggy
    não tem
47. Poupança nasce fora dos cards de saldo; o olhinho do Perfil a traz de volta
48. Dia de vencimento da fatura por conta de crédito, semeado do
    `balanceDueDate` da Pluggy e obrigatório na edição (padrão 10)
49. Reparo do histórico já importado, uma conta por requisição — só reescreve o
    que existe, não importa transação nova
```

Na tabela de **Backlog**, acrescente as linhas:

```markdown
| Dia de fechamento da fatura | Não guardado; `billMonth` derivado erra em um mês para compra pós-fechamento |
| Parser de `"PARC 3/12"` na descrição | Só o `creditCardMetadata` preenche parcela hoje |
| Parcela em lançamento manual | Os três campos só são escritos pelo sync |
```

- [ ] **Step 4: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs: registrar parcelas, tipos de conta e vencimento no PLAN.md"
```

---

## Notas para quem executar

- **Se a Task 1 falhar com "unsafe use of new value of enum type"**, o Postgres é anterior à 12 ou algum comando da migração está escrevendo `'DEBIT_CARD'`. Nenhum dos dois `UPDATE` deve mencioná-lo. Se precisar mesmo, separe em duas migrações.
- **Se o reparo estourar o tempo numa conta**, rode de novo: ele é idempotente, e a segunda passada tem muito menos a escrever. Se estourar sempre, a conta tem histórico grande demais para uma requisição — nesse caso o corte precisa descer para faixa de datas, e isso é uma mudança de desenho, não um ajuste.
- **Se uma parcela aparecer com o vencimento um mês adiantado ou atrasado**, é a limitação conhecida da derivação sem dia de fechamento (está no Backlog do spec), e não um defeito da implementação. Confirme antes se aquele conector manda `billForecastDate` — se manda e mesmo assim erra, aí é bug.
