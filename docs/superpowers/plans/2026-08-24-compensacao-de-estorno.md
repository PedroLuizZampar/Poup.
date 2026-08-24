# Compensação de estorno — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que a pessoa ligue à mão um estorno de cartão às parcelas da
compra que ele cancela, tirando as duas pontas de todos os totais.

**Architecture:** Uma coluna `compensationId` em `Transaction` compartilhada pelo
crédito e pelas N parcelas, no mesmo desenho do `transferPairId` existente. A
decisão de quais grupos são elegíveis fica numa função pura em
`lib/compensacao.ts`; o serviço só busca, valida posse e grava. Cinco consultas
que somam dinheiro passam a ignorar linha compensada. Na web, um modal filho do
`TransactionDetailModal`.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL, Zod, Vitest, React,
Tailwind.

**Spec:** `docs/superpowers/specs/2026-08-24-compensacao-de-estorno-design.md`

## Global Constraints

- **Comentários e mensagens de erro em português.** O código do repositório
  comenta o *porquê* da decisão, não o *o quê* do código. Siga o tom dos
  arquivos vizinhos (`lib/pagamentoDeFatura.ts` é a melhor referência).
- **Testes nunca tocam o banco.** Função pura tem teste direto; serviço mocka
  `../../prisma` com `vi.mock`, como em
  `src/modules/categorization/reopen.test.ts`. Não existe harness de Postgres
  neste projeto e não é escopo deste plano criar um.
- **Valor sempre em centavos inteiros na comparação.** `Number(decimal) * 100`
  arredondado. Nunca comparar float de reais com `===`.
- **Posse provada pelo par `(id, userId)`.** Id sozinho não prova nada — é a
  regra escrita em `listInstallments` e vale em toda consulta nova.
- **`compensationId` NUNCA entra em `camposDaTransacao`.** É o que garante que
  sync, `repairAccount` e webhook não sobrescrevam o vínculo. Task 1 trava isso
  com teste.
- **TDD.** Teste primeiro, visto falhando, depois o código mínimo.
- Rodar a suíte com `npm test --workspace=apps/api` e o typecheck com
  `npx tsc -p apps/api/tsconfig.json --noEmit`.

---

### Task 1: A coluna, a migração e o campo no DTO

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `Transaction`)
- Create: `apps/api/prisma/migrations/20260824100000_compensacao_de_estorno/migration.sql`
- Modify: `apps/api/src/modules/pluggy/pluggy.service.ts:231` (exportar `camposDaTransacao`)
- Modify: `apps/api/src/modules/transactions/transactions.service.ts:64` (`formatTransactionDTO`)
- Modify: `packages/shared/src/index.ts:67` (`TransactionDTO`)
- Test: `apps/api/src/modules/pluggy/sync.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: coluna `Transaction.compensationId: String?`; campo
  `TransactionDTO.compensationId: string | null`; export de
  `camposDaTransacao(pTx, accountId)`.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/modules/pluggy/sync.test.ts`, adicione o import e o bloco. O
import de `camposDaTransacao` vem do mesmo módulo que o teste já importa:

```ts
import { camposDaTransacao, dataInicialDaBusca } from "./pluggy.service";
```

```ts
describe("camposDaTransacao", () => {
  /**
   * O sync escreve `data: campos` — tudo o que estiver aqui ele sobrescreve a
   * cada sincronizacao. `compensationId` e uma decisao da pessoa, nao um dado
   * da Pluggy, e por isso precisa ficar de fora. Este teste existe para falhar
   * no dia em que alguem adicionar o campo por engano.
   */
  it("nao inclui o vinculo de compensacao", () => {
    const campos = camposDaTransacao(
      {
        id: "ptx-1",
        description: "MERCADOLIVRE*MERCADOLIVRE",
        amount: 34,
        type: "DEBIT",
        date: new Date("2026-08-17T00:00:00Z"),
        creditCardMetadata: {
          installmentNumber: 1,
          totalInstallments: 8,
          billForecastDate: "2026-09",
        },
      } as any,
      "conta-1"
    );

    expect(Object.keys(campos)).not.toContain("compensationId");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- src/modules/pluggy/sync.test.ts`
Expected: FAIL — `camposDaTransacao is not a function` (a função existe mas não
é exportada).

- [ ] **Step 3: Exportar `camposDaTransacao`**

Em `apps/api/src/modules/pluggy/pluggy.service.ts`, na linha 231, troque
`function camposDaTransacao(` por `export function camposDaTransacao(`.

Precedente: `dataInicialDaBusca` já é exportada exatamente por este motivo — o
teste em `sync.test.ts` a alcança sem que ela seja parte da API do módulo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- src/modules/pluggy/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar a coluna no schema**

Em `apps/api/prisma/schema.prisma`, dentro de `model Transaction`, logo abaixo
de `transferPairId`:

```prisma
  /// Une o estorno de uma compra parcelada as parcelas que ele cancela.
  ///
  /// Mesmo desenho do `transferPairId`: um uuid compartilhado por todas as
  /// pontas, o que torna o vinculo idempotente e o desfazer atomico. A ponta
  /// credito e uma linha INCOME; as outras sao as N parcelas EXPENSE.
  ///
  /// Fica fora de `camposDaTransacao` de proposito, e ha teste guardando isso:
  /// e o que impede o sync, o reparo e o webhook de desfazerem o que a pessoa
  /// resolveu a mao.
  compensationId      String?
```

E, junto dos outros índices do model:

```prisma
  @@index([compensationId])
```

- [ ] **Step 6: Gerar a migração**

```bash
npm run prisma:migrate --workspace=apps/api -- --name compensacao_de_estorno
```

Confira que o SQL gerado é só `ALTER TABLE ... ADD COLUMN` mais `CREATE INDEX`.
Migração aditiva, sem backfill: nenhuma linha existente é tocada.

