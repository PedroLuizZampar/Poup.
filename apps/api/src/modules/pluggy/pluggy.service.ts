import type { Account as PluggyAccount, Transaction as PluggyTransaction } from "pluggy-sdk";
import { getPluggyClientForUser } from "../../lib/pluggy";
import { prisma } from "../../prisma";
import { ItemStatus, AccountType, TransactionType, Prisma, type Item } from "@prisma/client";
import type { ItemDTO, SyncItemResponse } from "@poup/shared";
import { validateImageDataUrl } from "../../lib/imageDataUrl";
import {
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

    const accountRecord = await prisma.account.upsert({
      where: { pluggyAccountId: pAccount.id },
      update: {
        name: formatAccountName(pAccount, accountInstitution),
        type: mapAccountType(pAccount),
        balance: new Prisma.Decimal(pAccount.balance ?? 0),
        institutionName: accountInstitution,
        itemId: itemRecord.id,
        lastSyncedAt: new Date(),
      },
      create: {
        userId,
        itemId: itemRecord.id,
        pluggyAccountId: pAccount.id,
        name: formatAccountName(pAccount, accountInstitution),
        type: mapAccountType(pAccount),
        balance: new Prisma.Decimal(pAccount.balance ?? 0),
        institutionName: accountInstitution,
        lastSyncedAt: new Date(),
      },
    });

    accountsSynced++;

    // 5. Transações da conta, via cursor pagination (v2)
    const transactions: PluggyTransaction[] = await client
      .fetchAllTransactions(pAccount.id)
      .catch((err: any) => {
        console.warn(`Erro ao buscar transações da conta ${pAccount.id}:`, err?.message);
        return [] as PluggyTransaction[];
      });

    // O upsert não diz se criou ou atualizou, e o pipeline só deve rodar sobre
    // o que é novo — reprocessar o que já foi revisado ressuscitaria sugestões
    // que o usuário já julgou.
    const idsRemotos = transactions.map((t) => t.id);
    const jaExistentes = new Set(
      (
        await prisma.transaction.findMany({
          where: { pluggyTransactionId: { in: idsRemotos } },
          select: { pluggyTransactionId: true },
        })
      ).map((t) => t.pluggyTransactionId!)
    );

    for (const pTx of transactions) {
      const rawAmount = pTx.amount ?? 0;
      const isExpense = pTx.type === "DEBIT" || rawAmount < 0;
      const description = (pTx.description || pTx.descriptionRaw || "Transação sem descrição").trim();

      // Deduplicação por pluggyTransactionId
      const saved = await prisma.transaction.upsert({
        where: { pluggyTransactionId: pTx.id },
        update: {
          description,
          amount: new Prisma.Decimal(Math.abs(rawAmount)),
          type: isExpense ? TransactionType.EXPENSE : TransactionType.INCOME,
          date: new Date(pTx.date),
          accountId: accountRecord.id,
        },
        create: {
          userId,
          accountId: accountRecord.id,
          pluggyTransactionId: pTx.id,
          description,
          amount: new Prisma.Decimal(Math.abs(rawAmount)),
          type: isExpense ? TransactionType.EXPENSE : TransactionType.INCOME,
          date: new Date(pTx.date),
          isRecurring: false,
        },
        select: { id: true },
      });

      if (!jaExistentes.has(pTx.id)) {
        idsNovos.push(saved.id);
      }

      transactionsSynced++;
    }
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
): Promise<SyncItemResponse> {
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
