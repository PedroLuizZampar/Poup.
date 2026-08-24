import { randomUUID } from "node:crypto";
import { Prisma, SuggestionSource, SuggestionStatus, SystemCategoryKey } from "@prisma/client";
import { prisma } from "../../prisma";
import {
  buildHistoryIndex,
  detectTransferPairs,
  suggestCategory,
  TRANSFER_WINDOW_DAYS,
  type SuggestionContext,
  type TransferCandidate,
} from "../../lib/categorization";
import { ensureSystemCategories } from "../../lib/systemCategories";
import { buscarEmLotes, emLotes, LOTE } from "../../lib/lotes";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ProcessResult {
  /** Transações que entraram em "Transferência entre contas" (as duas pontas). */
  transfers: number;
  /** Transações que entraram na fila **com** uma categoria sugerida. */
  suggested: number;
  /** Transações que entraram na fila sem palpite nenhum (`source: NONE`). */
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

  const novas = await buscarEmLotes(transactionIds, (lote) =>
    prisma.transaction.findMany({
      where: { id: { in: lote }, userId },
      select: {
        id: true,
        accountId: true,
        amount: true,
        type: true,
        date: true,
        description: true,
        categoryId: true,
        transferPairId: true,
        account: { select: { type: true } },
      },
    })
  );

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
    account: { type: "CHECKING" | "SAVINGS" | "CREDIT" | "DEBIT_CARD" | "INVESTMENT" };
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

  // Cada par ganha o próprio `transferPairId`, então não há um `updateMany` só
  // que resolva todos. Mas eles podem viajar juntos: um `$transaction` manda o
  // lote inteiro numa ida ao banco, enquanto um `await` por par custava um
  // ida-e-volta cada. Num primeiro sync, onde os pares saem às centenas, era a
  // diferença entre segundos e dezenas de segundos.
  const emTransferencia = new Set<string>();
  const marcacoes = pares.map((par) => {
    emTransferencia.add(par.aId);
    emTransferencia.add(par.bId);
    return prisma.transaction.updateMany({
      where: { id: { in: [par.aId, par.bId] }, userId },
      data: {
        categoryId: systemIds[SystemCategoryKey.TRANSFER],
        transferPairId: randomUUID(),
      },
    });
  });

  for (const lote of emLotes(marcacoes, LOTE)) {
    await prisma.$transaction(lote);
  }

  // A outra ponta pode ter entrado num sync anterior — e o sync roda este
  // pipeline uma vez por conexão, então "anterior" inclui a conexão de cima do
  // mesmo sync. Nesse caso ela já tinha ganhado uma sugestão pendente, que
  // agora não vale mais: a transação está categorizada como transferência, e a
  // fila ficaria pedindo categoria para algo que já tem uma. Apagar (em vez de
  // marcar DISMISSED) mantém a regra de que pendente é sinônimo de sem
  // categoria, e deixa a sugestão voltar se o par for desfeito.
  if (emTransferencia.size > 0) {
    await prisma.categorySuggestion.deleteMany({
      where: {
        userId,
        transactionId: { in: Array.from(emTransferencia) },
        status: "PENDING",
      },
    });
  }

  // 2. O resto cai em "Sem categoria" — mas só o que ainda não tem categoria
  //    nenhuma. O pipeline preenche vazio; ele não desfaz decisão. Sem esse
  //    filtro, chamá-lo duas vezes sobre os mesmos ids arrancaria as
  //    transferências recém-pareadas de volta para "Sem categoria".
  const semDecisao = novas.filter(
    (t) => !emTransferencia.has(t.id) && t.categoryId === null
  );

  for (const lote of emLotes(semDecisao.map((t) => t.id))) {
    await prisma.transaction.updateMany({
      where: { id: { in: lote }, userId },
      data: { categoryId: systemIds[SystemCategoryKey.UNCATEGORIZED] },
    });
  }

  // 3. Índice de histórico, construído uma vez para o lote inteiro.
  const ctx = await buildSuggestionContext(userId, systemIdSet, novas.map((t) => t.id));

  // 4. Sugestões — uma por transação sem categoria, **inclusive as sem palpite**.
  //
  //    A linha sem palpite (`source: NONE`, `categoryId: null`) parece
  //    desperdício até você olhar de onde a fila de revisão tira o que mostrar:
  //    ela lê esta tabela. Sem a linha, a transação que nenhuma fonte adivinhou
  //    sumia do contador, da notificação e de `/revisao` — justo a que mais
  //    precisa de alguém decidindo. E é a maioria em conta nova, onde não há
  //    histórico e só a tabela de palavras-chave responde.
  //
  //    `skipDuplicates` cobre a transação que já foi julgada num sync anterior:
  //    uma sugestão por transação, e pular é definitivo.
  const palpites = semDecisao.map((tx) => ({
    tx,
    palpite: suggestCategory({ description: tx.description }, ctx),
  }));

  const sugestoes = palpites.map(({ tx, palpite }) => ({
    userId,
    transactionId: tx.id,
    categoryId: palpite?.categoryId ?? null,
    source: (palpite?.source ?? "NONE") as SuggestionSource,
    confidence: palpite?.confidence ?? 0,
  }));

  for (const lote of emLotes(sugestoes)) {
    await prisma.categorySuggestion.createMany({ data: lote, skipDuplicates: true });
  }

  // Contagem sobre o palpite, não sobre o retorno do `createMany`: o que a
  // notificação quer dizer é quantas o app adivinhou, e `skipDuplicates` faz o
  // count devolver zero para uma transação que já estava na fila desde antes.
  const suggested = palpites.filter(({ palpite }) => palpite !== null).length;

  return {
    transfers: emTransferencia.size,
    suggested,
    withoutGuess: semDecisao.length - suggested,
  };
}

