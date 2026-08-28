import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

/**
 * O alerta de orçamento é a única notificação que o app escreve sozinho, e o
 * orçamento é do casal: estourar o teto de mercado é notícia para os dois. A
 * linha, porém, é por pessoa — "lido" é por pessoa —, e é isso que este teste
 * trava.
 */

const notificationFindFirst = vi.fn();
const notificationCreate = vi.fn();
const listBudgets = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    notification: { findFirst: notificationFindFirst, create: notificationCreate },
  },
}));
vi.mock("../budgets/budgets.service", () => ({ listBudgets }));

const { generateAutomaticAlerts } = await import("./notifications.service");

const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

const estourado = {
  id: "orc-1",
  categoryId: "cat-1",
  categoryName: "Mercado",
  monthlyLimit: 800,
  spent: 950,
  percentage: 119,
  status: "exceeded",
};

beforeEach(() => {
  notificationFindFirst.mockReset().mockResolvedValue(null);
  notificationCreate.mockReset().mockResolvedValue({});
  listBudgets.mockReset().mockResolvedValue([estourado]);
});

describe("generateAutomaticAlerts", () => {
  it("grava uma notificação para cada membro do espaço", async () => {
    const criadas = await generateAutomaticAlerts(casal);

    expect(criadas).toBe(2);
    expect(notificationCreate.mock.calls.map((c) => c[0].data.userId)).toEqual(["ana", "bento"]);
  });

  it("o título e o corpo são os mesmos para os dois", async () => {
    await generateAutomaticAlerts(casal);

    const [ana, bento] = notificationCreate.mock.calls.map((c) => c[0].data);
    expect(ana.title).toBe("Orçamento estourado: Mercado");
    expect(bento.title).toBe(ana.title);
    expect(bento.body).toBe(ana.body);
    expect(bento.severity).toBe("ERROR");
  });

  it("deduplica por pessoa: quem já foi avisado não recebe de novo", async () => {
    // A janela de sete dias é por `(userId, título)`. Com uma linha por pessoa
    // ela continua correta — e é o que impede o aviso de um calar o do outro.
    notificationFindFirst.mockImplementation(async ({ where }: any) =>
      where.userId === "ana" ? { id: "ja-avisada" } : null
    );

    expect(await generateAutomaticAlerts(casal)).toBe(1);
    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate.mock.calls[0][0].data.userId).toBe("bento");
  });

  it("orçamento dentro do limite não vira notificação para ninguém", async () => {
    listBudgets.mockResolvedValue([{ ...estourado, status: "ok", spent: 100, percentage: 12 }]);

    expect(await generateAutomaticAlerts(casal)).toBe(0);
    expect(notificationCreate).not.toHaveBeenCalled();
  });
});
