import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Scope } from "../../lib/scope";
import { mergeHouseholds } from "./merge";

const categoryFindMany = vi.fn();
const categoryUpdate = vi.fn();
const categoryDelete = vi.fn();
const transactionUpdateMany = vi.fn();
const suggestionUpdateMany = vi.fn();
const budgetFindMany = vi.fn();
const budgetUpdate = vi.fn();
const budgetDelete = vi.fn();
const goalUpdateMany = vi.fn();
const inviteUpdateMany = vi.fn();

// Só o aceite fala com estes — a fusão em si não conhece usuário nem espaço.
const inviteFindFirst = vi.fn();
const inviteFindMany = vi.fn();
const userCount = vi.fn();
const userUpdate = vi.fn();
const userFindUnique = vi.fn();
const userFindMany = vi.fn();
const householdDelete = vi.fn();
const notificationCreate = vi.fn();
const prismaTransaction = vi.fn(
  async (fn: (cliente: unknown) => Promise<unknown>, _opcoes?: unknown) => fn(txDoAceite())
);

vi.mock("../../prisma", () => ({
  prisma: {
    householdInvite: { findFirst: inviteFindFirst, findMany: inviteFindMany },
    user: {
      count: userCount,
      update: userUpdate,
      findUnique: userFindUnique,
      findMany: userFindMany,
    },
    $transaction: (...args: unknown[]) => (prismaTransaction as any)(...args),
  },
}));

const { acceptInvite } = await import("./household.service");
const { ConviteNaoEncontradoError } = await import("../../lib/errors");

function tx() {
  return {
    category: { findMany: categoryFindMany, update: categoryUpdate, delete: categoryDelete },
    transaction: { updateMany: transactionUpdateMany },
    categorySuggestion: { updateMany: suggestionUpdateMany },
    budget: { findMany: budgetFindMany, update: budgetUpdate, delete: budgetDelete },
    goal: { updateMany: goalUpdateMany },
    // A fusão também encerra os convites que o espaço absorvido tinha em aberto.
    householdInvite: { updateMany: inviteUpdateMany },
  } as any;
}

/** O mesmo cliente da fusão, mais o que só o aceite escreve. */
function txDoAceite() {
  return {
    ...tx(),
    user: { update: userUpdate },
    household: { delete: householdDelete },
    notification: { create: notificationCreate },
  } as any;
}

const cat = (over: Partial<Record<string, unknown>>) => ({
  id: "c",
  householdId: "destino",
  name: "Mercado",
  systemKey: null,
  ...over,
});

const ana: Scope = { userId: "ana", householdId: "casa-ana", memberIds: ["ana"] };

const convitePendente = {
  id: "conv-1",
  householdId: "casa-bento",
  inviterId: "bento",
  inviteeEmail: "ana@exemplo.com",
};

beforeEach(() => {
  [
    categoryFindMany, categoryUpdate, categoryDelete, transactionUpdateMany,
    suggestionUpdateMany, budgetFindMany, budgetUpdate, budgetDelete, goalUpdateMany,
  ].forEach((m) => m.mockReset());
  budgetFindMany.mockResolvedValue([]);
  goalUpdateMany.mockResolvedValue({ count: 0 });
  inviteUpdateMany.mockReset().mockResolvedValue({ count: 1 });

  inviteFindFirst.mockReset().mockResolvedValue(convitePendente);
  inviteFindMany.mockReset().mockResolvedValue([]);
  userCount.mockReset().mockResolvedValue(1);
  userUpdate.mockReset().mockResolvedValue({});
  userFindUnique.mockReset().mockResolvedValue({ householdId: "casa-bento" });
  userFindMany.mockReset().mockResolvedValue([
    { id: "bento", name: "Bento", avatarUrl: null },
    { id: "ana", name: "Ana", avatarUrl: null },
  ]);
  householdDelete.mockReset().mockResolvedValue({});
  notificationCreate.mockReset().mockResolvedValue({});
  prismaTransaction.mockClear();
});