/**
 * O que o motor usa para arriscar um palpite: o histórico já categorizado pelo
 * usuário e as categorias que ele pode escolher. As de sistema ficam de fora do
 * histórico — "Sem categoria" não ensina nada, e "Transferência entre contas"
 * ensinaria errado.
 *
 * `excluirTransacoes` tira do histórico as transações que estão sendo julgadas
 * agora: elas ainda não são decisão de ninguém, e deixá-las entrar faria o
 * palpite se apoiar em si mesmo.
 */
async function buildSuggestionContext(
  userId: string,
  systemIdSet: Set<string>,
  excluirTransacoes: string[] = []
): Promise<SuggestionContext> {
  const selecionaveis = await prisma.category.findMany({
    where: { userId, systemKey: null },
    select: { id: true, name: true },
  });

  const historico = await prisma.transaction.findMany({
    where: {
      userId,
      categoryId: { notIn: Array.from(systemIdSet) },
      ...(excluirTransacoes.length > 0 ? { id: { notIn: excluirTransacoes } } : {}),
    },
    select: { description: true, categoryId: true },
  });

  return {
    history: buildHistoryIndex(
      historico.filter(
        (t): t is { description: string; categoryId: string } => t.categoryId !== null
      )
    ),
    categories: selecionaveis,
  };
}

/**
 * Recalcula o palpite de todas as sugestões ainda pendentes.
 *
 * Roda depois de cada lote aprovado na revisão, e é o que faz a tela valer a
 * pena: categorizar dez "IFOOD" ensina o histórico, e o mesmo histórico passa a
 * responder por transações que na rodada anterior ninguém tinha adivinhado. Sem
 * este passo, o que sobrasse na fila continuaria com o palpite (ou a falta
 * dele) calculado no dia da importação.
 *
 * Fica de fora quem teve o palpite recusado à mão (`guessRejected`): devolver
 * ali o palpite que o usuário acabou de desmarcar seria desfazer a decisão dele.
 */
