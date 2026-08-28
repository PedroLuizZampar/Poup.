import { prisma } from "../../prisma";
import {
  TransactionType as PrismaTransactionType,
  Prisma,
  SystemCategoryKey,
} from "@prisma/client";
import type {
  InstallmentDTO,
  InstallmentsResponse,
  TransactionDTO,
  TransactionType,
} from "@poup/shared";
import {
  AccountNotFoundError,
  CategoryNotFoundError,
  TransactionNotFoundError,
} from "../../lib/errors";
import { ensureSystemCategories } from "../../lib/systemCategories";
import { ownerIds, type Scope } from "../../lib/scope";
import { vencimentoDaFatura } from "../../lib/pluggyMapping";
import { statusDaParcela } from "../../lib/statusDaParcela";
import { buscarEmLotes } from "../../lib/lotes";
import { reopenPendingSuggestion } from "../categorization/categorization.service";
import { resolveAccountName } from "../accounts/accounts.service";

export { AccountNotFoundError, CategoryNotFoundError, TransactionNotFoundError };

export interface TransactionFilters {
  month?: string; // YYYY-MM
  startDate?: string;
  endDate?: string;
  accountId?: string;
  categoryId?: string;
  uncategorized?: boolean;
  type?: TransactionType;
  search?: string;
  /** Piso e teto do valor da transação, em reais. */
  minAmount?: number;
  maxAmount?: number;
  /** Teto de resultados, para quem só mostra as últimas (o painel usa 5). */
  limit?: number;
  /**
   * O seletor "Todos / Fulano / Beltrano" da tela. Ausente é todo o espaço —
   * quem valida se o id pertence ao espaço é o `ownerIds`, nunca este arquivo.
   */
  owner?: string;
}

export interface CreateTransactionInput {
  accountId: string;
  description: string;
  amount: number;
  type: TransactionType;
  date: string;
  categoryId?: string | null;
  note?: string | null;
  isRecurring?: boolean;
}

export interface UpdateTransactionInput {
  description?: string;
  categoryId?: string | null;
  note?: string | null;
  isRecurring?: boolean;
}

/**
 * O `include` de toda leitura de transacao. Existe como constante porque o
 * `creditCardDueDay` precisa vir junto em **todas** elas: sem ele o DTO nao tem
 * como calcular o vencimento, e a parcela apareceria sem data em algumas telas
 * e com data em outras.
 */
export const TX_INCLUDE = {
  account: { select: { name: true, customName: true, creditCardDueDay: true } },
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
  account: { name: string; customName: string | null; creditCardDueDay: number | null };
  categoryId: string | null;
  category: { name: string } | null;
  installmentIndex: number | null;
  installmentTotal: number | null;
  billMonth: string | null;
  competenceDate: Date;
  purchaseKey: string | null;
  compensationId: string | null;
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
    accountName: resolveAccountName(tx.account),
    categoryId: tx.categoryId,
    categoryName: tx.category?.name ?? null,
    installmentIndex: tx.installmentIndex,
    installmentTotal: tx.installmentTotal,
    // Derivado, nao guardado: o dia de vencimento mora na conta, e mudar la tem
    // de consertar todas as parcelas de uma vez.
    dueDate: vencimentoDaFatura(tx.billMonth, tx.account.creditCardDueDay)?.toISOString() ?? null,
    competenceDate: tx.competenceDate.toISOString(),
    purchaseKey: tx.purchaseKey,
    compensationId: tx.compensationId,
  };
}