- [ ] **Step 7: Levar o campo até o DTO**

Em `packages/shared/src/index.ts`, dentro de `TransactionDTO`, depois de
`purchaseKey`:

```ts
  /**
   * Une o estorno as parcelas que ele cancela, quando a pessoa compensou os
   * dois a mao. Null e o normal. Nao-null significa que esta linha esta fora
   * de todos os totais.
   */
  compensationId: string | null;
```

Em `apps/api/src/modules/transactions/transactions.service.ts`, adicione
`compensationId: string | null;` ao tipo do parâmetro de `formatTransactionDTO`
(junto de `purchaseKey`) e `compensationId: tx.compensationId,` ao objeto
retornado.

`TX_INCLUDE` usa `include`, que já traz todas as colunas escalares — nenhuma
mudança lá.

- [ ] **Step 8: Verificar**

```bash
npm run build:shared && npx tsc -p apps/api/tsconfig.json --noEmit && npm test --workspace=apps/api
```
Expected: build e typecheck limpos, suíte inteira verde.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma apps/api/src packages/shared/src/index.ts
git commit -m "feat(api): coluna compensationId e o campo no DTO"
```

---

### Task 2: A decisão, pura

**Files:**
- Create: `apps/api/src/lib/compensacao.ts`
- Test: `apps/api/src/lib/compensacao.test.ts`

**Interfaces:**
- Consumes: nada — função pura, sem Prisma e sem rede.
- Produces:
  - `interface CreditoACompensar { id, accountId, amountCents, compensationId }`
  - `interface GrupoDeCompra { purchaseKey, accountId, description, purchaseDate, installmentTotal, parcelasConhecidas, totalCents, jaCompensado }`
  - `interface CandidataDeCompensacao { purchaseKey, description, purchaseDate, installmentTotal, parcelasConhecidas, totalCents, elegivel, motivo, preSelecionada }`
  - `type MotivoInelegivel = "valor-diferente" | "ja-compensado"`
  - `function candidatasDeCompensacao(credito: CreditoACompensar, grupos: GrupoDeCompra[]): CandidataDeCompensacao[]`

Por que a lista devolve também as inelegíveis: uma lista vazia não explica nada.
Mostrando as compras parceladas da conta com o motivo ao lado, a pessoa lê
"R$ 271,00 — valor diferente" e entende por que a dela não está selecionável.

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/src/lib/compensacao.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { candidatasDeCompensacao } from "./compensacao";

const credito = {
  id: "tx-estorno",
  accountId: "cartao-1",
  amountCents: 27200,
  compensationId: null,
};

const grupo = {
  purchaseKey: "chave-a",
  accountId: "cartao-1",
  description: "MERCADOLIVRE*MERCADOLIVRE",
  purchaseDate: "2026-08-17T15:37:11.000Z",
  installmentTotal: 8,
  parcelasConhecidas: 8,
  totalCents: 27200,
  jaCompensado: false,
};

describe("candidatasDeCompensacao", () => {
  it("o grupo que bate no valor e elegivel e ja vem selecionado", () => {
    expect(candidatasDeCompensacao(credito, [grupo])).toEqual([
      {
        purchaseKey: "chave-a",
        description: "MERCADOLIVRE*MERCADOLIVRE",
        purchaseDate: "2026-08-17T15:37:11.000Z",
        installmentTotal: 8,
        parcelasConhecidas: 8,
        totalCents: 27200,
        elegivel: true,
        motivo: null,
        preSelecionada: true,
      },
    ]);
  });

  it("um centavo de diferenca nao e elegivel", () => {
    // Compensar por aproximacao tiraria do relatorio uma despesa que so parece
    // com o estorno. O erro e silencioso, entao a regra e exata.
    const porUmCentavo = { ...grupo, totalCents: 27199 };
    const [c] = candidatasDeCompensacao(credito, [porUmCentavo]);
    expect(c.elegivel).toBe(false);
    expect(c.motivo).toBe("valor-diferente");
    expect(c.preSelecionada).toBe(false);
  });

  it("grupo ja compensado aparece, mas nao e escolhivel", () => {
    const usado = { ...grupo, jaCompensado: true };
    const [c] = candidatasDeCompensacao(credito, [usado]);
    expect(c.elegivel).toBe(false);
    expect(c.motivo).toBe("ja-compensado");
  });

  it("grupo de outra conta nem aparece na lista", () => {
    // Estorno cai no cartao em que a compra foi feita. Listar compras de outra
    // conta so oferece jeitos de errar.
    const deOutroCartao = { ...grupo, accountId: "cartao-2" };
    expect(candidatasDeCompensacao(credito, [deOutroCartao])).toEqual([]);
  });

  it("dois grupos de mesmo valor nao pre-selecionam nenhum", () => {
    // Empate significa que a informacao disponivel nao decide — mesma regra do
    // pareamento de transferencia. Escolher uma seria adivinhar.
    const gemeo = { ...grupo, purchaseKey: "chave-b" };
    const candidatas = candidatasDeCompensacao(credito, [grupo, gemeo]);
    expect(candidatas).toHaveLength(2);
    expect(candidatas.every((c) => c.elegivel)).toBe(true);
    expect(candidatas.some((c) => c.preSelecionada)).toBe(false);
  });

  it("credito ja compensado nao tem candidata nenhuma", () => {
    const usado = { ...credito, compensationId: "par-1" };
    expect(candidatasDeCompensacao(usado, [grupo])).toEqual([]);
  });

  it("ordena por data da compra, da mais recente para a mais antiga", () => {
    // O estorno costuma ser de uma compra recente.
    const antiga = {
      ...grupo,
      purchaseKey: "chave-b",
      purchaseDate: "2026-06-02T00:00:00.000Z",
    };
    const ordem = candidatasDeCompensacao(credito, [antiga, grupo]).map((c) => c.purchaseKey);
    expect(ordem).toEqual(["chave-a", "chave-b"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- src/lib/compensacao.test.ts`
