import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Scope } from "../../lib/scope";
import { splitHousehold } from "./split";

const userFindMany = vi.fn();
const userUpdate = vi.fn();
const householdCreate = vi.fn();
const householdDelete = vi.fn();
const categoryFindMany = vi.fn();
const categoryCreate = vi.fn();
const transactionUpdateMany = vi.fn();
const suggestionUpdateMany = vi.fn();
const budgetFindMany = vi.fn();
const budgetCreate = vi.fn();
const goalUpdateMany = vi.fn();

// Só a saída fala com estes — a dissolução em si não conhece quem pediu.
const userUpdateMany = vi.fn();
const notificationCreate = vi.fn();
const prismaUserFindUnique = vi.fn();
const prismaUserFindMany = vi.fn();
const prismaInviteFindMany = vi.fn();
const prismaTransaction = vi.fn(
  async (fn: (cliente: unknown) => Promise<unknown>, _opcoes?: unknown) => fn(txDaSaida())
);

vi.mock("../../prisma", () => ({
  prisma: {
    user: { findUnique: prismaUserFindUnique, findMany: prismaUserFindMany },
    householdInvite: { findMany: prismaInviteFindMany },
    $transaction: (...args: unknown[]) => (prismaTransaction as any)(...args),
  },
}));

const { leaveHousehold } = await import("./household.service");
const { UnprocessableError } = await import("../../lib/errors");

function tx() {
  return {
    user: { findMany: userFindMany, update: userUpdate },
    household: { create: householdCreate, delete: householdDelete },
    category: { findMany: categoryFindMany, create: categoryCreate },
    transaction: { updateMany: transactionUpdateMany },
    categorySuggestion: { updateMany: suggestionUpdateMany },
    budget: { findMany: budgetFindMany, create: budgetCreate },
    goal: { updateMany: goalUpdateMany },
  } as any;
}

/** O mesmo cliente da dissolução, mais o que só a saída escreve. */
function txDaSaida() {
  const cliente = tx();
  return {
    ...cliente,
    user: { ...cliente.user, updateMany: userUpdateMany },
    notification: { create: notificationCreate },
  } as any;
}

const casal: Scope = {
  userId: "ana",
  householdId: "casa-1",
  memberIds: ["ana", "bento"],
};

beforeEach(() => {
  [
    userFindMany, userUpdate, householdCreate, householdDelete, categoryFindMany,
    categoryCreate, transactionUpdateMany, suggestionUpdateMany, budgetFindMany,
    budgetCreate, goalUpdateMany,
  ].forEach((m) => m.mockReset());

  userFindMany.mockResolvedValue([{ id: "ana" }, { id: "bento" }]);
  categoryFindMany.mockResolvedValue([
    { id: "c-mercado", name: "Mercado", icon: "cart", colorKey: "4", kind: "VARIABLE", systemKey: null },
  ]);
  budgetFindMany.mockResolvedValue([]);
  goalUpdateMany.mockResolvedValue({ count: 0 });

  let n = 0;
  householdCreate.mockImplementation(async () => ({ id: `novo-${++n}` }));
  let c = 0;
  categoryCreate.mockImplementation(async ({ data }: any) => ({ ...data, id: `copia-${++c}` }));

  userUpdateMany.mockReset().mockResolvedValue({ count: 2 });
  notificationCreate.mockReset().mockResolvedValue({});
  prismaUserFindUnique.mockReset().mockResolvedValue({ householdId: "novo-1" });
  prismaUserFindMany.mockReset().mockResolvedValue([{ id: "ana", name: "Ana", avatarUrl: null }]);
  prismaInviteFindMany.mockReset().mockResolvedValue([]);
  prismaTransaction.mockClear();
});

