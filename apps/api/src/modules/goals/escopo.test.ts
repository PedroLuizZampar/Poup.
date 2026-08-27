import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

const goalFindMany = vi.fn();
const goalCreate = vi.fn();
const accountFindFirst = vi.fn();

vi.mock("../../prisma", () => ({
  prisma: {
    goal: { findMany: goalFindMany, create: goalCreate },
    account: { findFirst: accountFindFirst },
  },
}));

const { listGoals, createGoal } = await import("./goals.service");

const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

beforeEach(() => {
  goalFindMany.mockReset().mockResolvedValue([]);
  accountFindFirst.mockReset().mockResolvedValue({ id: "acc-1" });
  goalCreate.mockReset().mockResolvedValue({
    id: "meta-1",
    name: "Viagem",
    accountId: "acc-1",
    targetAmount: 1000,
    targetDate: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    account: { name: "Conta", customName: null, balance: 0 },
  });
});

describe("meta em espaço conjunto", () => {
  it("lista as metas do espaço, não as de um usuário", async () => {
    await listGoals(casal);
    expect(goalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { householdId: "casa-1" } })
    );
  });

  it("grava quem criou, para a dissolução saber com quem ela fica", async () => {
    await createGoal(casal, { name: "Viagem", accountId: "acc-1", targetAmount: 1000 });
    expect(goalCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ householdId: "casa-1", createdByUserId: "ana" }),
      })
    );
  });

  it("aceita conta de qualquer membro do espaço", async () => {
    await createGoal(casal, { name: "Viagem", accountId: "acc-1", targetAmount: 1000 });
    expect(accountFindFirst).toHaveBeenCalledWith({
      where: { id: "acc-1", userId: { in: ["ana", "bento"] } },
    });
  });
});