Expected: FAIL — `Failed to resolve import "./compensacao"`.

- [ ] **Step 3: Escrever a implementação mínima**

Crie `apps/api/src/lib/compensacao.ts`:

```ts
/**
 * Quais compras parceladas um estorno pode cancelar.
 *
 * A Pluggy nao liga uma ponta a outra: o estorno chega como um credito solto,
 * de descricao generica — num marketplace, a mesma string de qualquer outra
 * compra. O que resta e o valor, e por isso ele e exato: compensar por
 * aproximacao tiraria do relatorio uma despesa real, em silencio.
 *
 * A escolha final e sempre da pessoa. Esta funcao so separa o que pode do que
 * nao pode, e diz por que — uma lista vazia nao ensina nada a quem esta
 * tentando entender por que a compra dele nao aparece.
 */

export type MotivoInelegivel = "valor-diferente" | "ja-compensado";

/** A ponta credito: a linha INCOME que o banco lancou ao devolver o dinheiro. */
export interface CreditoACompensar {
  id: string;
  accountId: string;
  /** Centavos inteiros. O sinal mora no `type`, entao aqui e sempre positivo. */
  amountCents: number;
  compensationId: string | null;
}

/** Uma compra parcelada da conta, ja reunida pelo `purchaseKey`. */
export interface GrupoDeCompra {
  purchaseKey: string;
  accountId: string;
  description: string;
  /** ISO, ou null quando o conector nao informou a data da compra. */
  purchaseDate: string | null;
  installmentTotal: number;
  /** Quantas parcelas o app de fato importou — pode ser menos que o total. */
  parcelasConhecidas: number;
  totalCents: number;
  jaCompensado: boolean;
}

export interface CandidataDeCompensacao {
  purchaseKey: string;
  description: string;
  purchaseDate: string | null;
  installmentTotal: number;
  parcelasConhecidas: number;
  totalCents: number;
  elegivel: boolean;
  motivo: MotivoInelegivel | null;
  /** Ligada so quando **uma** candidata e elegivel. Empate nao decide. */
  preSelecionada: boolean;
}

export function candidatasDeCompensacao(
  credito: CreditoACompensar,
  grupos: GrupoDeCompra[]
): CandidataDeCompensacao[] {
  // Um credito ja compensado nao escolhe de novo: desfazer vem primeiro.
  if (credito.compensationId !== null) return [];

  const daConta = grupos.filter((g) => g.accountId === credito.accountId);

  const avaliadas = daConta.map((g) => {
    const motivo: MotivoInelegivel | null = g.jaCompensado
      ? "ja-compensado"
      : g.totalCents !== credito.amountCents
        ? "valor-diferente"
        : null;

    return {
      purchaseKey: g.purchaseKey,
      description: g.description,
      purchaseDate: g.purchaseDate,
      installmentTotal: g.installmentTotal,
      parcelasConhecidas: g.parcelasConhecidas,
      totalCents: g.totalCents,
      elegivel: motivo === null,
      motivo,
      preSelecionada: false,
    };
  });

  // Estorno costuma ser de compra recente. Sem data, vai para o fim.
  avaliadas.sort((a, b) => {
    const ta = a.purchaseDate ? Date.parse(a.purchaseDate) : -Infinity;
    const tb = b.purchaseDate ? Date.parse(b.purchaseDate) : -Infinity;
    return tb - ta;
  });

  const elegiveis = avaliadas.filter((c) => c.elegivel);
  if (elegiveis.length === 1) {
    elegiveis[0].preSelecionada = true;
  }

  return avaliadas;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- src/lib/compensacao.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/compensacao.ts apps/api/src/lib/compensacao.test.ts
git commit -m "feat(api): a decisao de quais compras um estorno pode cancelar"
```

---

### Task 3: O serviço e as rotas

**Files:**
- Create: `apps/api/src/modules/transactions/compensacao.service.ts`
- Create: `apps/api/src/modules/transactions/compensacao.test.ts`
- Modify: `apps/api/src/modules/transactions/transactions.routes.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `candidatasDeCompensacao` e os tipos da Task 2;
  `formatTransactionDTO` de `transactions.service.ts`; `TransactionNotFoundError`
  e `UnprocessableError` de `lib/errors`.
- Produces:
  - `listarCandidatas(userId, transactionId): Promise<CompensationCandidatesResponse>`
  - `compensar(userId, transactionId, purchaseKey): Promise<{ compensationId: string; afetadas: number }>`
  - `desfazerCompensacao(userId, transactionId): Promise<{ afetadas: number }>`

Arquivo próprio e não dentro de `transactions.service.ts`: aquele já tem 386
linhas e três responsabilidades. Compensação é um assunto fechado, com testes
próprios.

- [ ] **Step 1: Adicionar os tipos compartilhados**

Em `packages/shared/src/index.ts`, depois de `InstallmentsResponse`:

```ts
export type CompensationIneligibleReason = "valor-diferente" | "ja-compensado";

export interface CompensationCandidateDTO {
  purchaseKey: string;
  description: string;
  /** ISO da data da compra, ou null quando o conector nao informou. */
  purchaseDate: string | null;
  installmentTotal: number;
  /** Quantas parcelas o app importou. Menor que o total significa historico cortado. */
  parcelasConhecidas: number;
  /** Total da compra, em reais. */
  total: number;
  elegivel: boolean;
  motivo: CompensationIneligibleReason | null;
  preSelecionada: boolean;
}

export interface CompensationCandidatesResponse {
  candidates: CompensationCandidateDTO[];
}