describe("dissolução do espaço", () => {
  it("dá um espaço novo a cada membro", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(householdCreate).toHaveBeenCalledTimes(2);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "ana" },
      data: { householdId: "novo-1" },
    });
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "bento" },
      data: { householdId: "novo-2" },
    });
  });

  it("copia as categorias para cada um", async () => {
    await splitHousehold(tx(), "casa-1");
    expect(categoryCreate).toHaveBeenCalledTimes(2);
  });

  /** O ponto da dissolução: ninguém fica apontando para categoria de outro. */
  it("religa as transações de cada membro à cópia dele", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "ana", categoryId: "c-mercado" },
      data: { categoryId: "copia-1" },
    });
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "bento", categoryId: "c-mercado" },
      data: { categoryId: "copia-2" },
    });
  });

  it("religa as duas colunas de categoria da sugestão", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "ana", categoryId: "c-mercado" },
      data: { categoryId: "copia-1" },
    });
    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { userId: "ana", resolvedCategoryId: "c-mercado" },
      data: { resolvedCategoryId: "copia-1" },
    });
  });

  it("a meta vai para quem a criou", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(goalUpdateMany).toHaveBeenCalledWith({
      where: { householdId: "casa-1", createdByUserId: "ana" },
      data: { householdId: "novo-1" },
    });
  });

  it("apaga o espaço esvaziado no fim", async () => {
    await splitHousehold(tx(), "casa-1");
    expect(householdDelete).toHaveBeenCalledWith({ where: { id: "casa-1" } });
  });

  /**
   * O teto copiado tem de apontar para a **cópia**, e não para a original:
   * `Budget.category` é `onDelete: Cascade`, e um teto ainda preso à categoria
   * do casal iria junto na exclusão do espaço, calado.
   */
  it("copia o teto para a cópia da categoria, em Decimal", async () => {
    budgetFindMany.mockResolvedValue([
      { id: "b-1", categoryId: "c-mercado", monthlyLimit: new Prisma.Decimal("0.1") },
    ]);

    await splitHousehold(tx(), "casa-1");

    expect(budgetCreate).toHaveBeenCalledTimes(2);
    const primeiro = budgetCreate.mock.calls[0][0].data;
    expect(primeiro.householdId).toBe("novo-1");
    expect(primeiro.categoryId).toBe("copia-1");
    expect(primeiro.monthlyLimit).toBeInstanceOf(Prisma.Decimal);
    expect(primeiro.monthlyLimit.toString()).toBe("0.1");
  });

  /**
   * A meta vai por `createdByUserId`, mas a conta em que ela acumula pode ser do
   * outro — amarrar a meta à conta do parceiro é o caso de uso do espaço, não
   * uma exceção. Depois da dissolução essa conta está em outro espaço, e o
   * `assertAccountNoEspaco` das metas recusaria qualquer edição. Soltar a conta
   * põe a meta no estado órfão que o app já sabe mostrar ("Vincule uma conta").
   */
  it("solta a conta da meta que ficou do lado do outro", async () => {
    await splitHousehold(tx(), "casa-1");

    expect(goalUpdateMany).toHaveBeenCalledWith({
      where: { householdId: "novo-1", account: { is: { userId: { not: "ana" } } } },
      data: { accountId: null },
    });
  });

  /**
   * O risco número um da dissolução, e o único que nenhum outro teste pega.
   *
   * As categorias originais morrem na cascata de `Household`, e
   * `Transaction.categoryId` e as duas colunas de `CategorySuggestion` são
   * `ON DELETE SET NULL`: apagar o espaço antes de religar não dá erro nenhum —
   * só esvazia a categorização de todo mundo, sem registro do que era. E
   * `User.household` é Restrict, então ninguém pode ter ficado para trás.
   *
   * Subir o `household.delete` para o começo passa em todos os outros testes
   * deste arquivo. Só esta asserção falha.
   */
  it("religa tudo e move todo mundo antes de apagar o espaço", async () => {
    budgetFindMany.mockResolvedValue([
      { id: "b-1", categoryId: "c-mercado", monthlyLimit: new Prisma.Decimal(800) },
    ]);

    await splitHousehold(tx(), "casa-1");

    expect(householdDelete).toHaveBeenCalledTimes(1);
    const exclusao = householdDelete.mock.invocationCallOrder[0];

    // Nomeadas uma a uma porque são as que somem em silêncio.
    for (const ordem of transactionUpdateMany.mock.invocationCallOrder) {
      expect(ordem).toBeLessThan(exclusao);
    }
    for (const ordem of suggestionUpdateMany.mock.invocationCallOrder) {
      expect(ordem).toBeLessThan(exclusao);
    }
    // Restrict: o espaço não sai se ainda houver alguém apontando para ele.
    for (const ordem of userUpdate.mock.invocationCallOrder) {
      expect(ordem).toBeLessThan(exclusao);
    }

    // E, no geral: a exclusão é a última escrita da dissolução.
    const demais = [
      userFindMany, userUpdate, householdCreate, categoryFindMany, categoryCreate,
      transactionUpdateMany, suggestionUpdateMany, budgetFindMany, budgetCreate,
      goalUpdateMany,
    ].flatMap((m) => m.mock.invocationCallOrder);
    expect(Math.max(...demais)).toBeLessThan(exclusao);
  });
});

describe("sair da conta conjunta", () => {
  it("dissolve o espaço e avisa os dois", async () => {
    await leaveHousehold(casal);

    expect(householdCreate).toHaveBeenCalledTimes(2);
    expect(householdDelete).toHaveBeenCalledWith({ where: { id: "casa-1" } });
    expect(notificationCreate).toHaveBeenCalledTimes(2);
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "bento", title: "Conta conjunta desfeita" }),
    });
    expect(notificationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "ana", title: "Conta conjunta desfeita" }),
    });
  });

  it("recusa quem já está sozinho, sem abrir transação", async () => {
    const sozinha: Scope = { userId: "ana", householdId: "casa-ana", memberIds: ["ana"] };

    await expect(leaveHousehold(sozinha)).rejects.toBeInstanceOf(UnprocessableError);
    expect(prismaTransaction).not.toHaveBeenCalled();
  });

  /**
   * A guarda de verdade é uma escrita condicionada, e não a leitura de antes: o
   * `where` carrega o estado que torna a saída válida — o espaço ainda existe e
   * ainda tem mais de um membro — e é a primeira escrita da transação.
   */
  it("condiciona a saída ao espaço ainda povoado, antes de mexer em qualquer dado", async () => {
    await leaveHousehold(casal);

    expect(userUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { householdId: "casa-1" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(userUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      householdCreate.mock.invocationCallOrder[0]
    );
  });

  /**
   * Os dois clicam "sair" ao mesmo tempo. A primeira escrita das duas transações
   * é a mesma linha de usuário, então a segunda espera; quando ela reavalia o
   * `where`, os membros já mudaram de espaço e ela casa zero linhas. Só uma
   * dissolve.
   */
  it("quem perde a corrida não dissolve nada", async () => {
    userUpdateMany.mockResolvedValue({ count: 0 });

    await expect(leaveHousehold(casal)).rejects.toBeInstanceOf(UnprocessableError);

    expect(householdCreate).not.toHaveBeenCalled();
    expect(categoryFindMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(householdDelete).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  /** O teto padrão de 5 s do Prisma não cobre a dissolução — ver a constante. */
  it("abre a transação com folga de tempo explícita", async () => {
    await leaveHousehold(casal);

    expect(prismaTransaction.mock.calls[0][1]).toEqual({ timeout: 40_000, maxWait: 8_000 });
  });
});
