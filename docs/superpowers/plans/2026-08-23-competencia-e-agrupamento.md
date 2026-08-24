# Competência, vencimento e agrupamento de parcelas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer cada parcela de cartão contar no mês da fatura dela — em relatórios, orçamentos e dashboard — com o vencimento no dia útil certo, e as parcelas de uma compra reunidas num dropdown.

**Architecture:** A competência vira uma coluna gravada (`competenceDate`), igual a `date` para quase tudo e igual ao 1º dia do mês da fatura para transação de cartão; os três consumidores que somam por mês trocam a coluna do filtro, e os que dependem de data real não mudam. O vencimento continua **derivado na leitura**, agora passando por um calendário de dias úteis que é função pura. As parcelas de uma compra se reconhecem por uma `purchaseKey` derivada de `purchaseDate` + CNPJ do lojista + total de parcelas.

**Tech Stack:** Node + Express + TypeScript + Prisma (Postgres/Neon), React + Vite + Tailwind, vitest, pluggy-sdk.

**Spec:** `docs/superpowers/specs/2026-08-23-competencia-faturas-e-webhooks-design.md`

**Plano irmão:** `docs/superpowers/plans/2026-08-23-faturas-e-webhooks.md` cobre as seções 4 e 5 do spec (model `CreditCardBill`, reconhecimento do pagamento, webhooks). Este plano não depende dele, e ele depende deste só por vir depois na mesma tabela.

## Global Constraints

- **Datas são gravadas e comparadas em UTC.** Use `Date.UTC(...)`, `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()` — nunca os equivalentes locais. Divergir quebra a chave de mês e desloca vencimento em um dia para quem está em GMT-3.
- **Chave de mês é `"YYYY-MM"`**, com o mês em dois dígitos (`padStart(2, "0")`).
- **Migrações são SQL escrito à mão** em `apps/api/prisma/migrations/<timestamp>_<nome_snake_case>/migration.sql`, com um comentário no topo explicando *por que* a coluna existe. **Nunca rode `prisma migrate dev`.** Aplique com `npm run prisma:deploy --workspace=apps/api` (o `.env` com `DATABASE_URL` vive em `apps/api/`, então rodar da raiz falha com `Environment variable not found`).
- **O banco `DATABASE_URL` tem mais de uma conta real.** Todo `UPDATE`/`DELETE` de manutenção precisa ser escopado por `userId`, **exceto** o backfill da Task 2, que é a definição de uma coluna nova e vale para todos de propósito.
- **Moeda no banco é `Decimal(14, 2)`**; nos DTOs trafega como `number`.
- **`amount` é sempre positivo.** O sinal mora em `type`.
- **Todo valor em dinheiro exibido no web passa por `<Money>`** (`apps/web/src/components/ui/Money.tsx`). Sem isso o modo discreto vaza.
- **Nada de `any` novo.** Cada workspace compila com `tsc`.
- **Testes ficam ao lado do fonte.**
  - API: `npm run test --workspace=apps/api`
  - Web: `npm run test --workspace=apps/web`
- **Comentário explica o porquê, não o quê**, em português, no tom dos comentários já existentes em `schema.prisma` e `lib/categorization/`.
- **`packages/shared` precisa ser recompilado** depois de mexer em `packages/shared/src/index.ts`: `npm run build:shared`.

---

## Mapa de arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/lib/diasUteis.ts` | Feriados nacionais e o próximo dia útil. Puro, sem tabela por ano |
| `apps/api/src/lib/diasUteis.test.ts` | Testes das acima |
| `apps/api/src/lib/purchaseKey.ts` | A chave que junta as parcelas de uma compra. Puro |
| `apps/api/src/lib/purchaseKey.test.ts` | Testes das acima |
| `apps/api/prisma/migrations/20260823140000_competencia_e_agrupamento/migration.sql` | Colunas novas e o backfill de `competenceDate` |
| `apps/web/src/components/transactions/InstallmentGroup.tsx` | O dropdown das parcelas, com o total |

**Modificados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/prisma/schema.prisma` | `Transaction.competenceDate`, `purchaseDate`, `purchaseKey` |
| `apps/api/src/lib/pluggyMapping.ts` | `mesDaFatura` com o deslocamento da parcela; `vencimentoDaFatura` com dia útil; `competenciaDaTransacao` |
| `apps/api/src/lib/pluggyMapping.test.ts` | Casos novos |
| `apps/api/src/modules/pluggy/pluggy.service.ts` | Grava competência, `purchaseDate` e `purchaseKey`, no sync e no reparo |
| `apps/api/src/modules/transactions/transactions.service.ts` | Filtro de mês por competência; `listInstallments` |
| `apps/api/src/modules/transactions/transactions.routes.ts` | Rota das parcelas de uma compra |
| `apps/api/src/modules/reports/reports.service.ts` | `dateFilter` e a série mensal por competência |
| `apps/api/src/modules/budgets/budgets.service.ts` | As duas janelas de mês por competência |
| `packages/shared/src/index.ts` | `TransactionDTO.competenceDate`, `purchaseKey`; `InstallmentsResponse` |
| `apps/web/src/lib/api.ts` | `fetchInstallments` |
| `apps/web/src/pages/TransactionsPage.tsx` | O selo vira botão que abre o `InstallmentGroup` |
| `docs/PLAN.md` | Registra o que passou a existir |

---

### Task 1: Dias úteis

Módulo isolado e puro. Vem primeiro porque a Task 3 depende dele e ele não depende de nada.

**Files:**
- Create: `apps/api/src/lib/diasUteis.ts`
- Test: `apps/api/src/lib/diasUteis.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `feriadosNacionais(ano: number): Set<string>` — chaves `"MM-DD"`
  - `ehDiaUtil(data: Date): boolean`
  - `proximoDiaUtil(data: Date): Date`

- [ ] **Step 1: Escrever o teste, inteiro, antes da implementação**

Crie `apps/api/src/lib/diasUteis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ehDiaUtil, feriadosNacionais, proximoDiaUtil } from "./diasUteis";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("feriadosNacionais", () => {
  it("traz os nove fixos", () => {
    const f = feriadosNacionais(2026);
    for (const dia of [
      "01-01",
      "04-21",
      "05-01",
      "09-07",
      "10-12",
      "11-02",
      "11-15",
      "11-20",
      "12-25",
    ]) {
      expect(f.has(dia)).toBe(true);
    }
  });

  it("calcula os moveis a partir da Pascoa", () => {
    // Pascoa de 2026 e 5 de abril. Carnaval cai 47 dias antes (19/02),
    // Sexta-Feira Santa 2 dias antes (03/04), Corpus Christi 60 depois (04/06).
    const f = feriadosNacionais(2026);
    expect(f.has("02-17")).toBe(true); // Carnaval (terca)
    expect(f.has("04-03")).toBe(true); // Sexta-Feira Santa
    expect(f.has("06-04")).toBe(true); // Corpus Christi
  });

  it("acompanha a Pascoa quando ela muda de ano", () => {
    // Pascoa de 2027 e 28 de marco: Carnaval vai para 09/02.
    const f = feriadosNacionais(2027);
    expect(f.has("02-09")).toBe(true);
    expect(f.has("02-17")).toBe(false);
  });
});

describe("ehDiaUtil", () => {
  it("recusa sabado e domingo", () => {
    expect(ehDiaUtil(new Date("2026-09-12T00:00:00Z"))).toBe(false); // sabado
    expect(ehDiaUtil(new Date("2026-09-13T00:00:00Z"))).toBe(false); // domingo
  });

  it("recusa feriado nacional", () => {
    expect(ehDiaUtil(new Date("2026-09-07T00:00:00Z"))).toBe(false);
  });

  it("aceita um dia comum", () => {
    expect(ehDiaUtil(new Date("2026-09-10T00:00:00Z"))).toBe(true);
  });
});

describe("proximoDiaUtil", () => {
  it("nao mexe num dia util", () => {
    expect(iso(proximoDiaUtil(new Date("2026-09-10T00:00:00Z")))).toBe("2026-09-10");
  });

  it("sabado anda para segunda", () => {
    expect(iso(proximoDiaUtil(new Date("2026-09-12T00:00:00Z")))).toBe("2026-09-14");
  });

  it("domingo anda para segunda", () => {
    expect(iso(proximoDiaUtil(new Date("2026-09-13T00:00:00Z")))).toBe("2026-09-14");
  });

  it("pula feriado que cai em dia de semana", () => {
    // 07/09/2026 e segunda-feira e feriado: o vencimento vai para terca.
    expect(iso(proximoDiaUtil(new Date("2026-09-07T00:00:00Z")))).toBe("2026-09-08");
  });

  it("atravessa a virada de ano", () => {
    // 01/01 e feriado; 2027-01-01 e sexta, entao anda so um dia.
    expect(iso(proximoDiaUtil(new Date("2027-01-01T00:00:00Z")))).toBe("2027-01-04");
  });

  it("preserva a hora do dia", () => {
    // O vencimento e gravado a meia-noite UTC; andar de dia nao pode
    // introduzir hora nenhuma, ou a comparacao de data quebra.
    expect(proximoDiaUtil(new Date("2026-09-12T00:00:00Z")).toISOString()).toBe(
      "2026-09-14T00:00:00.000Z"
    );
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npm run test --workspace=apps/api
```

