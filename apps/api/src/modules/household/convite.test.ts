import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Scope } from "../../lib/scope";

const userFindFirst = vi.fn();
const userCount = vi.fn();
const userFindMany = vi.fn();
const inviteCreate = vi.fn();
const inviteFindMany = vi.fn();
const inviteFindFirst = vi.fn();
const inviteUpdateMany = vi.fn();
const notificationCreate = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    user: { findFirst: userFindFirst, count: userCount, findMany: userFindMany },
    householdInvite: {
      create: inviteCreate,
      findMany: inviteFindMany,
      findFirst: inviteFindFirst,
      updateMany: inviteUpdateMany,
    },
    notification: { create: notificationCreate },
  },
}));

const { inviteToHousehold, getHouseholdState, declineInvite, cancelInvite } = await import(
  "./household.service"
);
const { ConviteNaoEncontradoError } = await import("../../lib/errors");

const ana: Scope = { userId: "ana", householdId: "casa-ana", memberIds: ["ana"] };

beforeEach(() => {
  userFindFirst.mockReset();
  userCount.mockReset().mockResolvedValue(1);
  userFindMany.mockReset().mockResolvedValue([{ id: "ana", name: "Ana", avatarUrl: null }]);
  inviteFindMany.mockReset().mockResolvedValue([]);
  inviteFindFirst.mockReset().mockResolvedValue(null);
  inviteUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  inviteCreate.mockReset().mockResolvedValue({
    id: "conv-1",
    status: "PENDING",
    inviteeEmail: "bento@exemplo.com",
    createdAt: new Date("2026-08-27T00:00:00.000Z"),
    inviter: { id: "ana", name: "Ana", avatarUrl: null },
  });
  notificationCreate.mockReset().mockResolvedValue({});
});

describe("convite para a conta conjunta", () => {
  it("recusa e-mail sem conta no Poup", async () => {
    userFindFirst.mockResolvedValue(null);
    await expect(inviteToHousehold(ana, "ninguem@exemplo.com")).rejects.toThrow(
      /não encontramos ninguém com este e-mail/i
    );
  });

  it("recusa convidar a si mesmo", async () => {
    userFindFirst.mockResolvedValue({ id: "ana", householdId: "casa-ana" });
    await expect(inviteToHousehold(ana, "ana@exemplo.com")).rejects.toThrow(
      /a si mesmo/i
    );
  });

  it("recusa quem já está numa conta conjunta", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    userCount.mockResolvedValue(2);
    await expect(inviteToHousehold(ana, "bento@exemplo.com")).rejects.toThrow(
      /já faz parte de uma conta conjunta/i
    );
  });

  /**
   * A recusa simétrica da de `acceptInvite`: o produto é para duas pessoas, e
   * sem esta guarda um casal convidava uma terceira que entrava de verdade.
   */
  it("recusa convidar quando o meu espaço já tem duas pessoas", async () => {
    const casal: Scope = {
      userId: "ana",
      householdId: "casa-ana",
      memberIds: ["ana", "bento"],
    };
    await expect(inviteToHousehold(casal, "carla@exemplo.com")).rejects.toThrow(
      /sua conta conjunta já tem duas pessoas/i
    );
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(inviteCreate).not.toHaveBeenCalled();
  });

  it("compara o e-mail sem diferenciar maiúsculas", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    await inviteToHousehold(ana, "  BENTO@Exemplo.com  ");
    expect(userFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { equals: "bento@exemplo.com", mode: "insensitive" } },
      })
    );
  });

  it("avisa o convidado pelo sininho, com link para o perfil", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    await inviteToHousehold(ana, "bento@exemplo.com");
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "bento", link: "/perfil#conjunta" }),
      })
    );
  });

  it("recusa convidar quem já está no meu próprio espaço", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-ana" });
    await expect(inviteToHousehold(ana, "bento@exemplo.com")).rejects.toThrow(
      /já está na sua conta conjunta/i
    );
    expect(inviteCreate).not.toHaveBeenCalled();
  });

  /**
   * O convite duplicado é barrado pelo índice único parcial da migração, e não
   * por um `findFirst` — dois pedidos simultâneos passariam pelos dois lados de
   * uma checagem e criariam dois convites pendentes. Aqui o que se verifica é
   * que a violação do índice vira mensagem de usuário, e não 500.
   */
  it("traduz a colisão do índice único em recusa de convite já pendente", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    inviteCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    await expect(inviteToHousehold(ana, "bento@exemplo.com")).rejects.toThrow(
      /já existe um convite pendente/i
    );
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("não engole outros erros do banco", async () => {
    userFindFirst.mockResolvedValue({ id: "bento", householdId: "casa-bento" });
    inviteCreate.mockRejectedValue(new Error("conexão caiu"));

    await expect(inviteToHousehold(ana, "bento@exemplo.com")).rejects.toThrow(
      /conexão caiu/
    );
  });
});

