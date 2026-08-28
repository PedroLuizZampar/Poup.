import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import type { Scope } from "../../lib/scope";

const userFindFirst = vi.fn();
const userCount = vi.fn();
const inviteCreate = vi.fn();
const notificationCreate = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    user: { findFirst: userFindFirst, count: userCount },
    householdInvite: { create: inviteCreate },
    notification: { create: notificationCreate },
  },
}));

const { inviteToHousehold } = await import("./household.service");

const ana: Scope = { userId: "ana", householdId: "casa-ana", memberIds: ["ana"] };

beforeEach(() => {
  userFindFirst.mockReset();
  userCount.mockReset().mockResolvedValue(1);
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