Esperado: FAIL — `Failed to resolve import "./diasUteis"`.

- [ ] **Step 3: Escrever a implementação**

Crie `apps/api/src/lib/diasUteis.ts`:

```ts
/**
 * O calendario que decide se uma data e dia util.
 *
 * Existe porque vencimento de fatura em sabado, domingo ou feriado nao e
 * cobrado naquele dia: o emissor posterga para o proximo dia util, e mostrar a
 * data crua faria o app discordar do banco em alguns dias por ano.
 *
 * Os feriados moveis saem calculados da Pascoa em vez de virem de uma tabela
 * por ano — uma tabela e uma divida com data marcada, e alguem teria de lembrar
 * de atualiza-la todo dezembro.
 */

/** Os fixos, como "MM-DD". Consciencia Negra e nacional desde a Lei 14.759/2023. */
const FIXOS = [
  "01-01", // Confraternizacao Universal
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalho
  "09-07", // Independencia
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamacao da Republica
  "11-20", // Consciencia Negra
  "12-25", // Natal
] as const;

/** "MM-DD" de uma data, em UTC. */
function chaveDoDia(data: Date): string {
  return `${String(data.getUTCMonth() + 1).padStart(2, "0")}-${String(
    data.getUTCDate()
  ).padStart(2, "0")}`;
}

/** Domingo de Pascoa, pelo algoritmo de Meeus/Jones/Butcher. */
function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}

/** A mesma data deslocada em dias, em UTC. */
function maisDias(data: Date, dias: number): Date {
  return new Date(data.getTime() + dias * 24 * 60 * 60 * 1000);
}

const cache = new Map<number, Set<string>>();

/**
 * Os feriados nacionais de um ano, como chaves "MM-DD".
 *
 * Memoizado por ano porque `proximoDiaUtil` consulta em laco, e o calculo da
 * Pascoa nao muda dentro do processo.
 */
export function feriadosNacionais(ano: number): Set<string> {
  const emCache = cache.get(ano);
  if (emCache) return emCache;

  const domingoDePascoa = pascoa(ano);
  const feriados = new Set<string>(FIXOS);
  // Carnaval e a terca, 47 dias antes; Sexta-Feira Santa, 2 dias antes;
  // Corpus Christi, 60 dias depois.
  feriados.add(chaveDoDia(maisDias(domingoDePascoa, -47)));
  feriados.add(chaveDoDia(maisDias(domingoDePascoa, -2)));
  feriados.add(chaveDoDia(maisDias(domingoDePascoa, 60)));

  cache.set(ano, feriados);
  return feriados;
}

export function ehDiaUtil(data: Date): boolean {
  const diaDaSemana = data.getUTCDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) return false;
  return !feriadosNacionais(data.getUTCFullYear()).has(chaveDoDia(data));
}

/**
 * A propria data, se ja for dia util; senao a proxima que for.
 *
 * O teto de dez voltas e uma trava contra laco infinito, nao um limite real: a
 * maior sequencia de dias nao uteis do calendario brasileiro tem quatro dias.
 */
export function proximoDiaUtil(data: Date): Date {
  let atual = data;
  for (let i = 0; i < 10 && !ehDiaUtil(atual); i++) {
    atual = maisDias(atual, 1);
  }
  return atual;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS, todos. Se os móveis falharem, o erro está no `pascoa` — confira contra 5 de abril de 2026 e 28 de março de 2027.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/diasUteis.ts apps/api/src/lib/diasUteis.test.ts
git commit -m "feat(api): calendario de dias uteis, com os feriados moveis calculados da Pascoa"
```

---

### Task 2: Schema e migração

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260823140000_competencia_e_agrupamento/migration.sql`

**Interfaces:**
- Consumes: nada.
- Produces: `Transaction.competenceDate: Date` (não-nulo), `Transaction.purchaseDate: Date | null`, `Transaction.purchaseKey: string | null`.

- [ ] **Step 1: Adicionar os campos em `Transaction`**

Em `apps/api/prisma/schema.prisma`, no `model Transaction`, logo depois da linha `billMonth           String?` (e do comentário dela):

```prisma
  /// O mes em que a transacao **conta** — o 1o dia dele, sempre. Igual a `date`
  /// para quase tudo; para transacao de cartao e o mes da fatura, porque e la
  /// que a despesa pesa no orcamento, e nao no dia da compra.
  ///
  /// Guarda o primeiro dia do mes, e nao o vencimento, de proposito: assim a
  /// coluna nao depende de `Account.creditCardDueDay`, e mudar o dia do cartao
  /// continua sem exigir backfill. A data de vencimento exibida segue derivada
  /// na leitura.
  ///
  /// Nao e nula porque nulo obrigaria cada consumidor a decidir o que fazer com
  /// a ausencia — o mesmo problema que `SystemCategoryKey` resolveu para
  /// `categoryId`.
  competenceDate      DateTime
  /// A data original da compra, quando a Pluggy a informa. Num parcelamento as
  /// N parcelas chegam com a mesma `date`, entao e isto que amarra as parcelas
  /// a uma compra — e o que permite dizer "comprado em 03/08" numa parcela que
  /// so vence em maio.
  purchaseDate        DateTime?
  /// Junta as parcelas de uma mesma compra. Derivada (ver lib/purchaseKey.ts),
  /// porque a Pluggy nao manda identificador de compra nenhum.
  purchaseKey         String?
```

E acrescente o índice, junto dos que já existem no fim do model:

```prisma
  @@index([userId, competenceDate])
  @@index([purchaseKey])
