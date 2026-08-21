import { prisma } from "../../prisma";
import type { AccountDTO } from "@poup/shared";
import { AccountNotFoundError } from "../../lib/errors";

export { AccountNotFoundError };

/**
 * O sync reescreve `name` a cada atualização a partir dos dados da Pluggy, então
 * o nome dado pelo usuário mora numa coluna própria e tem precedência.
 */
export function resolveAccountName(account: { name: string; customName: string | null }): string {
  return account.customName?.trim() || account.name;
}

export async function listAccounts(userId: string): Promise<AccountDTO[]> {
  const accounts = await prisma.account.findMany({
    where: { userId },
    include: { item: true },
    orderBy: [{ institutionName: "asc" }, { name: "asc" }],
  });

  return accounts.map((acc) => {
    const institution = acc.institutionName || acc.item?.institutionName || "Outros";
    return {
      id: acc.id,
      name: resolveAccountName(acc),
      originalName: acc.name,
      customName: acc.customName,
      type: acc.type,
      balance: Number(acc.balance),
      institution,
      institutionName: institution,
      institutionImageUrl: acc.item?.institutionImageUrl ?? null,
      customImageUrl: acc.item?.customImageUrl ?? null,
      itemId: acc.itemId,
      pluggyAccountId: acc.pluggyAccountId,
      lastSyncedAt: acc.lastSyncedAt?.toISOString() ?? null,
      excludedFromBalance: acc.excludedFromBalance,
    };
  });
}

export interface UpdateAccountInput {
  /** Vazio ou null remove o apelido e volta ao nome vindo do banco. */
  name?: string | null;
  excludedFromBalance?: boolean;
}

/** Os campos que o usuário edita numa conta. Ausente é "não mexa". */
export async function updateAccount(
  userId: string,
  id: string,
  input: UpdateAccountInput
): Promise<AccountDTO> {
  const existing = await prisma.account.findFirst({ where: { id, userId } });
  if (!existing) {
    throw new AccountNotFoundError();
  }

  await prisma.account.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { customName: input.name?.trim() || null }),
      ...(input.excludedFromBalance !== undefined && {
        excludedFromBalance: input.excludedFromBalance,
      }),
    },
  });

  const accounts = await listAccounts(userId);
  return accounts.find((a) => a.id === id)!;
}
