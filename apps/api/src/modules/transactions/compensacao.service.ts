import { randomUUID } from "crypto";
import type {
  CompensationCandidateDTO,
  CompensationCandidatesResponse,
  CompensationDetailResponse,
} from "@poup/shared";
import { prisma } from "../../prisma";
import { candidatasDeCompensacao, type GrupoDeCompra } from "../../lib/compensacao";
import { TransactionNotFoundError, UnprocessableError } from "../../lib/errors";

/**
 * Compensar um estorno: dizer que aquele crédito cancela aquela compra
 * parcelada, e que nenhuma das duas pontas conta em lugar nenhum.
 *
 * É manual de propósito. Este seria o terceiro caminho do sistema a gravar sem
 * perguntar, e o mais caro de errar: uma despesa real sumiria do relatório em
 * silêncio, e a pessoa descobriria meses depois. O toque a mais custa pouco.
 */

/** Centavos inteiros a partir de um `Decimal` do Prisma. */
function centavos(valor: { toString(): string }): number {
  return Math.round(Number(valor.toString()) * 100);
}

/** A ponta crédito, conferida. O par (id, userId) é o que prova posse. */
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
    // Uma parcela compensada compromete o grupo inteiro: não dá para compensar
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
    throw new UnprocessableError("O estorno e a compra precisam estar na mesma conta.");
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

  // Uma escrita só, e não uma por linha: um erro no meio deixaria metade da
  // compra compensada — pior que não ter compensado nada.
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

  // Desfazer o que não está feito é sucesso, não erro: a tela pode chegar aqui
  // com um estado velho, e um 422 não ajudaria em nada.
  if (tx.compensationId === null) return { afetadas: 0 };

  const { count } = await prisma.transaction.updateMany({
    where: { userId, compensationId: tx.compensationId },
    data: { compensationId: null },
  });

  return { afetadas: count };
}

/**
 * As duas pontas de uma compensacao ja feita.
 *
 * Serve a pergunta que a faixa "Compensado" deixava no ar: *qual* compra este
 * credito cancelou? Endpoint proprio, e nao campo no DTO da lista, pelo mesmo
 * motivo de `/:id/installments`: so interessa quando alguem abre a transacao.
 *
 * O grupo vem pelo `compensationId`, e nao pela transacao pedida — perguntar
 * por uma parcela devolve o mesmo que perguntar pelo credito.
 */
export async function detalheDaCompensacao(
  userId: string,
  transactionId: string
): Promise<CompensationDetailResponse> {
  const tx = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { compensationId: true },
  });

  if (!tx) throw new TransactionNotFoundError();
  if (tx.compensationId === null) return { compensation: null };

  const linhas = await prisma.transaction.findMany({
    where: { userId, compensationId: tx.compensationId },
    select: {
      id: true,
      description: true,
      type: true,
      amount: true,
      date: true,
      purchaseKey: true,
      installmentTotal: true,
      purchaseDate: true,
    },
  });

  const estorno = linhas.find((l) => l.type === "INCOME");
  const parcelas = linhas.filter((l) => l.type === "EXPENSE");

  // Um grupo sem uma das pontas nao deveria existir: o servico so grava as duas
  // juntas. Se existir, e melhor a tela nao mostrar nada do que mostrar meia
  // verdade sobre onde o dinheiro foi parar.
  if (!estorno || parcelas.length === 0) return { compensation: null };

  const primeira = parcelas[0];

  return {
    compensation: {
      estorno: {
        id: estorno.id,
        description: estorno.description,
        amount: Number(estorno.amount),
        date: estorno.date.toISOString(),
      },
      compra: {
        purchaseKey: primeira.purchaseKey,
        description: primeira.description,
        // A soma das parcelas, e nao o valor de uma: e o numero que a pessoa
        // reconhece do extrato, e o que tem de bater com o estorno.
        total: parcelas.reduce((soma, p) => soma + centavos(p.amount), 0) / 100,
        installmentTotal: primeira.installmentTotal,
        parcelasConhecidas: parcelas.length,
        purchaseDate: primeira.purchaseDate?.toISOString() ?? null,
      },
    },
  };
}