export async function reevaluatePendingSuggestions(userId: string): Promise<number> {
  const pendentes = await prisma.categorySuggestion.findMany({
    where: { userId, status: SuggestionStatus.PENDING, guessRejected: false },
    select: {
      id: true,
      categoryId: true,
      source: true,
      confidence: true,
      transaction: { select: { description: true } },
    },
  });
  if (pendentes.length === 0) return 0;

  const systemIds = await ensureSystemCategories(prisma, userId);
  const ctx = await buildSuggestionContext(userId, new Set(Object.values(systemIds)));

  const mudancas = pendentes.flatMap((pendente) => {
    const palpite = suggestCategory({ description: pendente.transaction.description }, ctx);
    const categoryId = palpite?.categoryId ?? null;
    const source = (palpite?.source ?? "NONE") as SuggestionSource;
    const confidence = palpite?.confidence ?? 0;

    const igual =
      categoryId === pendente.categoryId &&
      source === pendente.source &&
      confidence === pendente.confidence;

    return igual
      ? []
      : [
          prisma.categorySuggestion.update({
            where: { id: pendente.id },
            data: { categoryId, source, confidence },
          }),
        ];
  });

  if (mudancas.length > 0) {
    await prisma.$transaction(mudancas);
  }

  return mudancas.length;
}

/**
 * Devolve uma transação para a fila de revisão.
 *
 * Marcar "Sem categoria" à mão é dizer "isto ainda não está decidido" — e o
 * lugar de uma decisão pendente é `/revisao`, não uma tela onde ela só reapareça
 * se alguém filtrar. Sem isto, trocar a categoria por "Sem categoria" mudava a
 * linha e mais nada: a transação não voltava para o contador nem para a fila.
 *
 * Entra como `NONE` com `guessRejected`: quem acabou de tirar a categoria à mão
 * não quer que a reavaliação do próximo lote devolva um palpite para o mesmo
 * comerciante. Ela cai na última página da revisão, onde a escolha é manual.
 */
export async function reopenPendingSuggestion(
  userId: string,
  transactionId: string
): Promise<void> {
  const pendente = {
    categoryId: null,
    source: SuggestionSource.NONE,
    confidence: 0,
    status: SuggestionStatus.PENDING,
    guessRejected: true,
    resolvedCategoryId: null,
    resolvedAt: null,
  };

  await prisma.categorySuggestion.upsert({
    where: { transactionId },
    create: { userId, transactionId, ...pendente },
    update: pendente,
  });
}

/**
 * Devolve transacoes a fila de revisao porque o **app** mudou de ideia.
 *
 * Diferente de `reopenPendingSuggestion`, que atende a pessoa tirando a
 * categoria a mao: ali `guessRejected` existe para nao devolver o palpite que
 * ela acabou de recusar. Aqui ninguem recusou nada — foi o app que classificou
 * errado e esta desfazendo —, entao a transacao volta com o melhor palpite que
 * o historico souber dar, que e o que a torna resolvivel em um clique.
 *
 * `upsert`, e nao `createMany`: uma transacao mal classificada pode ja ter uma
 * sugestao RESOLVED de antes, e uma linha resolvida nao aparece na fila.
 */
export async function enfileirarParaRevisao(
  userId: string,
  transactionIds: string[]
): Promise<number> {
  if (transactionIds.length === 0) return 0;

  const systemIds = await ensureSystemCategories(prisma, userId);

  for (const lote of emLotes(transactionIds)) {
    await prisma.transaction.updateMany({
      where: { id: { in: lote }, userId },
      data: { categoryId: systemIds[SystemCategoryKey.UNCATEGORIZED] },
    });
  }

  const linhas = await buscarEmLotes(transactionIds, (lote) =>
    prisma.transaction.findMany({
      where: { id: { in: lote }, userId },
      select: { id: true, description: true },
    })
  );

  const ctx = await buildSuggestionContext(
    userId,
    new Set(Object.values(systemIds)),
    linhas.map((t) => t.id)
  );

  const upserts = linhas.map((tx) => {
    const palpite = suggestCategory({ description: tx.description }, ctx);
    const pendente = {
      categoryId: palpite?.categoryId ?? null,
      source: (palpite?.source ?? "NONE") as SuggestionSource,
      confidence: palpite?.confidence ?? 0,
      status: SuggestionStatus.PENDING,
      guessRejected: false,
      resolvedCategoryId: null,
      resolvedAt: null,
    };

    return prisma.categorySuggestion.upsert({
      where: { transactionId: tx.id },
      create: { userId, transactionId: tx.id, ...pendente },
      update: pendente,
    });
  });

  for (const lote of emLotes(upserts, LOTE)) {
    await prisma.$transaction(lote);
  }

  return linhas.length;
}
