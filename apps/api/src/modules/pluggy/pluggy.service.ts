import type { Account as PluggyAccount, Transaction as PluggyTransaction } from "pluggy-sdk";
import { getPluggyClientForUser } from "../../lib/pluggy";
import { prisma } from "../../prisma";
import { ItemStatus, AccountType, TransactionType, Prisma, type Item } from "@prisma/client";
import type { ItemDTO, SyncItemResponse } from "@poup/shared";
import { validateImageDataUrl } from "../../lib/imageDataUrl";
import {
  AccountNotFoundError,
  ConflictError,
  ItemNotFoundError,
  UnprocessableError,
  UpstreamError,
} from "../../lib/errors";
import {
  FALLBACK_INSTITUTION_NAME,
  formatAccountName,
  resolveAccountInstitution,
  resolveItemInstitution,
} from "../../lib/institutions";
import { buscarEmLotes, emLotes } from "../../lib/lotes";
import {
  dadosDeParcela,
  diaDeVencimentoInicial,
  sinalDaTransacao,
  valorAbsoluto,
} from "../../lib/pluggyMapping";
import { processNewTransactions } from "../categorization/categorization.service";
import type { ProcessResult } from "../categorization/categorization.service";

/**
 * O que o sync devolve por dentro: o DTO que vai para o cliente mais o
 * resultado do pipeline. `review` fica fora do `SyncItemResponse` compartilhado
 * porque só a rota usa, para montar a notificação — o app não lê.
 */
export interface SyncResult extends SyncItemResponse {
  review: ProcessResult;
}

/** Um `Item` do banco só com o que o sync precisa. */
type SyncableItem = Pick<Item, "id" | "userId" | "pluggyItemId">;

/**
 * Os nove campos do `ItemDTO` apareciam copiados em três lugares deste arquivo.
 * Um só ponto de conversão evita que um campo novo entre em duas das três.
 */