/** Início do dia seguinte a "YYYY-MM-DD", em UTC — o limite superior aberto. */
function nextDayUtc(day: string): Date {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export async function listTransactions(
  scope: Scope,
  filters: TransactionFilters = {}
): Promise<TransactionDTO[]> {
  const where: Prisma.TransactionWhereInput = {
    // A lista é do espaço: sem o `in`, o casal veria metade do próprio mês sem
    // nenhum erro para denunciar a falta.
    userId: { in: ownerIds(scope, filters.owner) },
  };

  if (filters.month) {
    const [yearStr, monthStr] = filters.month.split("-");
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (!isNaN(year) && !isNaN(month)) {
      const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const startOfNextMonth = new Date(Date.UTC(year, month, 1, 0, 0, 0));
      // O mês da lista é o mês em que a despesa **conta** — a parcela aparece
      // na fatura dela, não no dia da compra. O filtro por intervalo de datas,
      // logo abaixo, continua na data real de propósito: quem digita um
      // intervalo está procurando quando algo aconteceu.
      where.competenceDate = {
        gte: startOfMonth,
        lt: startOfNextMonth,
      };
    }
  } else if (filters.startDate || filters.endDate) {
    // `endDate` chega como dia ("YYYY-MM-DD"), que vira meia-noite em UTC: com
    // `lte` uma transação registrada às 10h do próprio dia final ficaria de
    // fora. O corte é no início do dia seguinte.
    where.date = {
      ...(filters.startDate && { gte: new Date(`${filters.startDate}T00:00:00.000Z`) }),
      ...(filters.endDate && { lt: nextDayUtc(filters.endDate) }),
    };
  }

  if (filters.accountId) {
    where.accountId = filters.accountId;
  }

  if (filters.uncategorized) {
    // "Sem categoria" deixou de ser ausência e virou um lugar: a oculta.
    const systemIds = await ensureSystemCategories(prisma, scope.householdId);
    where.categoryId = systemIds[SystemCategoryKey.UNCATEGORIZED];
  } else if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.type) {
    where.type = filters.type as PrismaTransactionType;
  }

  // `amount` é sempre positivo — o sinal mora em `type`. Faixa de valor é,
  // portanto, comparação direta, e vale igual para despesa e receita.
  if (filters.minAmount !== undefined || filters.maxAmount !== undefined) {
    where.amount = {
      ...(filters.minAmount !== undefined && {
        gte: new Prisma.Decimal(filters.minAmount),
      }),
      ...(filters.maxAmount !== undefined && {
        lte: new Prisma.Decimal(filters.maxAmount),
      }),
    };
  }

  if (filters.search) {
    const term = filters.search.trim();
    if (term.length > 0) {
      where.OR = [
        { description: { contains: term, mode: "insensitive" } },
        { note: { contains: term, mode: "insensitive" } },
      ];
    }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: TX_INCLUDE,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    ...(filters.limit ? { take: filters.limit } : {}),
  });

  return transactions.map(formatTransactionDTO);
}

export async function getTransactionById(
  scope: Scope,
  id: string
): Promise<TransactionDTO | null> {
  const tx = await prisma.transaction.findFirst({
    where: { id, userId: { in: scope.memberIds } },
    include: TX_INCLUDE,
  });

  if (!tx) return null;
  return formatTransactionDTO(tx);
}

export async function createTransaction(
  scope: Scope,
  input: CreateTransactionInput
): Promise<TransactionDTO> {
  const account = await prisma.account.findFirst({
    where: { id: input.accountId, userId: { in: scope.memberIds } },
  });
  if (!account) {
    throw new AccountNotFoundError();
  }

  if (input.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, householdId: scope.householdId },
    });
    if (!category) {
      throw new CategoryNotFoundError();
    }
  }

  // Nem a criação manual escapa da invariante: sem categoria escolhida, a
  // transação nasce em "Sem categoria".
  let categoryId = input.categoryId ?? null;
  const semCategoria = !categoryId;
  if (!categoryId) {
    const systemIds = await ensureSystemCategories(prisma, scope.householdId);
    categoryId = systemIds[SystemCategoryKey.UNCATEGORIZED];
  }

  const created = await prisma.transaction.create({
    data: {
      // Quem lança é o dono da linha, mesmo lançando na conta do parceiro: é o
      // que faz a dissolução do espaço saber com quem cada transação fica.
      userId: scope.userId,
      accountId: input.accountId,
      description: input.description.trim(),
      amount: new Prisma.Decimal(input.amount),
      type: input.type as PrismaTransactionType,
      date: new Date(input.date),
      // Lançamento manual não tem fatura: competência é o próprio dia. Quando
      // parcela manual existir, é aqui que ela vai divergir.
      competenceDate: new Date(input.date),
      categoryId,
      note: input.note?.trim() ?? null,
      isRecurring: input.isRecurring ?? false,
    },
    include: TX_INCLUDE,
  });

  // Lançamento manual sem categoria é uma decisão adiada como qualquer outra: a
  // fila de revisão é onde ela espera.
  if (semCategoria) {
    await reopenPendingSuggestion(scope, created.id);
  }

  return formatTransactionDTO(created);
}