export interface CompensateRequest {
  purchaseKey: string;
}
```

- [ ] **Step 2: Escrever os testes que falham**

Crie `apps/api/src/modules/transactions/compensacao.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * O que vale travar aqui e a decisao, nao o Postgres: quem pode compensar o
 * que, e o que exatamente e escrito quando pode. O banco fica mockado — e o
 * mesmo criterio de `reopen.test.ts`.
 */
const findFirst = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();
const transacao = vi.fn(async (ops: unknown[]) => ops);

vi.mock("../../prisma", () => ({
  prisma: {
    transaction: { findFirst, findMany, updateMany },
    $transaction: (ops: unknown[]) => transacao(ops),
  },
}));

const { compensar, desfazerCompensacao } = await import("./compensacao.service");

const credito = {
  id: "tx-estorno",
  userId: "user-1",
  accountId: "cartao-1",
  type: "INCOME",
  amount: { toString: () => "272" },
  compensationId: null,
};

const parcela = (i: number) => ({
  id: `p${i}`,
  accountId: "cartao-1",
  type: "EXPENSE",
  amount: { toString: () => "34" },
  installmentTotal: 8,
  compensationId: null,
});

const oitoParcelas = [1, 2, 3, 4, 5, 6, 7, 8].map(parcela);

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  updateMany.mockReset();
  transacao.mockClear();
});