```

- [ ] **Step 2: Escrever a migração**

Crie `apps/api/prisma/migrations/20260823140000_competencia_e_agrupamento/migration.sql`:

```sql
-- Competencia e agrupamento de parcelas.
--
-- `competenceDate` responde "em que mes esta despesa pesa?", que ate aqui era
-- respondido por `date` — e `date`, num parcelamento do Mercado Pago, e a data
-- da compra para as dez parcelas. O resultado era uma compra de R$ 300 em 10x
-- contando R$ 300 no mes da compra, em vez de R$ 30 por mes.
--
-- A coluna nasce NOT NULL com DEFAULT para que a tabela existente seja
-- preenchida numa passada so; o DEFAULT sai depois, porque o valor certo e
-- calculado pela aplicacao e nao por now().
ALTER TABLE "Transaction" ADD COLUMN "competenceDate" TIMESTAMP(3);

-- Para tudo que ja existe, competencia e a propria data. O reparo do historico
-- recalcula as linhas de cartao depois; ate la, o app se comporta como hoje.
UPDATE "Transaction" SET "competenceDate" = "date";

ALTER TABLE "Transaction" ALTER COLUMN "competenceDate" SET NOT NULL;

ALTER TABLE "Transaction" ADD COLUMN "purchaseDate" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "purchaseKey" TEXT;

-- `userId, competenceDate` substitui `userId, date` como o indice que relatorio
-- e orcamento passam a usar. O antigo fica: a lista por intervalo de datas e o
-- pareamento de transferencia continuam na data real.
CREATE INDEX "Transaction_userId_competenceDate_idx" ON "Transaction"("userId", "competenceDate");
CREATE INDEX "Transaction_purchaseKey_idx" ON "Transaction"("purchaseKey");
```

- [ ] **Step 3: Aplicar e regenerar**

```bash
npm run prisma:deploy --workspace=apps/api
```

Esperado: `1 migration applied`.

```bash
npm run prisma:generate
```

Esperado: `Generated Prisma Client`.

- [ ] **Step 4: Confirmar que a API quebra onde deve**

```bash
npm run build --workspace=apps/api
```

Esperado: **FAIL** em `transactions.service.ts` e `pluggy.service.ts` — `competenceDate` é obrigatório em todo `create`, e nenhum deles o informa ainda. É o resultado desejado: são as Tasks 4 e 5.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): competencia, data da compra e chave de agrupamento na transacao"
```

---

### Task 3: A regra do mês da fatura, do vencimento e da competência

Aqui mora a correção que abriu este trabalho: `billForecastDate` vale para a parcela 1, e cada parcela seguinte anda um mês.

**Files:**
- Modify: `apps/api/src/lib/pluggyMapping.ts`
- Test: `apps/api/src/lib/pluggyMapping.test.ts`

**Interfaces:**
- Consumes: `proximoDiaUtil` de `./diasUteis`.
- Produces:
  - `mesDaFatura(data: Date, billForecastDate?: string | null, installmentNumber?: number | null): string` — **assinatura mudou**, ganhou o terceiro parâmetro
  - `vencimentoDaFatura(billMonth: string | null, dueDay: number | null): Date | null` — mesma assinatura, agora posterga para dia útil
  - `competenciaDaTransacao(date: Date, billMonth: string | null): Date`

- [ ] **Step 1: Escrever os testes novos**

Em `apps/api/src/lib/pluggyMapping.test.ts`, **substitua o `describe("mesDaFatura")` inteiro** por:

```ts
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

  // O caso que motivou este plano: o Mercado Pago manda as dez parcelas de uma
  // vez, todas com a mesma data e o mesmo billForecastDate. Sem o deslocamento
  // as dez cairiam na mesma fatura.
  it("a parcela 1 nao desloca", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 1)).toBe("2026-09");
  });

  it("a parcela 3 anda dois meses", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 3)).toBe("2026-11");
  });

  it("a ultima parcela de um 10x vira o ano", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 10)).toBe("2027-06");
  });

  it("desloca tambem quando o mes foi derivado, e nao recebido", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), null, 3)).toBe("2026-11");
  });

  it("parcela ausente ou invalida nao desloca", () => {
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", null)).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 0)).toBe("2026-09");
    expect(mesDaFatura(new Date("2026-08-03T00:00:00Z"), "2026-09", 1.5)).toBe("2026-09");
  });
});
```

E **substitua o `describe("vencimentoDaFatura")` inteiro** por:

```ts
describe("vencimentoDaFatura", () => {
  it("combina o mes da fatura com o dia da conta", () => {
    // 10/09/2026 e uma quinta-feira: nao anda.
    expect(vencimentoDaFatura("2026-09", 10)?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("limita ao ultimo dia do mes", () => {
    // Vencimento 31 em fevereiro nao pode virar 3 de marco em silencio, que e
    // o que `Date.UTC(2026, 1, 31)` faz sozinho. 28/02/2026 e sabado, entao
    // depois do limite ainda anda para segunda.
    expect(vencimentoDaFatura("2026-02", 31)?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });

  it("respeita ano bissexto antes de decidir o dia util", () => {
    // 29/02/2028 e uma terca-feira: limita e nao anda.
    expect(vencimentoDaFatura("2028-02", 31)?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("posterga vencimento que cai em fim de semana", () => {
    // 12/09/2026 e sabado.
    expect(vencimentoDaFatura("2026-09", 12)?.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("posterga vencimento que cai em feriado", () => {
    // 07/09/2026 e segunda-feira e feriado nacional.
    expect(vencimentoDaFatura("2026-09", 7)?.toISOString()).toBe("2026-09-08T00:00:00.000Z");
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
```

E acrescente um `describe` novo no fim do arquivo:

```ts
describe("competenciaDaTransacao", () => {
  it("sem fatura, a competencia e a propria data", () => {
    const data = new Date("2026-08-22T14:30:00Z");
    expect(competenciaDaTransacao(data, null).toISOString()).toBe("2026-08-22T14:30:00.000Z");
  });

  it("com fatura, e o primeiro dia do mes dela", () => {
    // O dia nao importa e nao pode importar: a competencia e mensal, e fixar o
    // dia 1 e o que a mantem independente de `creditCardDueDay`.
    expect(
      competenciaDaTransacao(new Date("2026-08-22T14:30:00Z"), "2026-11").toISOString()
    ).toBe("2026-11-01T00:00:00.000Z");
  });

  it("mes malformado nao inventa competencia", () => {
    const data = new Date("2026-08-22T14:30:00Z");
    expect(competenciaDaTransacao(data, "setembro").toISOString()).toBe(
      "2026-08-22T14:30:00.000Z"
    );
  });
});
```

Por fim, acrescente `competenciaDaTransacao` ao `import` do topo do arquivo de teste:

```ts
import {
  DIA_DE_VENCIMENTO_PADRAO,
  competenciaDaTransacao,
  dadosDeParcela,
  diaDeVencimentoInicial,
  mesDaFatura,
  sinalDaTransacao,
  valorAbsoluto,
  vencimentoDaFatura,
} from "./pluggyMapping";
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npm run test --workspace=apps/api
```

Esperado: FAIL. `competenciaDaTransacao` não existe; a parcela 3 dá `2026-09` em vez de `2026-11`; o vencimento em sábado não anda.

- [ ] **Step 3: Ampliar `mesDaFatura`**

Em `apps/api/src/lib/pluggyMapping.ts`, substitua a função `mesDaFatura` inteira (docstring incluída):