function toItemDTO(item: Item): ItemDTO {
  return {
    id: item.id,
    pluggyItemId: item.pluggyItemId,
    institutionName: item.institutionName,
    institutionImageUrl: item.institutionImageUrl,
    customImageUrl: item.customImageUrl,
    status: item.status,
    lastSyncedAt: item.lastSyncedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function listItems(userId: string): Promise<ItemDTO[]> {
  const items = await prisma.item.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return items.map(toItemDTO);
}

/**
 * Grava a logo escolhida manualmente para a instituição. Fica em
 * `customImageUrl` — coluna que o sync não escreve — para que atualizar as
 * contas nunca desfaça a escolha do usuário. `null` volta ao logo do conector.
 */
export async function updateItemImage(
  userId: string,
  id: string,
  imageUrl: string | null
): Promise<ItemDTO> {
  const item = await prisma.item.findFirst({ where: { id, userId } });
  if (!item) {
    throw new ItemNotFoundError();
  }

  const updated = await prisma.item.update({
    where: { id },
    data: { customImageUrl: validateImageDataUrl(imageUrl) },
  });

  return toItemDTO(updated);
}

export async function deleteItem(userId: string, id: string) {
  const item = await prisma.item.findFirst({
    where: { id, userId },
  });

  if (!item) {
    throw new ItemNotFoundError();
  }

  try {
    const client = await getPluggyClientForUser(userId);
    await client.deleteItem(item.pluggyItemId).catch((err: any) => {
      console.warn("Aviso ao deletar item na Pluggy:", err?.message);
    });
  } catch (err) {
    console.warn("Erro ao comunicar exclusão com a Pluggy:", err);
  }

  await prisma.item.delete({
    where: { id },
  });

  return { success: true };
}

/**
 * A Pluggy devolve `primaryColor` ora com `#`, ora sem. Normalizamos para um hex
 * com `#` e descartamos qualquer coisa que não seja hex de 3 ou 6 dígitos.
 */
function normalizeHexColor(value?: string | null): string | null {
  if (!value) return null;
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return null;
  return `#${hex.toLowerCase()}`;
}

function mapItemStatus(status: string): ItemStatus {
  switch (status.toUpperCase()) {
    case "UPDATED":
      return ItemStatus.UPDATED;
    case "UPDATING":
      return ItemStatus.UPDATING;
    case "LOGIN_ERROR":
      return ItemStatus.LOGIN_ERROR;
    case "OUTDATED":
      return ItemStatus.OUTDATED;
    default:
      return ItemStatus.ERROR;
  }
}

/**
 * `type`/`subtype` chegam tipados pelo SDK, mas a Pluggy publica valores novos
 * antes de o SDK acompanhar (INVESTMENT é um deles) — por isso a comparação é
 * feita sobre a string crua.
 */
function mapAccountType(account: PluggyAccount): AccountType {
  const type = String(account.type ?? "").toUpperCase();
  const subtype = String(account.subtype ?? "").toUpperCase();

  if (type === "CREDIT" || subtype === "CREDIT_CARD") {
    return AccountType.CREDIT;
  }
  if (subtype === "SAVINGS_ACCOUNT") {
    return AccountType.SAVINGS;
  }
  if (type === "INVESTMENT" || subtype === "INVESTMENT_ACCOUNT") {
    return AccountType.INVESTMENT;
  }
  return AccountType.CHECKING;
}

/**
 * Resolve o item pelo par `(userId, pluggyItemId)`.
 *
 * A checagem é aqui, e não na rota, porque `pluggyItemId` é único **global**:
 * sincronizar por id sem conferir o dono reescrevia as contas do item alheio
 * com o `userId` de quem chamou — ou seja, puxava o extrato de outra pessoa
 * para dentro da própria conta.
 */
export async function getUserItem(userId: string, pluggyItemId: string): Promise<Item> {
  const item = await prisma.item.findFirst({ where: { userId, pluggyItemId } });
  if (!item) {
    throw new ItemNotFoundError();
  }
  return item;
}

/**
 * Quanto o sync volta no tempo além do que já tem.
 *
 * Trinta dias porque o que muda depois de gravado é lançamento pendente virando
 * efetivado, e isso acontece em dias, não em meses. Encurtar demais perderia
 * essas correções; alargar traz de volta o problema que a janela resolve.
 */
const JANELA_REVISITA_DIAS = 30;
const JANELA_REVISITA_MS = JANELA_REVISITA_DIAS * 24 * 60 * 60 * 1000;

/**
 * A data a partir da qual pedir o extrato à Pluggy, no formato `YYYY-MM-DD`.
 *
 * Dois casos, e o primeiro é o que dá teto ao trabalho:
 *
 * - **Conta nova**: só o mês corrente. Um extrato inteiro não tem tamanho
 *   conhecido — pode ser um mês ou cinco anos — e um primeiro sync sem teto é
 *   exatamente o que estoura o limite de tempo de uma função serverless. O
 *   preço é que a conexão nasce sabendo só o mês em que foi criada; o histórico
 *   anterior não vem, e não vem depois (a janela seguinte parte do que já
 *   existe).
 * - **Conta que já sincronizou**: trinta dias antes da transação mais recente.
 *   Nem tudo que muda é novo — lançamento pendente vira efetivado e muda valor
 *   e data dias depois de aparecer, e pedir só "o que veio depois da última"
 *   perderia essas correções.
 *
 * `agora` é injetável porque uma função que lê o relógio por dentro não tem
 * como ser testada na virada do mês.
 */
export function dataInicialDaBusca(
  maisRecente: Date | null | undefined,
  agora: Date = new Date()
): string {
  if (!maisRecente) {
    return new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
  }
  return new Date(maisRecente.getTime() - JANELA_REVISITA_MS).toISOString().slice(0, 10);
}

/** As linhas locais correspondentes a uma lista de ids da Pluggy, em lotes. */
async function buscarPorPluggyIds(pluggyIds: string[]) {
  return buscarEmLotes(pluggyIds, (lote) =>
    prisma.transaction.findMany({
      where: { pluggyTransactionId: { in: lote } },
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
    })
  );
}

/** Sincroniza um item **já resolvido**, do dono já conferido. */
export async function syncItem(item: SyncableItem): Promise<SyncResult> {
  const { userId, pluggyItemId } = item;
  const client = await getPluggyClientForUser(userId);

  // 1. Buscar item na Pluggy
  const pluggyItem = await client.fetchItem(pluggyItemId).catch((err: any) => {
    // A Pluggy responde 400/404 tanto para id malformado quanto para id que não
    // pertence a esta aplicação. Nos dois casos o que resolve é o mesmo — conferir
    // o que foi copiado — e a mensagem crua do SDK ("Invalid id, not an uuid") não
    // diz isso a quem está olhando o formulário.
    if (err?.code === 400 || err?.code === 404) {
      throw new UnprocessableError(
        "Não encontramos esta conexão na Pluggy. Confira se o id do item foi copiado inteiro, do painel da sua aplicação.",
        { details: err?.message }
      );
    }
    throw new UpstreamError(`Erro ao buscar Item na Pluggy: ${err?.message}`, {
      details: err?.message,
    });
  });

  const itemStatus = mapItemStatus(pluggyItem.status);

  // A Pluggy publica o logo e a cor da marca no conector. Guardamos ambos para
  // que o app não precise chamar a Pluggy só para desenhar o avatar da conta.
  const connectorName = pluggyItem.connector?.name ?? FALLBACK_INSTITUTION_NAME;
  const connectorImageUrl = pluggyItem.connector?.imageUrl ?? null;
  const connectorColor = normalizeHexColor(pluggyItem.connector?.primaryColor);

  // 2. Buscar contas da Pluggy
  const accountsResponse = await client.fetchAccounts(pluggyItemId).catch((err: any) => {
    throw new UpstreamError(`Erro ao buscar contas na Pluggy: ${err?.message}`, {
      details: err?.message,
    });
  });

  const institutionName = resolveItemInstitution(accountsResponse.results, connectorName);

  // 3. Atualizar o Item local. Note o `where: { id }` — nunca `pluggyItemId`,
  //    que é único global e não diz de quem o item é.
  const itemRecord = await prisma.item.update({
    where: { id: item.id },
    data: {
      institutionName,
      institutionImageUrl: connectorImageUrl,
      institutionColor: connectorColor,
      status: itemStatus,
      lastSyncedAt: new Date(),
    },
  });

  let accountsSynced = 0;
  let transactionsSynced = 0;
  const idsNovos: string[] = [];

  for (const pAccount of accountsResponse.results) {
    const accountInstitution = resolveAccountInstitution(pAccount, institutionName);

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

    accountsSynced++;

    // 5. Transações da conta, via cursor pagination (v2)
    //
    // Sempre com data inicial: antes pedia o extrato inteiro toda vez, o que
    // fazia o custo de sincronizar crescer para sempre junto com o histórico.
    // Ver `dataInicialDaBusca` para as duas janelas e o que cada uma custa.
    const maisRecente = await prisma.transaction.findFirst({
      where: { accountId: accountRecord.id },
      orderBy: { date: "desc" },
      select: { date: true },
    });

    const dateFrom = dataInicialDaBusca(maisRecente?.date);

    const transactions: PluggyTransaction[] = await client
      .fetchAllTransactions(pAccount.id, { dateFrom })
      .catch((err: any) => {
        console.warn(`Erro ao buscar transações da conta ${pAccount.id}:`, err?.message);
        return [] as PluggyTransaction[];
      });

    if (transactions.length === 0) continue;

    // O que já existe, com os campos que a Pluggy pode ter corrigido — para a
    // comparação abaixo distinguir "voltou dentro da janela" de "mudou".
    const existentes = await buscarPorPluggyIds(transactions.map((t) => t.id));
    const existentePorPluggyId = new Map(
      existentes.map((t) => [t.pluggyTransactionId!, t] as const)
    );

    const novas: Prisma.TransactionCreateManyInput[] = [];
    const alteracoes: Prisma.PrismaPromise<unknown>[] = [];

    for (const pTx of transactions) {
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

      const existente = existentePorPluggyId.get(pTx.id);

      if (!existente) {
        novas.push({ userId, pluggyTransactionId: pTx.id, isRecurring: false, ...campos });
        continue;
      }

      // Reescrever uma linha idêntica custa uma ida ao banco e não muda nada —
      // e, com a janela de revisita, quase tudo que volta é idêntico.
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

    // Uma ida ao banco por lote, e não uma por transação. Era o `await` dentro
    // do laço que fazia o primeiro sync levar minutos: cada upsert é um
    // ida-e-volta até o Neon, e eles aconteciam em fila.
    for (const lote of emLotes(novas)) {
      // `skipDuplicates` cobre a corrida com um sync simultâneo: quem perde a
      // corrida ignora a linha em vez de estourar no unique.
      await prisma.transaction.createMany({ data: lote, skipDuplicates: true });
    }

    for (const lote of emLotes(alteracoes)) {
      await prisma.$transaction(lote);
    }

    // O pipeline de revisão só deve rodar sobre o que é novo — reprocessar o
    // que já foi revisado ressuscitaria sugestões que o usuário já julgou.
    if (novas.length > 0) {
      const criadas = await buscarPorPluggyIds(novas.map((n) => n.pluggyTransactionId!));
      idsNovos.push(...criadas.map((t) => t.id));
    }

    transactionsSynced += transactions.length;
  }

  const review = await processNewTransactions(userId, idsNovos);

  return {
    item: toItemDTO(itemRecord),
    accountsSynced,
    transactionsSynced,
    review,
  };
}

/** Sincroniza um item do usuário a partir do id vindo da requisição. */
export async function syncUserItem(
  userId: string,
  pluggyItemId: string
): Promise<SyncResult> {
  return syncItem(await getUserItem(userId, pluggyItemId));
}

/**
 * Adiciona uma conexão a partir do id de item copiado do painel da Pluggy.
 *
 * O registro local é criado antes do sync — é ele que dá ao `syncItem` um item
 * com dono definido. Se a importação falhar, o registro é desfeito, para que o
 * usuário possa corrigir o id e tentar de novo em vez de esbarrar num "esta
 * conexão já está no app" que ele nunca chegou a ver funcionando.
 */
export async function addItemById(
  userId: string,
  pluggyItemId: string
): Promise<SyncResult> {
  const existing = await prisma.item.findUnique({
    where: { pluggyItemId },
    select: { userId: true, institutionName: true },
  });

  if (existing) {
    throw new ConflictError(
      existing.userId === userId
        ? `Esta conexão já está no app (${existing.institutionName}). Use "Sincronizar" para atualizá-la.`
        : "Este item já está conectado em outra conta do app."
    );
  }

  const created = await prisma.item.create({
    data: {
      userId,
      pluggyItemId,
      institutionName: FALLBACK_INSTITUTION_NAME,
      status: ItemStatus.UPDATING,
    },
  });

  try {
    return await syncItem(created);
  } catch (err) {
    // Só apaga se nada chegou a ser importado — desfazer o item depois de
    // gravar contas deixaria transações órfãs de conexão.
    const importedAccounts = await prisma.account.count({ where: { itemId: created.id } });
    if (importedAccounts === 0) {
      await prisma.item.delete({ where: { id: created.id } }).catch(() => undefined);
    }
    throw err;
  }
}

/** Sincroniza todas as conexões que o usuário cadastrou. */
export async function syncAllItems(userId: string): Promise<{
  itemsSynced: number;
  accountsSynced: number;
  transactionsSynced: number;
  review: ProcessResult;
}> {
  const items = await prisma.item.findMany({ where: { userId } });

  if (items.length === 0) {
    throw new UnprocessableError(
      "Nenhuma conexão cadastrada. Adicione o id do item pelo seu perfil."
    );
  }

  let totalAccounts = 0;
  let totalTransactions = 0;
  let itemsCount = 0;
  const totalReview: ProcessResult = { transfers: 0, suggested: 0, withoutGuess: 0 };

  for (const item of items) {
    try {
      const res = await syncItem(item);
      totalAccounts += res.accountsSynced;
      totalTransactions += res.transactionsSynced;
      totalReview.transfers += res.review.transfers;
      totalReview.suggested += res.review.suggested;
      totalReview.withoutGuess += res.review.withoutGuess;
      itemsCount++;
    } catch (err: any) {
      console.error(`Erro ao sincronizar item ${item.pluggyItemId}:`, err?.message || err);
    }
  }

  return {
    itemsSynced: itemsCount,
    accountsSynced: totalAccounts,
    transactionsSynced: totalTransactions,
    review: totalReview,
  };
}

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