describe("compensar", () => {
  it("grava o mesmo vinculo no credito e em todas as parcelas", async () => {
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue(oitoParcelas);
    updateMany.mockResolvedValue({ count: 9 });

    const resultado = await compensar("user-1", "tx-estorno", "chave-a");

    expect(resultado.afetadas).toBe(9);
    expect(updateMany).toHaveBeenCalledTimes(1);

    const args = updateMany.mock.calls[0][0];
    // As nove pontas de uma vez, e nao nove escritas: um erro no meio deixaria
    // metade da compra compensada, que e pior que nenhuma.
    expect(args.where.id.in).toHaveLength(9);
    expect(args.where.id.in).toContain("tx-estorno");
    expect(args.where.userId).toBe("user-1");
    expect(typeof args.data.compensationId).toBe("string");
  });

  it("recusa quando a soma das parcelas nao bate com o credito", async () => {
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue(oitoParcelas.slice(0, 7));

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(
      /valor/i
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa compra a vista, mesmo com o valor certo", async () => {
    // So parcelamento espalha a despesa por meses que o credito nao alcanca.
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue([
      { ...parcela(1), amount: { toString: () => "272" }, installmentTotal: null },
    ]);

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(
      /parcel/i
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa um credito que ja esta compensado", async () => {
    findFirst.mockResolvedValue({ ...credito, compensationId: "par-antigo" });

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(
      /compensad/i
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa quando a ponta escolhida e uma despesa", async () => {
    findFirst.mockResolvedValue({ ...credito, type: "EXPENSE" });

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("recusa grupo de outra conta", async () => {
    findFirst.mockResolvedValue(credito);
    findMany.mockResolvedValue(oitoParcelas.map((p) => ({ ...p, accountId: "cartao-2" })));

    await expect(compensar("user-1", "tx-estorno", "chave-a")).rejects.toThrow(
      /conta/i
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("transacao de outro usuario nao existe", async () => {
    // O par (id, userId) e o que prova posse. Nao achou = 404, e nao 403: nao
    // se confirma a existencia de linha alheia.
    findFirst.mockResolvedValue(null);

    await expect(compensar("user-1", "tx-de-outro", "chave-a")).rejects.toThrow();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("desfazerCompensacao", () => {
  it("limpa o grupo inteiro a partir de qualquer ponta", async () => {
    findFirst.mockResolvedValue({ ...credito, compensationId: "par-1" });
    updateMany.mockResolvedValue({ count: 9 });

    const resultado = await desfazerCompensacao("user-1", "p3");

    expect(resultado.afetadas).toBe(9);
    const args = updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "user-1", compensationId: "par-1" });
    expect(args.data).toEqual({ compensationId: null });
  });

  it("desfazer o que nao esta compensado nao escreve nada", async () => {
    findFirst.mockResolvedValue({ ...credito, compensationId: null });

    const resultado = await desfazerCompensacao("user-1", "tx-estorno");

    expect(resultado.afetadas).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test --workspace=apps/api -- src/modules/transactions/compensacao.test.ts`
Expected: FAIL — `Failed to resolve import "./compensacao.service"`.

- [ ] **Step 4: Escrever o serviço**

Crie `apps/api/src/modules/transactions/compensacao.service.ts`:

```ts
import { randomUUID } from "crypto";
import type {
  CompensationCandidateDTO,
  CompensationCandidatesResponse,
} from "@poup/shared";
import { prisma } from "../../prisma";
import {
  candidatasDeCompensacao,
  type GrupoDeCompra,
} from "../../lib/compensacao";
import { TransactionNotFoundError, UnprocessableError } from "../../lib/errors";

/**
 * Compensar um estorno: dizer que aquele credito cancela aquela compra
 * parcelada, e que nenhuma das duas pontas conta em lugar nenhum.
 *
 * E manual de proposito. Este seria o terceiro caminho do sistema a gravar sem
 * perguntar, e o mais caro de errar: uma despesa real sumiria do relatorio em
 * silencio, e a pessoa descobriria meses depois. O toque a mais custa pouco.
 */

/** Centavos inteiros a partir de um `Decimal` do Prisma. */
function centavos(valor: { toString(): string }): number {
  return Math.round(Number(valor.toString()) * 100);
}

/** A ponta credito, conferida. O par (id, userId) e o que prova posse. */
async function creditoDoUsuario(userId: string, transactionId: string) {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: {
      id: true,
      accountId: true,
      type: true,
      amount: true,
      compensationId: true,
    },
  });

  if (!tx) throw new TransactionNotFoundError();

  if (tx.type !== "INCOME") {
    throw new UnprocessableError(
      "Só um crédito pode compensar uma compra. Esta transação é uma despesa."
    );
  }

  if (tx.compensationId !== null) {
    throw new UnprocessableError(
      "Este crédito já está compensado. Desfaça a compensação atual antes de criar outra."
    );
  }

  return tx;
}

/** As compras parceladas da conta, reunidas por `purchaseKey`. */
async function gruposDaConta(userId: string, accountId: string): Promise<GrupoDeCompra[]> {
  const linhas = await prisma.transaction.findMany({
    where: {
      userId,
      accountId,
      type: "EXPENSE",
      purchaseKey: { not: null },
      installmentTotal: { not: null },
    },
    select: {
      purchaseKey: true,
      accountId: true,
      description: true,
      purchaseDate: true,
      installmentTotal: true,
      amount: true,
      compensationId: true,
    },
  });

  const porChave = new Map<string, GrupoDeCompra>();

  for (const linha of linhas) {
    const chave = linha.purchaseKey!;
    const atual = porChave.get(chave);

    if (!atual) {
      porChave.set(chave, {
        purchaseKey: chave,
        accountId: linha.accountId,
        description: linha.description,
        purchaseDate: linha.purchaseDate?.toISOString() ?? null,
        installmentTotal: linha.installmentTotal!,
        parcelasConhecidas: 1,
        totalCents: centavos(linha.amount),
        jaCompensado: linha.compensationId !== null,
      });
      continue;
    }

    atual.parcelasConhecidas += 1;
    atual.totalCents += centavos(linha.amount);
    // Uma parcela compensada compromete o grupo inteiro: nao da para compensar
    // metade de uma compra.
    atual.jaCompensado = atual.jaCompensado || linha.compensationId !== null;
  }

  return [...porChave.values()];
}

export async function listarCandidatas(
  userId: string,
  transactionId: string
): Promise<CompensationCandidatesResponse> {
  const credito = await creditoDoUsuario(userId, transactionId);
  const grupos = await gruposDaConta(userId, credito.accountId);

  const candidatas = candidatasDeCompensacao(
    {
      id: credito.id,
      accountId: credito.accountId,
      amountCents: centavos(credito.amount),
      compensationId: credito.compensationId,
    },
    grupos
  );

  const candidates: CompensationCandidateDTO[] = candidatas.map((c) => ({
    purchaseKey: c.purchaseKey,
    description: c.description,
    purchaseDate: c.purchaseDate,
    installmentTotal: c.installmentTotal,
    parcelasConhecidas: c.parcelasConhecidas,
    total: c.totalCents / 100,
    elegivel: c.elegivel,
    motivo: c.motivo,
    preSelecionada: c.preSelecionada,
  }));

  return { candidates };
}

export async function compensar(
  userId: string,
  transactionId: string,
  purchaseKey: string
): Promise<{ compensationId: string; afetadas: number }> {
  const credito = await creditoDoUsuario(userId, transactionId);

  const parcelas = await prisma.transaction.findMany({
    where: { userId, purchaseKey },
    select: {
      id: true,
      accountId: true,
      type: true,
      amount: true,
      installmentTotal: true,
      compensationId: true,
    },
  });

  if (parcelas.length === 0) {
    throw new UnprocessableError("Compra não encontrada.");
  }

  if (parcelas.some((p) => p.accountId !== credito.accountId)) {
    throw new UnprocessableError(
      "O estorno e a compra precisam estar na mesma conta."
    );
  }

  if (parcelas.some((p) => p.type !== "EXPENSE" || p.installmentTotal === null)) {
    throw new UnprocessableError(
      "Só compras parceladas podem ser compensadas. Uma compra à vista estornada já se resolve no mês."
    );
  }

  if (parcelas.some((p) => p.compensationId !== null)) {
    throw new UnprocessableError("Esta compra já está compensada.");
  }

  const totalCents = parcelas.reduce((soma, p) => soma + centavos(p.amount), 0);
  if (totalCents !== centavos(credito.amount)) {
    throw new UnprocessableError(
      "O valor do estorno precisa bater exatamente com o total da compra."
    );
  }

  const compensationId = randomUUID();
  const ids = [credito.id, ...parcelas.map((p) => p.id)];

  // Uma escrita so, e nao uma por linha: um erro no meio deixaria metade da
  // compra compensada — pior que nao ter compensado nada.
  const { count } = await prisma.transaction.updateMany({
    where: { userId, id: { in: ids } },
    data: { compensationId },
  });

  return { compensationId, afetadas: count };
}

export async function desfazerCompensacao(
  userId: string,
  transactionId: string
): Promise<{ afetadas: number }> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { compensationId: true },
  });

  if (!tx) throw new TransactionNotFoundError();

  // Desfazer o que nao esta feito e sucesso, nao erro: a tela pode chegar aqui
  // com um estado velho, e um 422 nao ajudaria em nada.
  if (tx.compensationId === null) return { afetadas: 0 };

  const { count } = await prisma.transaction.updateMany({
    where: { userId, compensationId: tx.compensationId },
    data: { compensationId: null },
  });

  return { afetadas: count };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- src/modules/transactions/compensacao.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 6: Ligar as rotas**

Em `apps/api/src/modules/transactions/transactions.routes.ts`, adicione ao
import de zod já existente e importe o serviço:

```ts
import {
  compensar,
  desfazerCompensacao,
  listarCandidatas,
} from "./compensacao.service";
```

Junto dos outros schemas:

```ts
const compensateSchema = z.object({
  purchaseKey: z.string().min(1, "Compra é obrigatória"),
});
```

E as três rotas **antes** de `transactionsRouter.get("/:id", ...)`, pelo mesmo
motivo já documentado em `/:id/installments`: sem isso o Express casaria
`"abc/compensation"` como um id.

```ts
transactionsRouter.get(
  "/:id/compensation/candidates",
  asyncHandler(async (req, res) => {
    res.json(await listarCandidatas(req.userId!, req.params.id));
  })
);

transactionsRouter.post(
  "/:id/compensation",
  asyncHandler(async (req, res) => {
    const { purchaseKey } = compensateSchema.parse(req.body);
    const result = await compensar(req.userId!, req.params.id, purchaseKey);
    res.json(result);
  })
);

transactionsRouter.delete(
  "/:id/compensation",
  asyncHandler(async (req, res) => {
    res.json(await desfazerCompensacao(req.userId!, req.params.id));
  })
);
```

Atenção: já existe `transactionsRouter.delete("/:id", ...)` que lança
`ForbiddenError` sempre. A rota de compensação precisa vir **antes** dela.

- [ ] **Step 7: Verificar**

```bash
npm run build:shared && npx tsc -p apps/api/tsconfig.json --noEmit && npm test --workspace=apps/api
```
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/transactions packages/shared/src/index.ts
git commit -m "feat(api): compensar e desfazer o estorno de uma compra parcelada"
```

---

### Task 4: As cinco exclusões de agregação

**Files:**
- Modify: `apps/api/src/modules/reports/reports.service.ts:107`, `:139`, `:242`
- Modify: `apps/api/src/modules/budgets/budgets.service.ts:38` e `:126`
- Create: `apps/api/src/modules/reports/exclusao.test.ts`
- Create: `apps/api/src/modules/budgets/exclusao.test.ts`

**Interfaces:**
- Consumes: a coluna `compensationId` da Task 1.
- Produces: nenhuma assinatura nova — as cinco consultas passam a ignorar linha
  compensada.

Este é o risco central do plano, e o único que falha em silêncio. São **cinco**,
não quatro: a revisão deste plano encontrou `listBudgets` depois que o spec já
dizia "quatro e nenhuma a mais". Ela é a mais fácil de perder porque não usa
`aggregate` nem `groupBy` — faz `findMany` e soma em JavaScript, então procurar
por função de agregação não a acha.

**Duas consultas que NÃO podem mudar:** `transactions.service.ts:184` (a
listagem) e `transactions.service.ts:371` (o dropdown de parcelas). Linha
compensada continua visível — é por ela que se desfaz a compensação. Filtrar ali
esconderia a compensação de quem quer revertê-la.

- [ ] **Step 1: Escrever o teste dos relatórios**

Crie `apps/api/src/modules/reports/exclusao.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * As tres consultas que somam dinheiro no relatorio precisam ignorar linha
 * compensada. Errar aqui nao levanta erro nenhum: o numero so fica errado, e
 * ninguem percebe. Por isso o teste olha o `where` que cada consulta monta, em
 * vez de confiar em revisao.
 */
const groupBy = vi.fn();
const count = vi.fn();
const categoryFindFirst = vi.fn();
const categoryFindMany = vi.fn();
const queryRaw = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    transaction: { groupBy, count },
    category: { findFirst: categoryFindFirst, findMany: categoryFindMany },
    $queryRaw: (...args: unknown[]) => queryRaw(...args),
  },
}));

const { getReportSummary } = await import("./reports.service");

beforeEach(() => {
  groupBy.mockReset().mockResolvedValue([]);
  count.mockReset().mockResolvedValue(0);
  // Sempre acha as categorias de sistema, para nao entrar no caminho que cria.
  categoryFindFirst.mockReset().mockResolvedValue({ id: "cat-sistema" });
  categoryFindMany.mockReset().mockResolvedValue([]);
  queryRaw.mockReset().mockResolvedValue([]);
});

describe("relatorio ignora linha compensada", () => {
  it("nas duas consultas agrupadas", async () => {
    await getReportSummary("user-1", { month: "2026-09" });

    expect(groupBy).toHaveBeenCalledTimes(2);
    for (const chamada of groupBy.mock.calls) {
      expect(chamada[0].where).toMatchObject({ compensationId: null });
    }
  });

  it("na serie mensal, que e SQL cru", async () => {
    await getReportSummary("user-1", { month: "2026-09" });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    // O primeiro argumento de uma template tag e o array de pedacos do SQL.
    const pedacos = queryRaw.mock.calls[0][0] as string[];
    expect([...pedacos].join(" ")).toContain('"compensationId" IS NULL');
  });
});
```

- [ ] **Step 2: Escrever o teste dos orçamentos**

Crie `apps/api/src/modules/budgets/exclusao.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * As duas consultas de orcamento. `listBudgets` e a que alimenta a tela e nao
 * usa funcao de agregacao — soma em JavaScript depois de um `findMany` —, e foi
 * por isso que ela quase escapou da revisao deste plano.
 */
const findMany = vi.fn();
const aggregate = vi.fn();
const budgetFindMany = vi.fn();
const budgetUpsert = vi.fn();
const categoryFindFirst = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    transaction: { findMany, aggregate },
    budget: { findMany: budgetFindMany, upsert: budgetUpsert },
    category: { findFirst: categoryFindFirst },
  },
}));

const { listBudgets, upsertBudget } = await import("./budgets.service");

const categoria = { id: "cat-1", name: "Outros", icon: "tag", colorKey: "blue" };

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
  aggregate.mockReset().mockResolvedValue({ _sum: { amount: 0 } });
  budgetFindMany.mockReset().mockResolvedValue([]);
  budgetUpsert.mockReset().mockResolvedValue({
    id: "orc-1",
    categoryId: "cat-1",
    monthlyLimit: 500,
    category: categoria,
  });
  categoryFindFirst.mockReset().mockResolvedValue({ ...categoria, systemKey: null });
});

