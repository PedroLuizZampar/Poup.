import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { formatTransactionDTO } from "./transactions.service";

/**
 * O apelido da conta é a razão de `customName` existir: o sync reescreve `name`
 * a cada atualização, e quem renomeou "Nubank" para "Cartão da casa" precisa ver
 * o apelido em toda tela, não só nas que lembraram de resolvê-lo.
 */
function transacaoCom(account: { name: string; customName: string | null }) {
  return {
    id: "tx-1",
    description: "Mercado",
    amount: new Prisma.Decimal(10),
    type: "EXPENSE" as const,
    date: new Date("2026-08-01T00:00:00.000Z"),
    note: null,
    isRecurring: false,
    accountId: "acc-1",
    account: { ...account, creditCardDueDay: null },
    categoryId: null,
    category: null,
    installmentIndex: null,
    installmentTotal: null,
    billMonth: null,
    competenceDate: new Date("2026-08-01T00:00:00.000Z"),
    purchaseKey: null,
    compensationId: null,
  };
}

describe("nome da conta no DTO da transação", () => {
  it("usa o apelido quando existe", () => {
    const dto = formatTransactionDTO(
      transacaoCom({ name: "Nubank", customName: "Cartão da casa" })
    );
    expect(dto.accountName).toBe("Cartão da casa");
  });

  it("cai no nome do banco quando não há apelido", () => {
    const dto = formatTransactionDTO(transacaoCom({ name: "Nubank", customName: null }));
    expect(dto.accountName).toBe("Nubank");
  });

  it("ignora apelido que é só espaço em branco", () => {
    const dto = formatTransactionDTO(transacaoCom({ name: "Nubank", customName: "   " }));
    expect(dto.accountName).toBe("Nubank");
  });

  it("carrega o dono, que é quem o filtro por pessoa usa", () => {
    const dto = formatTransactionDTO({
      ...transacaoCom({ name: "Nubank", customName: null }),
      userId: "bento",
    });
    expect(dto.ownerUserId).toBe("bento");
  });
});