describe("fusão de espaços", () => {
  it("funde homônimos e remapeia as transações do que foi absorvido", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado", name: "Mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem", name: "  mercádo " })]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "o-mercado" },
      data: { categoryId: "d-mercado" },
    });
    expect(categoryDelete).toHaveBeenCalledWith({ where: { id: "o-mercado" } });
  });

  it("remapeia as duas colunas de categoria da sugestão", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem" })]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "o-mercado" },
      data: { categoryId: "d-mercado" },
    });
    expect(suggestionUpdateMany).toHaveBeenCalledWith({
      where: { resolvedCategoryId: "o-mercado" },
      data: { resolvedCategoryId: "d-mercado" },
    });
  });

  it("casa as categorias de sistema pela chave, mesmo renomeadas", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-sem", name: "Sem categoria", systemKey: "UNCATEGORIZED" })])
      .mockResolvedValueOnce([
        cat({ id: "o-sem", householdId: "origem", name: "A classificar", systemKey: "UNCATEGORIZED" }),
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { categoryId: "o-sem" },
      data: { categoryId: "d-sem" },
    });
  });

  it("move inteira a categoria que não tem par", async () => {
    categoryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cat({ id: "o-pet", householdId: "origem", name: "Pet" })]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: "o-pet" },
      data: { householdId: "destino", name: "Pet" },
    });
    expect(categoryDelete).not.toHaveBeenCalled();
  });

  it("desempata nome que colide sem ter casado", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-sem", name: "Sem categoria", systemKey: "UNCATEGORIZED" })])
      .mockResolvedValueOnce([
        cat({ id: "o-sem", householdId: "origem", name: "Sem categoria", systemKey: null }),
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: "o-sem" },
      data: { householdId: "destino", name: "Sem categoria (2)" },
    });
  });

  it("soma os limites quando os dois orçam a mesma categoria", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem" })]);
    budgetFindMany
      .mockResolvedValueOnce([
        { id: "b-d", categoryId: "d-mercado", monthlyLimit: new Prisma.Decimal(800) },
      ])
      .mockResolvedValueOnce([
        { id: "b-o", categoryId: "o-mercado", monthlyLimit: new Prisma.Decimal(400) },
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(budgetUpdate).toHaveBeenCalledWith({
      where: { id: "b-d" },
      data: { monthlyLimit: new Prisma.Decimal(1200) },
    });
    expect(budgetDelete).toHaveBeenCalledWith({ where: { id: "b-o" } });
  });

  it("leva as metas inteiras", async () => {
    categoryFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await mergeHouseholds(tx(), "origem", "destino");

    // O objeto inteiro, e não `objectContaining`: `createdByUserId` fora do
    // `data` é o que permite à dissolução devolver cada meta a quem a criou.
    expect(goalUpdateMany).toHaveBeenCalledWith({
      where: { householdId: "origem" },
      data: { householdId: "destino" },
    });
  });

  /**
   * `Budget.category` é `onDelete: Cascade`. Excluir a categoria absorvida antes
   * de fundir os tetos levaria junto o orçamento da origem — sem erro nenhum, e
   * a soma perderia a parcela. É a ordem, e não o cálculo, que guarda o dinheiro.
   */
  it("funde os orçamentos antes de excluir a categoria absorvida", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem" })]);
    budgetFindMany
      .mockResolvedValueOnce([
        { id: "b-d", categoryId: "d-mercado", monthlyLimit: new Prisma.Decimal(800) },
      ])
      .mockResolvedValueOnce([
        { id: "b-o", categoryId: "o-mercado", monthlyLimit: new Prisma.Decimal(400) },
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(budgetFindMany.mock.invocationCallOrder[1]).toBeLessThan(
      categoryDelete.mock.invocationCallOrder[0]
    );
    expect(budgetUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      categoryDelete.mock.invocationCallOrder[0]
    );
    expect(budgetDelete.mock.invocationCallOrder[0]).toBeLessThan(
      categoryDelete.mock.invocationCallOrder[0]
    );
  });

  it("soma os tetos em Decimal, e não em ponto flutuante", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado" })])
      .mockResolvedValueOnce([cat({ id: "o-mercado", householdId: "origem" })]);
    budgetFindMany
      .mockResolvedValueOnce([
        { id: "b-d", categoryId: "d-mercado", monthlyLimit: new Prisma.Decimal("0.1") },
      ])
      .mockResolvedValueOnce([
        { id: "b-o", categoryId: "o-mercado", monthlyLimit: new Prisma.Decimal("0.2") },
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    const somado = budgetUpdate.mock.calls[0][0].data.monthlyLimit;
    expect(somado).toBeInstanceOf(Prisma.Decimal);
    // 0.1 + 0.2 em ponto flutuante dá 0.30000000000000004.
    expect(somado.equals(new Prisma.Decimal("0.3"))).toBe(true);
  });

  it("leva o teto da categoria que só mudou de espaço", async () => {
    categoryFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([cat({ id: "o-pet", householdId: "origem", name: "Pet" })]);
    budgetFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "b-o", categoryId: "o-pet", monthlyLimit: new Prisma.Decimal(300) },
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(budgetUpdate).toHaveBeenCalledWith({
      where: { id: "b-o" },
      data: { householdId: "destino", categoryId: "o-pet" },
    });
    expect(budgetDelete).not.toHaveBeenCalled();
  });

  /**
   * Duas categorias da origem que caem na mesma do destino somam as duas
   * parcelas. Somar direto no banco a cada volta usaria sempre o valor lido no
   * início, e a segunda soma apagaria a primeira.
   */
  it("acumula as duas parcelas quando dois tetos da origem caem na mesma categoria", async () => {
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-mercado", name: "Mercado" })])
      .mockResolvedValueOnce([
        cat({ id: "o-mercado", householdId: "origem", name: "Mercado" }),
        cat({ id: "o-mercado2", householdId: "origem", name: "mercado" }),
      ]);
    budgetFindMany
      .mockResolvedValueOnce([
        { id: "b-d", categoryId: "d-mercado", monthlyLimit: new Prisma.Decimal(800) },
      ])
      .mockResolvedValueOnce([
        { id: "b-o", categoryId: "o-mercado", monthlyLimit: new Prisma.Decimal(400) },
        { id: "b-o2", categoryId: "o-mercado2", monthlyLimit: new Prisma.Decimal(100) },
      ]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(budgetUpdate).toHaveBeenCalledTimes(1);
    expect(budgetUpdate).toHaveBeenCalledWith({
      where: { id: "b-d" },
      data: { monthlyLimit: new Prisma.Decimal(1300) },
    });
    expect(budgetDelete).toHaveBeenCalledWith({ where: { id: "b-o" } });
    expect(budgetDelete).toHaveBeenCalledWith({ where: { id: "b-o2" } });
  });

  /**
   * `normalizeCategoryName` devolve "" para um nome feito só de acentos soltos.
   * Casá-los fundiria o dinheiro de duas categorias sem relação nenhuma — e sem
   * desfazer.
   */
  it("não casa dois nomes que normalizam para vazio", async () => {
    // Escritos por código pela mesma razão que em `normalizeCategoryName`: o
    // teste não pode depender de como o editor salva um acento solto.
    const agudo = String.fromCharCode(0x0301);
    const til = String.fromCharCode(0x0303);
    categoryFindMany
      .mockResolvedValueOnce([cat({ id: "d-acento", name: agudo })])
      .mockResolvedValueOnce([cat({ id: "o-acento", householdId: "origem", name: til })]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(categoryDelete).not.toHaveBeenCalled();
    expect(transactionUpdateMany).not.toHaveBeenCalled();
    expect(categoryUpdate).toHaveBeenCalledWith({
      where: { id: "o-acento" },
      data: { householdId: "destino", name: til },
    });
  });

  /**
   * Depois da fusão nenhum usuário carrega o `householdId` da origem: os
   * convites que ela enviou sumiriam de `invitesSent` — ninguém conseguiria
   * cancelá-los — e continuariam pendentes na tela de quem recebeu.
   */
  it("cancela os convites em aberto do espaço absorvido", async () => {
    categoryFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await mergeHouseholds(tx(), "origem", "destino");

    expect(inviteUpdateMany).toHaveBeenCalledWith({
      where: { householdId: "origem", status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: expect.any(Date) },
    });
  });
});

describe("aceitar o convite", () => {
  function semCategorias() {
    categoryFindMany.mockResolvedValue([]);
  }

  it("recusa convite que não é meu, sem abrir transação", async () => {
    inviteFindFirst.mockResolvedValue(null);

    await expect(acceptInvite(ana, "conv-de-outro")).rejects.toBeInstanceOf(
      ConviteNaoEncontradoError
    );
    expect(prismaTransaction).not.toHaveBeenCalled();
  });

  it("recusa quem já divide o espaço com outra pessoa", async () => {
    userCount.mockResolvedValue(2);

    await expect(acceptInvite(ana, "conv-1")).rejects.toThrow(/saia da sua conta conjunta/i);
    expect(prismaTransaction).not.toHaveBeenCalled();
  });

  /**
   * O `status: "PENDING"` viaja dentro do `updateMany`, e não fica só na leitura
   * anterior. É a primeira escrita da transação, antes de qualquer movimento de
   * categoria: quem chega depois de um cancelamento casa zero linhas e a
   * transação inteira volta atrás.
   */
  it("condiciona o aceite ao PENDING e escreve isso antes de mexer em qualquer dado", async () => {
    semCategorias();

    await acceptInvite(ana, "conv-1");

    expect(inviteUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "conv-1", inviteeId: "ana", status: "PENDING" },
      data: { status: "ACCEPTED", respondedAt: expect.any(Date) },
    });
    expect(inviteUpdateMany.mock.invocationCallOrder[0]).toBeLessThan(
      categoryFindMany.mock.invocationCallOrder[0]
    );
  });

  it("não move nada quando o convite deixou de estar pendente entre a leitura e a transação", async () => {
    semCategorias();
    inviteUpdateMany.mockResolvedValueOnce({ count: 0 });

    await expect(acceptInvite(ana, "conv-1")).rejects.toBeInstanceOf(ConviteNaoEncontradoError);

    expect(categoryFindMany).not.toHaveBeenCalled();
    expect(goalUpdateMany).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
    expect(householdDelete).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
    // Nenhuma outra escrita de convite: a única chamada é a guarda que falhou.
    expect(inviteUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("muda o meu espaço, apaga o que esvaziei e avisa quem convidou", async () => {
    semCategorias();

    await acceptInvite(ana, "conv-1");

    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "ana" },
      data: { householdId: "casa-bento" },
    });
    expect(householdDelete).toHaveBeenCalledWith({ where: { id: "casa-ana" } });
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "bento", link: "/perfil#conjunta" }),
      })
    );
  });

  /**
   * Os convites que eu recebi de terceiros vivem sob o `householdId` deles, e
   * não morrem na cascata do espaço que estou deixando. O cancelamento vem
   * depois da guarda, ou apagaria o ACCEPTED que ela acabou de escrever.
   */
  it("cancela os outros convites que eu tinha em aberto, depois de marcar o aceite", async () => {
    semCategorias();

    await acceptInvite(ana, "conv-1");

    const cancelamento = inviteUpdateMany.mock.calls.findIndex(
      ([arg]) => arg.where.inviteeId === "ana" && arg.where.status === "PENDING" && !arg.where.id
    );
    expect(cancelamento).toBeGreaterThan(0);
    expect(inviteUpdateMany.mock.calls[cancelamento][0].data).toEqual({
      status: "CANCELLED",
      respondedAt: expect.any(Date),
    });
  });

  /**
   * A fusão é uma sequência longa de idas ao banco — quatro por categoria
   * absorvida — contra um Neon remoto. Com o teto padrão de 5 s do Prisma ela
   * estouraria no meio, e uma fusão pela metade não tem desfazer.
   */
  it("dá à transação um teto de tempo maior que o padrão de 5 s do Prisma", async () => {
    semCategorias();

    await acceptInvite(ana, "conv-1");

    const opcoes = prismaTransaction.mock.calls[0][1] as { timeout: number; maxWait: number };
    expect(opcoes.timeout).toBeGreaterThan(5_000);
    // Ainda bem abaixo do teto de 60 s da função da Vercel, somado ao maxWait.
    expect(opcoes.timeout + opcoes.maxWait).toBeLessThan(45_000);
  });

  it("devolve o estado já do espaço novo", async () => {
    semCategorias();

    const estado = await acceptInvite(ana, "conv-1");

    expect(estado.id).toBe("casa-bento");
    expect(estado.members.map((m) => m.id)).toEqual(["bento", "ana"]);
  });
});