describe("orcamento ignora linha compensada", () => {
  it("ao listar os orcamentos da tela", async () => {
    await listBudgets("user-1", "2026-09");

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ compensationId: null });
  });

  it("ao salvar um orcamento", async () => {
    await upsertBudget("user-1", "cat-1", 500);

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate.mock.calls[0][0].where).toMatchObject({ compensationId: null });
  });
});
```

- [ ] **Step 3: Rodar os dois e ver falhar**

Run: `npm test --workspace=apps/api -- src/modules/reports/exclusao.test.ts src/modules/budgets/exclusao.test.ts`
Expected: FAIL nos quatro testes — os `where` ainda não têm `compensationId`, e
o SQL ainda não tem a cláusula.

Se algum falhar por erro de mock em vez de asserção (por exemplo, uma consulta
que este plano não previu), pare e reporte: significa que o mapa das cinco está
errado.

- [ ] **Step 4: `totalsByType`**

Em `apps/api/src/modules/reports/reports.service.ts`, no `where` de
`totalsByType` (linha 109):

```ts
    where: {
      userId,
      NOT: { categoryId: transferId },
      // Compra compensada por um estorno nao foi gasta, e o credito que a
      // cancelou nao foi ganho: as duas pontas saem dos totais.
      compensationId: null,
      ...dateFilter(period),
    },