```ts
/**
 * O mes da fatura em que a transacao cai, como "YYYY-MM".
 *
 * Duas fontes, nesta ordem: o `billForecastDate` que a Pluggy manda nos
 * conectores Open Finance, e — sem ele — o mes da transacao mais um.
 *
 * Sobre as duas incide o deslocamento da parcela. O motivo e concreto: o
 * Mercado Pago entrega uma compra em 10x como dez transacoes de uma vez, todas
 * com a data da compra e **todas com o mesmo `billForecastDate`**. Tomado ao pe
 * da letra, o campo joga as dez na mesma fatura. O que ele diz, na pratica, e
 * qual e a fatura da *primeira* parcela; da segunda em diante, cada uma anda um
 * mes.
 *
 * Compra a vista tem `installmentNumber` ausente e nao desloca nada.
 */
export function mesDaFatura(
  data: Date,
  billForecastDate?: string | null,
  installmentNumber?: number | null
): string {
  let ano: number;
  let mes: number; // 1-based

  if (billForecastDate && /^\d{4}-(0[1-9]|1[0-2])$/.test(billForecastDate)) {
    const [a, m] = billForecastDate.split("-").map(Number);
    ano = a;
    mes = m;
  } else {
    const proximo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 1));
    ano = proximo.getUTCFullYear();
    mes = proximo.getUTCMonth() + 1;
  }

  const deslocamento =
    typeof installmentNumber === "number" &&
    Number.isInteger(installmentNumber) &&
    installmentNumber >= 1
      ? installmentNumber - 1
      : 0;

  // Deixar o `Date` normalizar o excesso de meses e o que faz a virada de ano
  // sair de graca: mes 18 de 2026 vira junho de 2027.
  const deslocado = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  return chaveDeMes(deslocado.getUTCFullYear(), deslocado.getUTCMonth() + 1);
}
```

- [ ] **Step 4: Passar o número da parcela em `dadosDeParcela`**

Ainda em `pluggyMapping.ts`, substitua o corpo de `dadosDeParcela` (da linha `const meta` até o `return` final):

```ts
  const meta = pTx.creditCardMetadata;
  if (!meta) {
    return { installmentIndex: null, installmentTotal: null, billMonth: null };
  }

  const total = inteiroNaFaixa(meta.totalInstallments, 1, 999);
  const indice = total === null ? null : inteiroNaFaixa(meta.installmentNumber, 1, total);

  // O deslocamento usa o indice **ja validado**: uma parcela "0 de 10" nao pode
  // empurrar a fatura para tras.
  const billMonth = mesDaFatura(new Date(pTx.date), meta.billForecastDate, indice);

  return indice === null
    ? { installmentIndex: null, installmentTotal: null, billMonth }
    : { installmentIndex: indice, installmentTotal: total, billMonth };
```

- [ ] **Step 5: Postergar o vencimento ao dia útil**

Ainda em `pluggyMapping.ts`, acrescente o import no topo, logo abaixo do import do `pluggy-sdk`:

```ts
import { proximoDiaUtil } from "./diasUteis";
```

E substitua as duas últimas linhas de `vencimentoDaFatura` (a partir de `const [ano, mes]`):

```ts
  const [ano, mes] = billMonth.split("-").map(Number);
  // Dia 0 do mes seguinte e o ultimo dia deste.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const nominal = new Date(Date.UTC(ano, mes - 1, Math.min(dueDay, ultimoDia)));
  // O emissor nao cobra em sabado, domingo ou feriado: posterga. Mostrar a data
  // nominal faria o app discordar do banco em alguns dias por ano.
  return proximoDiaUtil(nominal);
```

E acrescente à docstring dela, logo antes do `*/` final:

```
 * O resultado passa pelo calendario de dias uteis: vencimento em fim de semana
 * ou feriado anda para o proximo dia util, que e o que o emissor faz.
```

- [ ] **Step 6: Escrever `competenciaDaTransacao`**

No fim de `apps/api/src/lib/pluggyMapping.ts`:

```ts
/**
 * O mes em que a transacao conta, como data — sempre o primeiro dia dele.
 *
 * Transacao de cartao conta no mes da fatura: e la que a despesa pesa no
 * orcamento. Todo o resto conta no proprio dia.
 *
 * Fixar o dia 1 nao e detalhe: e o que mantem a coluna independente do dia de
 * vencimento do cartao. Guardasse o vencimento, mudar `creditCardDueDay`
 * exigiria reescrever a competencia de todas as parcelas.
 */
export function competenciaDaTransacao(date: Date, billMonth: string | null): Date {
  if (!billMonth || !/^\d{4}-(0[1-9]|1[0-2])$/.test(billMonth)) return date;
  const [ano, mes] = billMonth.split("-").map(Number);
  return new Date(Date.UTC(ano, mes - 1, 1));
}
```

- [ ] **Step 7: Rodar e confirmar que passa**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS, todos. Se `dadosDeParcela` falhar no caso "compra a vista no cartao tem fatura, mas nao tem parcela", confirme que o `billMonth` é calculado **depois** da validação do índice e recebe `indice`, que ali é `null`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/pluggyMapping.ts apps/api/src/lib/pluggyMapping.test.ts
git commit -m "feat(api): cada parcela na fatura dela, e vencimento no dia util"
```

---

### Task 4: A chave da compra

**Files:**
- Create: `apps/api/src/lib/purchaseKey.ts`
- Test: `apps/api/src/lib/purchaseKey.test.ts`

**Interfaces:**
- Consumes: `merchantKey` de `./categorization/normalize`.
- Produces: `purchaseKeyDe(entrada: EntradaDeCompra): string | null`, com
  ```ts
  export interface EntradaDeCompra {
    accountId: string;
    date: Date;
    description: string;
    purchaseDate?: Date | null;
    cnpj?: string | null;
    totalInstallments?: number | null;
  }
  ```

- [ ] **Step 1: Escrever o teste**

Crie `apps/api/src/lib/purchaseKey.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { purchaseKeyDe } from "./purchaseKey";

const base = {
  accountId: "conta-1",
  date: new Date("2026-08-03T00:00:00Z"),
  description: "LOJA X SAO PAULO",
  purchaseDate: new Date("2026-08-03T00:00:00Z"),
  totalInstallments: 10,
};