export async function updateTransaction(
  scope: Scope,
  id: string,
  input: UpdateTransactionInput
): Promise<TransactionDTO> {
  const existing = await prisma.transaction.findFirst({
    where: { id, userId: { in: scope.memberIds } },
  });
  if (!existing) {
    throw new TransactionNotFoundError();
  }

  if (input.categoryId !== undefined && input.categoryId !== null) {
    const category = await prisma.category.findFirst({
      where: { id: input.categoryId, householdId: scope.householdId },
    });
    if (!category) {
      throw new CategoryNotFoundError();
    }
  }

  // Mover uma ponta para fora de "Transferência entre contas" significa que o
  // pareamento errou. Desfazer só o vínculo deixaria a outra ponta sozinha numa
  // categoria que já não descreve nada — ela volta para "Sem categoria", onde o
  // filtro e a fila de revisão a encontram.
  if (input.categoryId !== undefined && existing.transferPairId) {
    const systemIds = await ensureSystemCategories(prisma, scope.householdId);
    // A outra ponta pode ser do parceiro — o pagamento de fatura pareia a conta
    // corrente de um com o cartão do outro.
    const orfas = await prisma.transaction.findMany({
      where: {
        userId: { in: scope.memberIds },
        transferPairId: existing.transferPairId,
        id: { not: id },
      },
      select: { id: true },
    });

    for (const orfa of orfas) {
      await prisma.transaction.update({
        where: { id: orfa.id },
        data: {
          transferPairId: null,
          categoryId: systemIds[SystemCategoryKey.UNCATEGORIZED],
        },
      });
      await reopenPendingSuggestion(scope, orfa.id);
    }

    await prisma.transaction.update({
      where: { id },
      data: { transferPairId: null },
    });
  }

  // "Sem categoria" é uma escolha legítima na edição — o que ela não pode virar
  // é `null`, que quebraria a invariante de `categoryId` sempre preenchido. O
  // pedido vira a oculta, exatamente onde o filtro "sem categoria" e a fila de
  // revisão a encontram.
  let nextCategoryId = input.categoryId;
  let voltouParaAFila = false;
  if (input.categoryId === null) {
    const systemIds = await ensureSystemCategories(prisma, scope.householdId);
    nextCategoryId = systemIds[SystemCategoryKey.UNCATEGORIZED];
    voltouParaAFila = true;
  }

  const updated = await prisma.transaction.update({
    where: { id },
    data: {
      ...(input.description !== undefined && { description: input.description.trim() }),
      ...(nextCategoryId !== undefined && { categoryId: nextCategoryId }),
      ...(input.note !== undefined && { note: input.note ? input.note.trim() : null }),
      ...(input.isRecurring !== undefined && { isRecurring: input.isRecurring }),
    },
    include: TX_INCLUDE,
  });

  if (voltouParaAFila) {
    await reopenPendingSuggestion(scope, id);
  }

  return formatTransactionDTO(updated);
}

/**
 * As parcelas da compra a que uma transacao pertence.
 *
 * Vive num endpoint proprio, e nao embutido na listagem, porque a lista mensal
 * mostra **uma** parcela por compra: mandar as dez em toda listagem seria
 * multiplicar a resposta por dez para alimentar um dropdown que quase nunca e
 * aberto.
 *
 * O par (id, membros do espaco) e o que prova posse — id sozinho nao prova nada.
 */
export async function listInstallments(
  scope: Scope,
  transactionId: string
): Promise<InstallmentsResponse> {
  const base = await prisma.transaction.findFirst({
    where: { id: transactionId, userId: { in: scope.memberIds } },
    select: { purchaseKey: true },
  });

  if (!base) {
    throw new TransactionNotFoundError();
  }

  // Compra a vista nao tem grupo. Devolver a propria linha seria mentir que ha
  // um parcelamento de um item so.
  if (!base.purchaseKey) {
    return { installments: [], total: 0, paidTotal: 0 };
  }

  const rows = await prisma.transaction.findMany({
    where: { userId: { in: scope.memberIds }, purchaseKey: base.purchaseKey },
    include: TX_INCLUDE,
    orderBy: [{ installmentIndex: "asc" }, { competenceDate: "asc" }],
  });

  // As faturas das parcelas, numa consulta so. So aqui, e nao no
  // `formatTransactionDTO` de toda listagem: a pergunta "esta paga?" e do
  // detalhe da compra, e a lista do mes pagaria o join sem usar a resposta.
  const idsDeFatura = [
    ...new Set(rows.map((r) => r.pluggyBillId).filter((id): id is string => id !== null)),
  ];

  const faturas = await buscarEmLotes(idsDeFatura, (lote) =>
    prisma.creditCardBill.findMany({
      where: { userId: { in: scope.memberIds }, pluggyBillId: { in: lote } },
      select: { pluggyBillId: true, dueDate: true, paidAt: true },
    })
  );

  const faturaPorId = new Map(faturas.map((f) => [f.pluggyBillId, f] as const));
  const agora = new Date();

  const installments: InstallmentDTO[] = rows.map((row) => {
    const fatura = row.pluggyBillId ? faturaPorId.get(row.pluggyBillId) : null;
    const status = statusDaParcela(fatura, agora);

    return {
      ...formatTransactionDTO(row),
      status,
      paidAt: status === "PAID" ? fatura!.paidAt!.toISOString() : null,
    };
  });

  // A soma das parcelas que existem, e nao `creditCardMetadata.totalAmount`: se
  // o historico so trouxe seis das dez, o total tem de dizer seis — um numero
  // que nao bate com as linhas exibidas e pior que numero nenhum.
  const total = Number(
    installments.reduce((soma, t) => soma + t.amount, 0).toFixed(2)
  );

  const paidTotal = Number(
    installments
      .filter((t) => t.status === "PAID")
      .reduce((soma, t) => soma + t.amount, 0)
      .toFixed(2)
  );

  return { installments, total, paidTotal };
}