```

- [ ] **Step 5: `expensesByCategory`**

No `where` de `expensesByCategory` (linha 141):

```ts
    where: {
      userId,
      type: "EXPENSE",
      NOT: { categoryId: transferId },
      compensationId: null,
      ...dateFilter(period),
    },
```

- [ ] **Step 6: `monthlySeries`**

No SQL cru (linha 246), logo depois da cláusula do `transferId`:

```sql
      AND "categoryId" IS DISTINCT FROM ${transferId}
      AND "compensationId" IS NULL
```

- [ ] **Step 7: `listBudgets`**

Em `apps/api/src/modules/budgets/budgets.service.ts`, no `where` do `findMany`
da linha 38:

```ts
    where: {
      userId,
      type: "EXPENSE",
      categoryId: { in: categoryIds },
      // Compra compensada nao consome orcamento. Aqui a exclusao precisa ser
      // explicita: diferente de transferencia, que fica de fora porque
      // categoria de sistema nunca tem orcamento, a compra compensada mantem a
      // categoria original.
      compensationId: null,
      competenceDate: {
        gte: startOfMonth,
        lt: startOfNextMonth,
      },
    },
```

- [ ] **Step 8: `upsertBudget`**

No `where` do `aggregate` da linha 126:

```ts
    where: {
      userId,
      categoryId,
      type: "EXPENSE",
      compensationId: null,
      competenceDate: { gte: startOfMonth, lt: startOfNextMonth },
    },
```

- [ ] **Step 9: Rodar e ver passar**

Run: `npm test --workspace=apps/api -- src/modules/reports/exclusao.test.ts src/modules/budgets/exclusao.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 10: Conferir que não sobrou nenhuma**

```bash
grep -rn "prisma.transaction.findMany\|prisma.transaction.groupBy\|prisma.transaction.aggregate" apps/api/src --include=*.ts | grep -v dist
```

O grep pega `findMany` de propósito — foi um `findMany` que quase escapou.
Esperam-se catorze ocorrências, mais o `FROM "Transaction"` do SQL cru. Cinco
levam `compensationId: null` (as desta task); duas **não podem** levar
(`transactions.service.ts:184` e `:371`); as demais não somam dinheiro
(pareamento de fatura, pipeline de categorização, busca de parecidas, o
`findFirst` do sync, os órfãos de transferência).

Se aparecer uma que este plano não previu, pare e reporte antes de seguir:
decidir se ela soma dinheiro é do autor do plano, não de quem executa.

- [ ] **Step 11: Verificar tudo**

```bash
npx tsc -p apps/api/tsconfig.json --noEmit && npm test --workspace=apps/api
```
Expected: verde.

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/modules/reports apps/api/src/modules/budgets
git commit -m "feat(api): linha compensada sai dos relatorios e dos orcamentos"
```

---

### Task 5: Web — o cliente, o modal e o selo

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/components/transactions/CompensationModal.tsx`
- Modify: `apps/web/src/components/transactions/TransactionDetailModal.tsx`
- Modify: `apps/web/src/pages/TransactionsPage.tsx:682` e `:769`

**Interfaces:**
- Consumes: as três rotas da Task 3 e os tipos da `packages/shared`.
- Produces: `fetchCompensationCandidates`, `compensateTransaction`,
  `undoCompensation` em `api.ts`; componente `<CompensationModal>`.

- [ ] **Step 1: As três chamadas no cliente**

Em `apps/web/src/lib/api.ts`, adicione ao bloco de import de `@poup/shared`:

```ts
  CompensationCandidatesResponse,
```

E, depois de `fetchInstallments`:

