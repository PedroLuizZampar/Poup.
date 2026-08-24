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
    const ultimoPagamento = [...(bill.payments ?? [])]
      .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())
      .pop();

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
