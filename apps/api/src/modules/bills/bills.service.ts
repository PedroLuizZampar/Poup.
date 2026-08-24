import { randomUUID } from "node:crypto";
import type { PluggyClient } from "pluggy-sdk";
import { Prisma, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import { ensureSystemCategories } from "../../lib/systemCategories";
import {
  JANELA_DE_PAGAMENTO_DIAS,
  casarPagamentos,
  casarPontas,
  casarPorDescricao,
  pagamentoQueQuita,
  type CreditoEmCartao,
  type DebitoCandidato,
  type FaturaPaga,
} from "../../lib/pagamentoDeFatura";
import { buscarEmLotes, emLotes, LOTE } from "../../lib/lotes";
import { enfileirarParaRevisao } from "../categorization/categorization.service";

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
    // A Pluggy pode devolver varios pagamentos por fatura, e nem todo lancamento
    // ali e dinheiro que o usuario mandou: um estorno de compra tambem chega
    // como pagamento. Quem separa os dois e `pagamentoQueQuita`.
    const quitacao = pagamentoQueQuita(bill.payments ?? []);

    const dados = {
      userId,
      accountId,
      dueDate: new Date(bill.dueDate),
      closingDate: bill.billClosingDate ? new Date(bill.billClosingDate) : null,
      totalAmount: new Prisma.Decimal(bill.totalAmount ?? 0),
      // Nulo quando nenhum pagamento quita — e nulo tambem **de volta**, se a
      // fatura tinha sido gravada com um lancamento que nao quitava: o upsert
      // reescreve as duas colunas a cada sync.
      paidAt: quitacao ? new Date(quitacao.paymentDate) : null,
      paidAmount: quitacao ? new Prisma.Decimal(quitacao.amount) : null,
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
 * Marca como "Pagamento de fatura" as duas pontas de um pagamento — e desmarca
 * o que deixou de ser.
 *
 * Roda depois do sync, sobre o usuario inteiro, porque as duas pontas moram em
 * contas diferentes e podem ter chegado em sincronizacoes diferentes.
 *
 * **As duas pontas, sempre.** Marcar so o debito da conta corrente deixava o
 * credito do cartao contando como receita: no caso real, um pagamento de
 * R$ 94,62 abatia a despesa de um lado e entrava como dinheiro novo do outro.
 * As duas ganham um `transferPairId` compartilhado, o mesmo mecanismo do
 * pareamento de transferencia — e por isso desfazer numa ponta ja desfaz na
 * outra, sem codigo novo.
 *
 * **Esta funcao e a dona da relacao conta-corrente ↔ cartao.** O pareamento de
 * transferencia foi proibido de encostar em conta de credito justamente porque
 * os dois disputavam o mesmo par, e quem marcasse primeiro definia o rotulo: no
 * caso real, junho e julho sairam como transferencia e agosto saiu marcado so
 * de um lado. Por isso o conjunto de candidatos inclui tambem as linhas que o
 * pareamento reivindicou antes desta regra existir — sao dela, e voltam.
 *
 * Cada execucao **recalcula** o conjunto inteiro em vez de so acrescentar. E o
 * que permite corrigir o que uma versao anterior marcou errado, e o que torna a
 * funcao idempotente.
 */
export async function reconhecerPagamentos(userId: string): Promise<number> {
  const systemIds = await ensureSystemCategories(prisma, userId);
  const billPaymentId = systemIds[SystemCategoryKey.BILL_PAYMENT];
  const transferId = systemIds[SystemCategoryKey.TRANSFER];

  // Despesas em conta que nao e cartao: a ponta de onde o dinheiro sai.
  const despesas = await prisma.transaction.findMany({
    where: { userId, type: "EXPENSE", account: { type: { not: "CREDIT" } } },
    select: {
      id: true,
      accountId: true,
      date: true,
      amount: true,
      description: true,
      categoryId: true,
      transferPairId: true,
    },
  });

  // Creditos em conta de cartao: a ponta que a quitacao lanca no proprio cartao.
  const creditos = await prisma.transaction.findMany({
    where: { userId, type: "INCOME", account: { type: "CREDIT" } },
    select: {
      id: true,
      accountId: true,
      date: true,
      amount: true,
      categoryId: true,
      transferPairId: true,
    },
  });

  // Quais pares tem uma perna num cartao. Sao os que o pareamento de
  // transferencia criou antes de ser proibido de encostar em credito — e que
  // portanto sao desta funcao.
  const idsDePar = [
    ...new Set(
      [...despesas, ...creditos].map((t) => t.transferPairId).filter((p): p is string => p !== null)
    ),
  ];

  const pernasEmCartao = await buscarEmLotes(idsDePar, (lote) =>
    prisma.transaction.findMany({
      where: { userId, transferPairId: { in: lote }, account: { type: "CREDIT" } },
      select: { transferPairId: true },
    })
  );

  const paresDeCartao = new Set(
    pernasEmCartao.map((p) => p.transferPairId).filter((p): p is string => p !== null)
  );

  /** Livre para esta funcao decidir: sem par, ou num par que e dela. */
  const disponivel = (t: { transferPairId: string | null }) =>
    t.transferPairId === null || paresDeCartao.has(t.transferPairId);

  const candidatos = despesas.filter(disponivel);
  const creditosLivres = creditos.filter(disponivel);

  // --- 1. Casamento por fatura: a instituicao dizendo que foi paga, quanto e
  //        quando. E prova suficiente por si, entao o debito e reconhecido
  //        mesmo que o credito do cartao nao tenha sido importado.
  const faturasPagas = await prisma.creditCardBill.findMany({
    where: { userId, paidAt: { not: null }, paidAmount: { not: null } },
    select: { pluggyBillId: true, accountId: true, paidAt: true, paidAmount: true },
  });

  const faturas: FaturaPaga[] = faturasPagas.map((f) => ({
    billId: f.pluggyBillId,
    accountId: f.accountId,
    paidAt: f.paidAt!,
    paidAmount: Number(f.paidAmount!),
  }));

  const paraDebito = (c: (typeof candidatos)[number]): DebitoCandidato => ({
    id: c.id,
    accountId: c.accountId,
    date: c.date,
    amount: Number(c.amount),
  });

  const paraCredito = (c: (typeof creditosLivres)[number]): CreditoEmCartao => ({
    id: c.id,
    accountId: c.accountId,
    date: c.date,
    amount: Number(c.amount),
  });

  const idsCasados = new Set<string>();

  if (faturas.length > 0) {
    // A janela do casamento e a das faturas mais a folga: uma transacao fora
    // dela nao pode casar com fatura nenhuma.
    const datas = faturas.map((f) => f.paidAt.getTime());
    const folga = JANELA_DE_PAGAMENTO_DIAS * DIA_MS;
    const inicio = Math.min(...datas) - folga;
    const fim = Math.max(...datas) + folga;

    const naJanela = candidatos
      .filter((c) => c.date.getTime() >= inicio && c.date.getTime() <= fim)
      .map(paraDebito);

    for (const casamento of casarPagamentos(faturas, naJanela)) {
      idsCasados.add(casamento.transactionId);
    }
  }

  // --- 2. As contrapartes dos que a fatura reconheceu.
  const pares = casarPontas(
    candidatos.filter((c) => idsCasados.has(c.id)).map(paraDebito),
    creditosLivres.map(paraCredito)
  );

  const creditosUsados = new Set(pares.map((p) => p.creditoId));

  // --- 3. A reserva por descricao, sobre o que sobrou dos dois lados. Aqui a
  //        contraparte e **obrigatoria**: sem as duas pontas vinculadas, nao se
  //        categoriza nada.
  const porDescricao = casarPorDescricao(
    candidatos
      .filter((c) => !idsCasados.has(c.id))
      .map((c) => ({ ...paraDebito(c), description: c.description })),
    creditosLivres.filter((c) => !creditosUsados.has(c.id)).map(paraCredito)
  );

  // --- 4. O estado desejado, linha a linha.
  //
  // Um debito reconhecido pela fatura sem contraparte importada fica sem
  // `transferPairId`: nao ha par nenhum para ligar, e inventar um uuid sozinho
  // faria "desfazer numa ponta" procurar uma ponta que nao existe.
  const parDe = new Map<string, string>();
  for (const { debitoId, creditoId } of [...pares, ...porDescricao]) {
    const uuid = randomUUID();
    parDe.set(debitoId, uuid);
    parDe.set(creditoId, uuid);
  }

  const reconhecidos = new Set<string>([
    ...idsCasados,
    ...porDescricao.map((p) => p.debitoId),
    ...parDe.keys(),
  ]);

  const universo = [...candidatos, ...creditosLivres];

  const marcacoes: Prisma.PrismaPromise<unknown>[] = [];
  const paraReverter: string[] = [];

  for (const linha of universo) {
    const deveSer = reconhecidos.has(linha.id);
    const parNovo = parDe.get(linha.id) ?? null;

    if (deveSer) {
      if (linha.categoryId === billPaymentId && linha.transferPairId === parNovo) continue;
      marcacoes.push(
        prisma.transaction.updateMany({
          where: { id: linha.id, userId },
          data: { categoryId: billPaymentId, transferPairId: parNovo },
        })
      );
      continue;
    }

    // Nao e pagamento de fatura. So mexe se alguma versao desta regra (ou o
    // pareamento, antes de ser proibido) tiver colocado a linha ali: o resto
    // e decisao de outra pessoa ou de outro caminho.
    if (linha.categoryId === billPaymentId || linha.categoryId === transferId) {
      paraReverter.push(linha.id);
    }
  }

  for (const lote of emLotes(marcacoes, LOTE)) {
    await prisma.$transaction(lote);
  }

  // A linha acabou de ganhar categoria, e pendente e sinonimo de sem categoria:
  // sem esta limpeza a fila continua pedindo categoria para algo que esta
  // funcao categorizou. Apagar (em vez de marcar DISMISSED) e o que o
  // pareamento ja faz, e pela mesma razao — deixa a sugestao voltar se a
  // marcacao for desfeita.
  const marcados = [...reconhecidos];
  for (const lote of emLotes(marcados)) {
    await prisma.categorySuggestion.deleteMany({
      where: { userId, transactionId: { in: lote }, status: "PENDING" },
    });
  }

  // Reverter e devolver a decisao a pessoa, nao escolher outra por ela: a linha
  // volta para "Sem categoria" **e** para a fila de revisao. O par tambem cai —
  // ele so existia por causa da marcacao que acabou de sair.
  for (const lote of emLotes(paraReverter)) {
    await prisma.transaction.updateMany({
      where: { id: { in: lote }, userId },
      data: { transferPairId: null },
    });
  }

  await enfileirarParaRevisao(userId, paraReverter);

  return marcacoes.length + paraReverter.length;
}