```ts
/**
 * As compras parceladas que este crédito pode cancelar. Traz também as
 * inelegíveis, com o motivo: uma lista vazia não explica por que a compra que a
 * pessoa procura não está lá.
 */
export async function fetchCompensationCandidates(
  transactionId: string
): Promise<CompensationCandidatesResponse> {
  return request<CompensationCandidatesResponse>(
    `/transactions/${transactionId}/compensation/candidates`
  );
}

export async function compensateTransaction(
  transactionId: string,
  purchaseKey: string
): Promise<{ compensationId: string; afetadas: number }> {
  return request(`/transactions/${transactionId}/compensation`, {
    method: "POST",
    body: JSON.stringify({ purchaseKey }),
  });
}

export async function undoCompensation(
  transactionId: string
): Promise<{ afetadas: number }> {
  return request(`/transactions/${transactionId}/compensation`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 2: O modal**

Crie `apps/web/src/components/transactions/CompensationModal.tsx`. Siga o
padrão de `SimilarTransactionsModal.tsx` (leia-o antes: props `isOpen`,
`onClose`, `onDone`, uso de `Modal`, `Button`, `useToast`).

Requisitos de comportamento:

- Ao abrir, chama `fetchCompensationCandidates(transaction.id)`.
- Estado de carregando, de erro e de lista vazia. A vazia diz: *"Nenhuma compra
  parcelada nesta conta. A compensação só vale para parcelamentos — uma compra à
  vista estornada já se acerta sozinha no mês."*
- Cada candidata é uma linha selecionável com descrição, `{installmentTotal}x`,
  data da compra e total. A que vier com `preSelecionada` já nasce marcada.
- Candidata com `elegivel: false` aparece esmaecida e não clicável, com o motivo
  ao lado: `"valor-diferente"` → *"valor diferente do estorno"*;
  `"ja-compensado"` → *"já compensada"*.
- Quando `parcelasConhecidas < installmentTotal`, mostre
  *"{parcelasConhecidas} de {installmentTotal} parcelas importadas"* — é o que
  explica um total que não bate.
- Confirmar chama `compensateTransaction`, dá `toast` de sucesso, chama
  `onDone()` (que recarrega a lista) e fecha.
- Erro da API aparece no toast com a mensagem que o servidor mandou.

- [ ] **Step 3: A ação no modal de detalhe**

Em `TransactionDetailModal.tsx`:

- Novo estado: `const [isCompensationOpen, setIsCompensationOpen] = useState(false);`
- Dentro do form, abaixo do bloco de categoria, um botão que só aparece quando
  `transaction.type === "INCOME" && !transaction.compensationId`, com o rótulo
  **"Compensar compra parcelada"** e um subtítulo curto: *"Ligue este crédito às
  parcelas da compra estornada."*
- Quando `transaction.compensationId` não for nulo, no lugar do botão vai uma
  faixa dizendo *"Compensado — fora dos totais"* com uma ação **"Desfazer"** que
  chama `undoCompensation(transaction.id)`, dá toast e recarrega.
- Renderize `<CompensationModal>` junto dos outros modais filhos, no fim do JSX,
  ao lado de `<SimilarTransactionsModal>` e `<CategorySelectModal>`.

- [ ] **Step 4: O selo na lista**

Em `apps/web/src/pages/TransactionsPage.tsx`, nas duas linhas onde
`<InstallmentGroup>` é renderizado (682 e 769), acrescente ao lado um selo
quando a linha estiver compensada.

A sutileza que vem de `lib/agruparCompras.ts`: quando mais de uma parcela passa
pelos filtros, a lista já as reúne numa linha só. Então leia o estado da linha,
e não de uma transação solta:

```tsx
{(parcelas ? parcelas.every((p) => p.compensationId) : !!tx.compensationId) && (
  <span
    title="Compensada por um estorno — fora dos totais"
    className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-chip bg-surface-sunken border border-border text-text-disabled"
  >
    compensado
  </span>
)}
```

`every` e não `some`: um grupo em que só parte das parcelas está compensada não
existe — o serviço recusa —, mas se existisse, o selo estaria mentindo.

- [ ] **Step 5: Verificar no navegador**

Suba a aplicação e confira, na conta de cartão, o crédito de R$ 272 de 21/08:
abrir o detalhe, ver a ação, abrir o modal, confirmar que a compra de 8×34 vem
pré-selecionada, compensar, ver o selo aparecer nas nove linhas e o total do mês
mudar. Depois desfazer e ver tudo voltar.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): compensar um estorno pela tela de transacoes"
```

---

### Task 6: Verificação de ponta a ponta

**Files:**
- Modify: `docs/PLAN.md` (registrar a feature na lista de entregas)

- [ ] **Step 1: Suíte e typecheck completos**

```bash
npm run build:shared && npm run build && npm test --workspace=apps/api
```
Expected: build dos três pacotes e suíte inteira verdes.

- [ ] **Step 2: Conferir os números no relatório**

Com a compra compensada, abra Relatórios no mês de setembro/2026 e confirme que
a receita de R$ 272 não está mais lá; depois out/2026 e confirme que os R$ 34
sumiram. Desfaça e confirme que voltam.

- [ ] **Step 3: Conferir o orçamento**

Crie um orçamento na categoria da compra compensada e confirme, **na tela de
Orçamentos**, que o gasto dela não é contado. É a consulta que quase escapou
deste plano e a que falha em silêncio.

- [ ] **Step 4: Conferir que o sync não desfaz**

Rode uma sincronização da conexão e confirme que o selo continua nas nove
linhas. Este é o requisito que motivou o campo próprio.

- [ ] **Step 5: Registrar em `docs/PLAN.md`**

Uma linha na lista de entregas, no formato das vizinhas.

- [ ] **Step 6: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs: registra a compensacao de estorno"
```

---

## Notas para quem executar

**O caso real que originou tudo** está na conta `rlzampar@gmail.com`: compra
`MERCADOLIVRE*MERCADOLIVRE` de 17/08/2026, 8 × R$ 34,00, e o crédito de
R$ 272,00 de 21/08/2026, ambos no cartão VISA Mercado Pago. É o cenário de teste
manual das Tasks 5 e 6.

**O que este plano deliberadamente não faz**, e está registrado no backlog do
spec: estorno parcial, saldo credor de cartão, sync que remove transação que
sumiu da Pluggy, e sugerir a compensação pela fila de revisão.

**Se uma consulta a mais aparecer** no `grep` da Task 4, pare. O plano mapeou as
que existem hoje: cinco recebem a exclusão e duas explicitamente não podem
recebê-la. Uma a mais significa que o mapa envelheceu, e decidir o que fazer com
ela é do autor do plano, não de quem executa.