describe("estado do espaço", () => {
  /**
   * Os dois `where` abaixo já foram escritos errados uma vez e revertidos. Por
   * isso a asserção é sobre o objeto inteiro, e não `objectContaining`: uma
   * chave a mais aqui é exatamente o bug que voltaria calado.
   */
  it("busca os convites recebidos por convidado, nunca pelo meu espaço", async () => {
    await getHouseholdState(ana);
    expect(inviteFindMany.mock.calls[0][0].where).toEqual({
      inviteeId: "ana",
      status: "PENDING",
    });
    // `householdId` no convite é o espaço de quem convidou; o convidado mora em
    // outro. Filtrar por ele aqui devolveria sempre lista vazia.
    expect(inviteFindMany.mock.calls[0][0].where).not.toHaveProperty("householdId");
  });

  it("busca os convites enviados pelo espaço inteiro, não por quem enviou", async () => {
    await getHouseholdState(ana);
    expect(inviteFindMany.mock.calls[1][0].where).toEqual({
      householdId: "casa-ana",
      status: "PENDING",
    });
    expect(inviteFindMany.mock.calls[1][0].where).not.toHaveProperty("inviterId");
  });

  it("lista os membros do meu espaço", async () => {
    const estado = await getHouseholdState(ana);
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "casa-ana" } })
    );
    expect(estado).toMatchObject({ id: "casa-ana", members: [{ id: "ana" }] });
  });

  it("devolve listas vazias para quem está sozinho no espaço", async () => {
    const estado = await getHouseholdState(ana);
    expect(estado.invitesReceived).toEqual([]);
    expect(estado.invitesSent).toEqual([]);
  });
});

describe("recusar convite", () => {
  it("recusa convite que não é meu", async () => {
    inviteFindFirst.mockResolvedValue(null);
    await expect(declineInvite(ana, "conv-de-outro")).rejects.toBeInstanceOf(
      ConviteNaoEncontradoError
    );
    expect(inviteFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-de-outro", inviteeId: "ana", status: "PENDING" },
      })
    );
    expect(inviteUpdateMany).not.toHaveBeenCalled();
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it("escreve com o status na condição, para o banco decidir a corrida", async () => {
    inviteFindFirst.mockResolvedValue({ inviterId: "bento", inviteeEmail: "ana@exemplo.com" });
    await declineInvite(ana, "conv-1");
    expect(inviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1", inviteeId: "ana", status: "PENDING" },
      })
    );
    expect(notificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "bento" }) })
    );
  });

  /** Perdeu a corrida para um cancelamento: nada foi recusado, ninguém é avisado. */
  it("falha sem notificar quando a escrita não casa nenhuma linha", async () => {
    inviteFindFirst.mockResolvedValue({ inviterId: "bento", inviteeEmail: "ana@exemplo.com" });
    inviteUpdateMany.mockResolvedValue({ count: 0 });
    await expect(declineInvite(ana, "conv-1")).rejects.toBeInstanceOf(ConviteNaoEncontradoError);
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});

describe("cancelar convite", () => {
  it("só alcança convite pendente do meu próprio espaço", async () => {
    await cancelInvite(ana, "conv-1");
    expect(inviteUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1", householdId: "casa-ana", status: "PENDING" },
      })
    );
  });

  it("falha quando o convite é de outro espaço ou já não está pendente", async () => {
    inviteUpdateMany.mockResolvedValue({ count: 0 });
    await expect(cancelInvite(ana, "conv-de-outra-casa")).rejects.toBeInstanceOf(
      ConviteNaoEncontradoError
    );
  });
});
