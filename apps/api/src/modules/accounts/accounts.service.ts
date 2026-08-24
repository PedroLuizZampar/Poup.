import { prisma } from "../../prisma";
import type { AccountDTO, AccountType } from "@poup/shared";
import { AccountNotFoundError, UnprocessableError } from "../../lib/errors";

export { AccountNotFoundError };

/**
 * O sync reescreve `name` a cada atualização a partir dos dados da Pluggy, então
 * o nome dado pelo usuário mora numa coluna própria e tem precedência.
 */
export function resolveAccountName(account: { name: string; customName: string | null }): string {
  return account.customName?.trim() || account.name;
}

/**
 * O tipo que vale na tela. Mesma divisao do nome: o sync reescreve `type` a
 * cada atualizacao, entao a escolha do usuario mora em `customType` e ganha.
 *
 * E o unico caminho ate `DEBIT_CARD` — a Pluggy nunca devolve esse tipo.
 */
export function resolveAccountType(account: {
  type: AccountType;
  customType: AccountType | null;
}): AccountType {
  return account.customType ?? account.type;
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
      type: resolveAccountType(acc),
      originalType: acc.type,
      customType: acc.customType,
      creditCardDueDay: acc.creditCardDueDay,
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
  /** Null volta ao tipo que a Pluggy derivou. */
  customType?: AccountType | null;
  creditCardDueDay?: number | null;
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

  // O tipo efetivo **depois** deste PATCH — ele e quem decide se o dia de
  // vencimento e obrigatorio, e ele depende de duas colunas. E por isso que
  // esta regra vive aqui e nao no zod: o schema nao ve o que ja esta no banco.
  const tipoEfetivo =
    input.customType !== undefined
      ? (input.customType ?? existing.type)
      : resolveAccountType(existing);

  const diaEfetivo =
    input.creditCardDueDay !== undefined ? input.creditCardDueDay : existing.creditCardDueDay;

  if (tipoEfetivo === "CREDIT" && diaEfetivo == null) {
    throw new UnprocessableError(
      "Informe o dia de vencimento da fatura (1 a 31) para uma conta de cartão de crédito."
    );
  }

  await prisma.account.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { customName: input.name?.trim() || null }),
      ...(input.excludedFromBalance !== undefined && {
        excludedFromBalance: input.excludedFromBalance,
      }),
      ...(input.customType !== undefined && { customType: input.customType }),
      // O dia sobrevive a uma troca de tipo: quem volta para cartao de credito
      // reencontra o que tinha cadastrado, em vez de digitar de novo.
      ...(input.creditCardDueDay !== undefined && {
        creditCardDueDay: input.creditCardDueDay,
      }),
    },
  });

  const accounts = await listAccounts(userId);
  return accounts.find((a) => a.id === id)!;
}