describe("purchaseKeyDe", () => {
  it("duas parcelas da mesma compra dao a mesma chave", () => {
    expect(purchaseKeyDe(base)).toBe(purchaseKeyDe({ ...base }));
  });

  it("ignora o numero da parcela grudado na descricao", () => {
    // "LOJA X 01/10" e "LOJA X 02/10" sao a mesma compra. `merchantKey` corta
    // nos tres primeiros tokens normalizados, entao o sufixo cai fora.
    const p1 = purchaseKeyDe({ ...base, description: "LOJA X SAO 01/10" });
    const p2 = purchaseKeyDe({ ...base, description: "LOJA X SAO 02/10" });
    expect(p1).toBe(p2);
  });

  it("compras em contas diferentes nao se juntam", () => {
    expect(purchaseKeyDe(base)).not.toBe(purchaseKeyDe({ ...base, accountId: "conta-2" }));
  });

  it("parcelamentos diferentes no mesmo lojista nao se juntam", () => {
    // Uma compra em 10x e outra em 3x no mesmo dia sao duas compras.
    expect(purchaseKeyDe(base)).not.toBe(purchaseKeyDe({ ...base, totalInstallments: 3 }));
  });

  it("dias diferentes nao se juntam", () => {
    expect(purchaseKeyDe(base)).not.toBe(
      purchaseKeyDe({ ...base, purchaseDate: new Date("2026-08-04T00:00:00Z") })
    );
  });

  it("o CNPJ tem precedencia sobre a descricao", () => {
    // Mesmo CNPJ, descricoes que nao casariam: ainda e a mesma compra.
    const a = purchaseKeyDe({ ...base, cnpj: "12345678000199", description: "LOJA X SAO" });
    const b = purchaseKeyDe({ ...base, cnpj: "12345678000199", description: "OUTRO NOME AQUI" });
    expect(a).toBe(b);
  });

  it("CNPJ diferente nao se junta", () => {
    const a = purchaseKeyDe({ ...base, cnpj: "12345678000199" });
    const b = purchaseKeyDe({ ...base, cnpj: "99999999000100" });
    expect(a).not.toBe(b);
  });

  it("cai na data da transacao quando nao ha purchaseDate", () => {
    const semCompra = purchaseKeyDe({ ...base, purchaseDate: null });
    expect(semCompra).not.toBeNull();
    // A `date` do base e o mesmo dia do purchaseDate, entao a chave coincide.
    expect(semCompra).toBe(purchaseKeyDe(base));
  });

  it("sem parcelamento nao ha compra a agrupar", () => {
    // Compra a vista nao vira grupo: um dropdown de uma parcela so e ruido.
    expect(purchaseKeyDe({ ...base, totalInstallments: null })).toBeNull();
    expect(purchaseKeyDe({ ...base, totalInstallments: 1 })).toBeNull();
  });

  it("descricao curta demais e sem CNPJ nao gera chave", () => {
    // Sem nada que identifique o lojista, agrupar seria juntar por acaso.
    expect(purchaseKeyDe({ ...base, description: "X", cnpj: null })).toBeNull();
  });

  it("a chave e estavel entre execucoes", () => {
    // Ela e gravada no banco: mudar o algoritmo silenciosamente separaria
    // parcelas ja agrupadas.
    expect(purchaseKeyDe(base)).toBe(purchaseKeyDe(base));
    expect(purchaseKeyDe(base)).toMatch(/^[0-9a-f]{40}$/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
npm run test --workspace=apps/api
```

Esperado: FAIL — `Failed to resolve import "./purchaseKey"`.

- [ ] **Step 3: Escrever a implementação**

Crie `apps/api/src/lib/purchaseKey.ts`:

```ts
import { createHash } from "node:crypto";
import { merchantKey } from "./categorization/normalize";

/**
 * A chave que junta as parcelas de uma mesma compra.
 *
 * A Pluggy nao manda identificador de compra nenhum: manda N transacoes que so
 * se parecem. Entao a chave e derivada — e derivada de coisas estaveis entre as
 * parcelas, que sao a conta, o dia da compra, o lojista e o total de parcelas.
 *
 * O que **nao** entra: o valor da parcela (que pode variar em centavos no
 * arredondamento) e o numero da parcela (que e justamente o que difere).
 */
export interface EntradaDeCompra {
  accountId: string;
  date: Date;
  description: string;
  /** `creditCardMetadata.purchaseDate`, quando a Pluggy o manda. */
  purchaseDate?: Date | null;
  /** `merchant.cnpj`, quando vem. Estavel, e por isso tem precedencia. */
  cnpj?: string | null;
  totalInstallments?: number | null;
}

/** "YYYY-MM-DD" em UTC. A hora nao entra: parcelas podem chegar em horas diferentes. */
function diaDe(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * A chave, ou null quando nao ha compra a agrupar.
 *
 * Devolve null em dois casos, e os dois sao deliberados: compra a vista (um
 * grupo de um item e ruido na tela) e lojista irreconhecivel (agrupar por acaso
 * e pior que nao agrupar).
 */
export function purchaseKeyDe(entrada: EntradaDeCompra): string | null {
  const total = entrada.totalInstallments;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 2) return null;

  // CNPJ antes da descricao: descricao de cartao carrega o numero da parcela e
  // a cidade, e varia entre as linhas da mesma compra.
  const lojista = entrada.cnpj?.replace(/\D/g, "") || merchantKey(entrada.description);
  if (!lojista) return null;

  const dia = diaDe(entrada.purchaseDate ?? entrada.date);

  return createHash("sha1")
    .update([entrada.accountId, dia, lojista, String(total)].join("|"))
    .digest("hex");
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
npm run test --workspace=apps/api
```

Esperado: PASS. Se o caso do sufixo "01/10" falhar, confira `merchantKey` em `lib/categorization/normalize.ts`: ele corta nos três primeiros tokens, então a descrição do teste precisa ter três tokens antes do sufixo.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/purchaseKey.ts apps/api/src/lib/purchaseKey.test.ts
git commit -m "feat(api): chave que junta as parcelas de uma mesma compra"
```

---

### Task 5: O sync e o reparo gravam competência e agrupamento

**Files:**
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts`

**Interfaces:**
- Consumes: `competenciaDaTransacao` de `../../lib/pluggyMapping`; `purchaseKeyDe` de `../../lib/purchaseKey`.
- Produces: nada para outras tasks — o efeito é no banco.

- [ ] **Step 1: Importar o que falta**

Em `apps/api/src/modules/pluggy/pluggy.service.ts`, acrescente `competenciaDaTransacao` ao import de `../../lib/pluggyMapping`, que fica assim:

```ts
import {
  competenciaDaTransacao,
  dadosDeParcela,
  diaDeVencimentoInicial,
  sinalDaTransacao,
  valorAbsoluto,
} from "../../lib/pluggyMapping";
```

E acrescente, logo abaixo:

```ts
import { purchaseKeyDe } from "../../lib/purchaseKey";
```

- [ ] **Step 2: Extrair o mapeamento numa função só**

O sync e o reparo montam o mesmo objeto `campos`, e agora ele tem oito chaves — duplicá-lo é como o bug do sinal nasceu. No mesmo arquivo, logo **acima** de `async function buscarPorPluggyIds`, acrescente:

```ts
/**
 * Os campos de uma transacao da Pluggy, do jeito que vao para o banco.
 *
 * Existe como funcao porque o sync e o reparo precisam do **mesmo** calculo: foi
 * exatamente por essa logica viver duplicada dentro de um laco que o sinal do
 * estorno ficou errado por meses sem ninguem ver.
 */
function camposDaTransacao(pTx: PluggyTransaction, accountId: string) {
  const parcela = dadosDeParcela(pTx);
  const purchaseDate = pTx.creditCardMetadata?.purchaseDate
    ? new Date(pTx.creditCardMetadata.purchaseDate)
    : null;
  const date = new Date(pTx.date);
  const description = (
    pTx.description ||
    pTx.descriptionRaw ||
    "Transação sem descrição"
  ).trim();

  return {
    description,
    amount: new Prisma.Decimal(valorAbsoluto(pTx.amount)),
    // O `type` da Pluggy manda. A versão antiga misturava `type` com o sinal
    // do valor, e num cartão isso invertia todo estorno.
    type: sinalDaTransacao(pTx.type, pTx.amount) as TransactionType,
    date,
    accountId,
    ...parcela,
    // Onde a despesa pesa. Para cartão é o mês da fatura, e não o dia da compra.
    competenceDate: competenciaDaTransacao(date, parcela.billMonth),
    purchaseDate,
    purchaseKey: purchaseKeyDe({
      accountId,
      date,
      description,
      purchaseDate,
      cnpj: pTx.merchant?.cnpj ?? null,
      totalInstallments: parcela.installmentTotal,
    }),
  };
}
```

- [ ] **Step 3: Trazer os campos novos para a busca das existentes**

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
        competenceDate: true,
        purchaseDate: true,
        purchaseKey: true,
      },
```

- [ ] **Step 4: Extrair a comparação**

Logo **abaixo** de `camposDaTransacao`, acrescente:

```ts
/** O que `buscarPorPluggyIds` devolve, para a comparacao abaixo. */
type LinhaExistente = Awaited<ReturnType<typeof buscarPorPluggyIds>>[number];

/**
 * Se a linha local ja diz exatamente o que a Pluggy esta dizendo.
 *
 * Reescrever uma linha identica custa uma ida ao banco e nao muda nada — e, com
 * a janela de revisita, quase tudo que volta e identico.
 */
function naoMudou(
  existente: LinhaExistente,
  campos: ReturnType<typeof camposDaTransacao>
): boolean {
  return (
    existente.description === campos.description &&
    existente.amount.equals(campos.amount) &&
    existente.type === campos.type &&
    existente.date.getTime() === campos.date.getTime() &&
    existente.accountId === campos.accountId &&
    existente.installmentIndex === campos.installmentIndex &&
    existente.installmentTotal === campos.installmentTotal &&
    existente.billMonth === campos.billMonth &&
    existente.competenceDate.getTime() === campos.competenceDate.getTime() &&
    (existente.purchaseDate?.getTime() ?? null) === (campos.purchaseDate?.getTime() ?? null) &&
    existente.purchaseKey === campos.purchaseKey
  );
}
```

- [ ] **Step 5: Usar as duas no `syncItem`**

Dentro de `syncItem`, no `for (const pTx of transactions)`, substitua tudo do `const campos = {` até o fecho do `if (...) { continue; }` por:

```ts
      const campos = camposDaTransacao(pTx, accountRecord.id);

      const existente = existentePorPluggyId.get(pTx.id);

      if (!existente) {
        novas.push({ userId, pluggyTransactionId: pTx.id, isRecurring: false, ...campos });
        continue;
      }

      if (naoMudou(existente, campos)) {
        continue;
      }
```

- [ ] **Step 6: Usar as duas no `repairAccount`**

Mais abaixo, dentro de `repairAccount`, substitua tudo do `const campos = {` até o fecho do `if (...) { continue; }` por:

```ts
    const campos = camposDaTransacao(pTx, account.id);

    if (naoMudou(existente, campos)) {
      continue;
    }
```

- [ ] **Step 7: Compilar**

```bash
npm run build --workspace=apps/api
```

Esperado: **FAIL**, mas **só** em `transactions.service.ts` — `createTransaction` ainda não informa `competenceDate`, que é obrigatório. É a Task 6. Nenhum erro restante em `pluggy.service.ts`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/pluggy/pluggy.service.ts
git commit -m "feat(sync): competencia, data da compra e chave de agrupamento gravadas"
```

---

### Task 6: Lançamento manual e competência nos consumidores

Aqui os números mudam. É a task que o usuário vai sentir.

**Files:**
- Modify: `apps/api/src/modules/transactions/transactions.service.ts`
- Modify: `apps/api/src/modules/reports/reports.service.ts`
- Modify: `apps/api/src/modules/budgets/budgets.service.ts`

**Interfaces:**
- Consumes: nada de novo.
- Produces: nada para outras tasks.

- [ ] **Step 1: Lançamento manual grava competência**

Em `apps/api/src/modules/transactions/transactions.service.ts`, em `createTransaction`, no objeto `data:` do `prisma.transaction.create`, acrescente logo depois da linha `date: ...`:

```ts
      // Lançamento manual não tem fatura: competência é o próprio dia. Quando
      // parcela manual existir, é aqui que ela vai divergir.
      competenceDate: new Date(input.date),
```

- [ ] **Step 2: Atualização manual de data acompanha a competência**

Ainda em `transactions.service.ts`, em `updateTransaction`: se o `data:` do `prisma.transaction.update` aceita `date`, ele precisa mexer na competência junto, ou editar a data de um lançamento manual o deixaria contando no mês antigo. Localize o objeto `data:` e acrescente, imediatamente após a linha que trata `date`:

```ts
      // A competência de um lançamento manual é a própria data: mudar uma sem a
      // outra deixaria a transação somando num mês e aparecendo em outro. Não
      // toca em transação de cartão, cuja competência é a fatura — e cuja data
      // o usuário não edita.
      ...(input.date !== undefined && { competenceDate: new Date(input.date) }),
```

Se `updateTransaction` não aceitar `date` hoje, pule este passo e siga — não invente o campo.

- [ ] **Step 3: O filtro de mês da lista passa a ser por competência**

Ainda em `transactions.service.ts`, em `listTransactions`, dentro do `if (filters.month) { ... }`, substitua a atribuição de `where.date`:

```ts
      // O mês da lista é o mês em que a despesa **conta** — a parcela aparece
      // na fatura dela, não no dia da compra. O filtro por intervalo de datas,
      // logo abaixo, continua na data real de propósito: quem digita um
      // intervalo está procurando quando algo aconteceu.
      where.competenceDate = {
        gte: startOfMonth,
        lt: startOfNextMonth,
      };
```

- [ ] **Step 4: Relatórios por competência**

Em `apps/api/src/modules/reports/reports.service.ts`, substitua `dateFilter` inteira:

```ts
/**
 * A janela do periodo, sobre a competencia.
 *
 * Competencia e nao `date` porque uma compra em 10x tem as dez parcelas com a
 * data da compra: somar por `date` colocaria os R$ 300 inteiros no mes em que se
 * comprou, em vez de R$ 30 em cada uma das dez faturas.
 */
function dateFilter(period: ResolvedPeriod): Prisma.TransactionWhereInput {
  if (!period.start && !period.end) return {};
  return {
    competenceDate: {
      ...(period.start ? { gte: period.start } : {}),
      ...(period.end ? { lt: period.end } : {}),
    },
  };
}
```

- [ ] **Step 5: A série mensal também**

Ainda em `reports.service.ts`, dentro de `monthlySeries`, substitua as três menções a `"date"` no SQL cru — a do `date_trunc` e as duas do `WHERE`:

```ts
  const rows = await prisma.$queryRaw<MonthlyRow[]>`
    SELECT to_char(date_trunc('month', "competenceDate" AT TIME ZONE 'UTC'), 'YYYY-MM') AS month,
           "type"::text AS type,
           SUM("amount") AS total
    FROM "Transaction"
    WHERE "userId" = ${userId}
      AND "competenceDate" >= ${start}
      AND "competenceDate" < ${end}
      AND "categoryId" IS DISTINCT FROM ${transferId}
    GROUP BY 1, 2
  `;
```

- [ ] **Step 6: Orçamentos por competência**

Em `apps/api/src/modules/budgets/budgets.service.ts` há **duas** janelas de mês. Na primeira (dentro do `findMany` que soma o consumido), substitua:

```ts
      // O orçamento do mês é sobre o que conta naquele mês: a parcela pesa na
      // fatura dela, e não toda de uma vez no dia da compra.
      competenceDate: {
        gte: startOfMonth,
        lt: startOfNextMonth,
      },
```

Na segunda (dentro do `aggregate` de `totalSpentAgg`), substitua:

```ts
      competenceDate: { gte: startOfMonth, lt: startOfNextMonth },
```

- [ ] **Step 7: Compilar e testar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS, sem erro restante.

```bash
npm run test --workspace=apps/api
```

Esperado: PASS. Nenhum teste da API toca relatório ou orçamento — eles vivem em `lib/`.

- [ ] **Step 8: Confirmar à mão que a competência mudou os números**

Com a API rodando (`npm run dev`), compare `GET /api/reports/summary?month=<mês com parcela>` antes e depois. O sinal de que funcionou: o mês da compra **diminui**, e os meses seguintes **aparecem** com as parcelas. Se nada mudou, é porque nenhuma transação tem `billMonth` ainda — rode o reparo do histórico no Perfil primeiro.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/transactions apps/api/src/modules/reports apps/api/src/modules/budgets
git commit -m "feat(api): relatorios, orcamentos e lista somam por competencia"
```

---

### Task 7: Os tipos compartilhados e o endpoint das parcelas

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/api/src/modules/transactions/transactions.service.ts`
- Modify: `apps/api/src/modules/transactions/transactions.routes.ts`

**Interfaces:**
- Consumes: `TX_INCLUDE`, `formatTransactionDTO` (já existem em `transactions.service.ts`).
- Produces:
  - `TransactionDTO.competenceDate: string`, `TransactionDTO.purchaseKey: string | null`
  - `interface InstallmentsResponse { installments: TransactionDTO[]; total: number }`
  - `listInstallments(userId: string, transactionId: string): Promise<InstallmentsResponse>`
  - Rota: `GET /api/transactions/:id/installments` → `InstallmentsResponse`

- [ ] **Step 1: Ampliar `TransactionDTO`**

Em `packages/shared/src/index.ts`, em `TransactionDTO`, logo depois de `dueDate: string | null;`:

```ts
  /**
   * O mes em que a transacao conta (ISO, sempre dia 1 quando vem de fatura).
   * Para cartao e o mes da fatura; para o resto e o proprio dia. E por ele que
   * relatorio, orcamento e a lista mensal somam.
   */
  competenceDate: string;
  /** Junta as parcelas de uma mesma compra. Null quando nao ha o que agrupar. */
  purchaseKey: string | null;
```

- [ ] **Step 2: Declarar a resposta do dropdown**

No mesmo arquivo, logo abaixo de `TransactionDTO`:

```ts
export interface InstallmentsResponse {
  /** As parcelas da compra, ordenadas por numero. */
  installments: TransactionDTO[];
  /** A soma das parcelas conhecidas — o valor da compra. */
  total: number;
}
```

- [ ] **Step 3: Compilar o shared**

```bash
npm run build:shared
```

Esperado: PASS.

- [ ] **Step 4: Devolver os campos novos no DTO**

Em `apps/api/src/modules/transactions/transactions.service.ts`, em `formatTransactionDTO`, acrescente ao tipo do parâmetro (junto de `billMonth: string | null;`):

```ts
  competenceDate: Date;
  purchaseKey: string | null;
```

E ao objeto devolvido, logo depois da linha do `dueDate`:

```ts
    competenceDate: tx.competenceDate.toISOString(),
    purchaseKey: tx.purchaseKey,
```

- [ ] **Step 5: Escrever `listInstallments`**

No fim de `apps/api/src/modules/transactions/transactions.service.ts`:

```ts
/**
 * As parcelas da compra a que uma transacao pertence.
 *
 * Vive num endpoint proprio, e nao embutido na listagem, porque a lista mensal
 * mostra **uma** parcela por compra: mandar as dez em toda listagem seria
 * multiplicar a resposta por dez para alimentar um dropdown que quase nunca e
 * aberto.
 *
 * O par (id, userId) e o que prova posse — id sozinho nao prova nada.
 */
export async function listInstallments(
  userId: string,
  transactionId: string
): Promise<InstallmentsResponse> {
  const base = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { purchaseKey: true },
  });

  if (!base) {
    throw new TransactionNotFoundError();
  }

  // Compra a vista nao tem grupo. Devolver a propria linha seria mentir que ha
  // um parcelamento de um item so.
  if (!base.purchaseKey) {
    return { installments: [], total: 0 };
  }

  const rows = await prisma.transaction.findMany({
    where: { userId, purchaseKey: base.purchaseKey },
    include: TX_INCLUDE,
    orderBy: [{ installmentIndex: "asc" }, { competenceDate: "asc" }],
  });

  const installments = rows.map(formatTransactionDTO);
  // A soma das parcelas que existem, e nao `creditCardMetadata.totalAmount`: se
  // o historico so trouxe seis das dez, o total tem de dizer seis — um numero
  // que nao bate com as linhas exibidas e pior que numero nenhum.
  const total = Number(
    installments.reduce((soma, t) => soma + t.amount, 0).toFixed(2)
  );

  return { installments, total };
}
```

E acrescente `InstallmentsResponse` ao import de `@poup/shared` no topo do arquivo:

```ts
import type { InstallmentsResponse, TransactionDTO, TransactionType } from "@poup/shared";
```

- [ ] **Step 6: Expor a rota**

Em `apps/api/src/modules/transactions/transactions.routes.ts`, acrescente `listInstallments` ao import do service e, depois da rota `GET /:id`:

```ts
/**
 * As parcelas da compra a que esta transação pertence. Endpoint próprio porque
 * a lista mensal traz uma parcela por compra, e as demais só interessam quando
 * o usuário abre o dropdown.
 */
transactionsRouter.get(
  "/:id/installments",
  asyncHandler(async (req, res) => {
    const result = await listInstallments(req.userId!, req.params.id);
    res.json(result);
  })
);
```

**Atenção à ordem:** esta rota tem de vir **antes** de qualquer `router.get("/:id")` que já exista, ou o Express casa `/:id` com `"abc/installments"` primeiro. Se `GET /:id` já está declarado acima, mova o bloco novo para antes dele.

- [ ] **Step 7: Compilar e testar**

```bash
npm run build --workspace=apps/api
```

Esperado: PASS.

```bash
npm run test --workspace=apps/api
```

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/index.ts apps/api/src/modules/transactions
git commit -m "feat(api): competencia no DTO e endpoint das parcelas de uma compra"
```

---

### Task 8: Web — o dropdown das parcelas

**Files:**
- Create: `apps/web/src/components/transactions/InstallmentGroup.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/pages/TransactionsPage.tsx`

**Interfaces:**
- Consumes: `InstallmentsResponse`, `TransactionDTO` de `@poup/shared`.
- Produces:
  - `fetchInstallments(transactionId: string): Promise<InstallmentsResponse>` em `lib/api.ts`
  - `export function InstallmentGroup(props: { transaction: TransactionDTO }): JSX.Element`

- [ ] **Step 1: Cliente da rota**

Em `apps/web/src/lib/api.ts`, na seção de transações, depois de `fetchTransactions` (ou da função de buscar uma transação):

```ts
/**
 * As parcelas da compra a que a transação pertence. Só é chamada quando o
 * usuário abre o dropdown — a lista mensal traz uma parcela por compra.
 */
export async function fetchInstallments(
  transactionId: string
): Promise<InstallmentsResponse> {
  return request<InstallmentsResponse>(`/transactions/${transactionId}/installments`);
}
```

E acrescente `InstallmentsResponse` ao import de tipos de `@poup/shared` no topo do arquivo.

- [ ] **Step 2: Escrever o componente**

Crie `apps/web/src/components/transactions/InstallmentGroup.tsx`:

```tsx
import React, { useState } from "react";
import type { InstallmentsResponse, TransactionDTO } from "@poup/shared";
import { fetchInstallments } from "../../lib/api";
import { Money } from "../ui/Money";
import { formatDate } from "../../lib/format";

export interface InstallmentGroupProps {
  transaction: TransactionDTO;
}

/**
 * O selo `3/10` que abre a compra inteira.
 *
 * A lista do mês mostra a parcela **daquele mês** — é o que você gastou ali. O
 * dropdown existe para a pergunta seguinte, que a lista não responde: "e as
 * outras nove, quando caem?". Por isso ele carrega sob demanda: quase ninguém
 * abre, e trazer as dez em toda listagem multiplicaria a resposta por dez.
 */
export function InstallmentGroup({ transaction }: InstallmentGroupProps) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<InstallmentsResponse | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!transaction.installmentTotal) return null;

  async function alternar(e: React.MouseEvent) {
    // A linha inteira abre o modal de detalhe: o selo não pode abrir os dois.
    e.stopPropagation();

    if (aberto) {
      setAberto(false);
      return;
    }

    setAberto(true);
    if (dados || carregando) return;

    try {
      setCarregando(true);
      setErro(null);
      setDados(await fetchInstallments(transaction.id));
    } catch (err: any) {
      setErro(err.message || "Não foi possível carregar as parcelas.");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        title={`Ver as ${transaction.installmentTotal} parcelas desta compra`}
        className="shrink-0 text-[10px] font-bold tnum px-1.5 py-0.5 rounded-chip bg-surface-sunken border border-border text-text-secondary hover:border-border-strong hover:text-text-primary transition-colors focus-ring cursor-pointer"
      >
        {transaction.installmentIndex}/{transaction.installmentTotal}
      </button>

      {aberto && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="basis-full mt-2 p-2.5 rounded-tile bg-surface-sunken border border-border flex flex-col gap-1 anim-fade-down"
        >
          {carregando && (
            <span className="text-[11px] text-text-secondary">Carregando parcelas…</span>
          )}

          {erro && <span className="text-[11px] text-error">{erro}</span>}

          {dados?.installments.map((parcela) => (
            <div
              key={parcela.id}
              className={`flex items-center justify-between gap-3 text-[11px] px-1.5 py-1 rounded-ctl ${
                parcela.id === transaction.id
                  ? "bg-primary-soft text-text-primary font-semibold"
                  : "text-text-secondary"
              }`}
            >
              <span className="tnum shrink-0">
                {parcela.installmentIndex}/{parcela.installmentTotal}
              </span>
              <span className="tnum text-text-disabled truncate">
                {parcela.dueDate ? `vence ${formatDate(parcela.dueDate)}` : "sem vencimento"}
              </span>
              <span className="tnum shrink-0">
                <Money value={parcela.amount} />
              </span>
            </div>
          ))}

          {dados && dados.installments.length > 0 && (
            <div className="flex items-center justify-between gap-3 text-[11px] px-1.5 pt-1.5 mt-0.5 border-t border-border font-bold text-text-primary">
              <span>Total da compra</span>
              <span className="tnum">
                <Money value={dados.total} />
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Trocar o selo pelas duas listas**

Em `apps/web/src/pages/TransactionsPage.tsx`, o selo estático foi introduzido pelo plano anterior e aparece **duas vezes** — na lista mobile e na tabela desktop. Nos dois lugares, substitua o bloco:

```tsx
                              {tx.installmentTotal && (
                                <span className="shrink-0 text-[10px] font-bold tnum px-1.5 py-0.5 rounded-chip bg-surface-sunken border border-border text-text-secondary">
                                  {tx.installmentIndex}/{tx.installmentTotal}
                                </span>
                              )}
```

por:

```tsx
                              <InstallmentGroup transaction={tx} />
```

O bloco da tabela desktop tem uma unidade a mais de indentação; o conteúdo é o mesmo.

Nos dois casos, acrescente `flex-wrap` à `<div>` que envolve descrição e selo, para que o dropdown (que usa `basis-full`) caia numa linha própria:

```tsx
                            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
```

E acrescente o import no topo do arquivo:

```tsx
import { InstallmentGroup } from "../components/transactions/InstallmentGroup";
```

- [ ] **Step 4: Compilar**

```bash
npm run build --workspace=apps/web
```

Esperado: PASS.

- [ ] **Step 5: Verificar na tela**

Com `npm run dev`, abra Transações num mês que tenha parcela (rode o reparo do Perfil antes, se preciso) e confirme:
- o selo `3/10` agora é clicável e não abre o modal de detalhe junto;
- abrir mostra as N parcelas ordenadas, com vencimento e valor;
- a parcela do mês corrente vem destacada;
- a última linha é "Total da compra";
- fechar e reabrir não dispara nova requisição;
- no celular (largura de 375px) o dropdown cai numa linha própria e não estoura a largura.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/transactions/InstallmentGroup.tsx apps/web/src/lib/api.ts apps/web/src/pages/TransactionsPage.tsx
git commit -m "feat(web): dropdown com as parcelas da compra e o total"
```

---

### Task 9: Reparo, verificação de ponta a ponta e documentação

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

- [ ] **Step 2: Reparar o histórico e conferir o efeito**

O reparo é o que recalcula `competenceDate`, `purchaseKey` e o mês de cada parcela para o que já está no banco — sem ele nada muda na tela.

Com `npm run dev`, no Perfil, rode "Reparar histórico" na conexão do cartão. Espere `updated > 0`. Rode de novo: tem de dar `0`, que é a prova de idempotência.

Depois confirme, nesta ordem:

1. **Parcelas espalhadas** — uma compra em 10x aparecia inteira no mês da compra; agora cada parcela está no mês da fatura dela.
2. **Vencimento em dia útil** — abra uma parcela cujo vencimento caia num sábado e confirme que a data exibida é a segunda seguinte.
3. **Dropdown** — o selo abre as dez, ordenadas, com o total no fim.
4. **Relatório** — o mês da compra diminuiu, e os meses seguintes cresceram.
5. **Orçamento** — o consumo do mês da compra caiu junto.
6. **Intervalo de datas** — filtrar por intervalo (e não por mês) continua achando a compra pela data real. É o comportamento desejado: quem digita intervalo procura quando algo aconteceu.

- [ ] **Step 3: Registrar no `docs/PLAN.md`**

Na lista numerada, acrescente ao fim (o último item hoje é o 49):

```markdown
50. Competência: cada transação sabe em que mês ela **conta**, e é por ela que
    relatórios, orçamentos e a lista mensal somam — uma compra em 10x deixou de
    pesar inteira no mês da compra
51. Vencimento da parcela deslocado pelo número dela (`billForecastDate` vale
    para a primeira; cada seguinte anda um mês) e postergado ao próximo dia
    útil, com feriados nacionais calculados da Páscoa
52. Parcelas de uma mesma compra reunidas num dropdown, ordenadas, com o total
    da compra no fim
```

Na tabela de **Backlog**, acrescente:

```markdown
| Conector que manda parcela mês a mês | O deslocamento `+(n-1)` assume que todas chegam juntas, como no Mercado Pago |
| Parcela em lançamento manual | Competência de lançamento manual é sempre a própria data |
```

- [ ] **Step 4: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs: registrar competencia, dia util e agrupamento de parcelas no PLAN.md"
```

---

## Notas para quem executar

- **Se a Task 2 falhar com "column contains null values"**, o `UPDATE` de backfill não rodou antes do `SET NOT NULL`. Os três comandos precisam sair na ordem escrita, no mesmo arquivo.
- **Se os relatórios não mudarem nada depois da Task 6**, nenhuma transação tem `billMonth` — competência só difere de `date` onde há fatura. Rode o reparo do histórico (Task 9, Step 2) antes de concluir que está quebrado.
- **Se uma parcela aparecer um mês adiantada**, o conector daquele cartão manda as parcelas mês a mês em vez de todas juntas, e o `+(n-1)` está somando duas vezes. O sinal é `date` variando entre parcelas do mesmo `purchaseKey`. Está no Backlog do spec, e a saída é condicionar o deslocamento a esse teste.
- **Se o dropdown vier vazio**, a transação não tem `purchaseKey` — ou a compra é à vista, ou o lojista não foi reconhecido (descrição curta e sem CNPJ). `purchaseKeyDe` devolve `null` nos dois casos de propósito.
- **Não misture `date` e `competenceDate`.** A regra é: soma por mês usa competência; "quando isso aconteceu" usa `date`. Se estiver em dúvida num lugar novo, a tabela da seção 2 do spec lista quem é quem.
