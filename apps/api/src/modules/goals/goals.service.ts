import { prisma } from "../../prisma";
import { Prisma } from "@prisma/client";
import type { GoalDTO } from "@poup/shared";
import type { Scope } from "../../lib/scope";
import { resolveAccountName } from "../accounts/accounts.service";
import { AccountNotFoundError, GoalNotFoundError } from "../../lib/errors";

export { GoalNotFoundError };

export interface CreateGoalInput {
  name: string;
  accountId: string;
  targetAmount: number;
  targetDate?: string | null;
}

export interface UpdateGoalInput {
  name?: string;
  accountId?: string;
  targetAmount?: number;
  targetDate?: string | null;
}

type GoalWithAccount = {
  id: string;
  name: string;
  accountId: string | null;
  targetAmount: Prisma.Decimal;
  targetDate: Date | null;
  createdAt: Date;
  /** Quem criou a meta — é o que a dissolução usa para decidir com quem ela fica. */
  createdByUserId: string;
  account: { name: string; customName: string | null; balance: Prisma.Decimal } | null;
};

function formatGoalDTO(goal: GoalWithAccount): GoalDTO {
  const targetAmount = Number(goal.targetAmount);

  // O acumulado é o saldo da conta vinculada. Contas de crédito podem ter saldo
  // negativo — nesse caso a meta fica em zero, não em progresso negativo.
  const currentAmount = goal.account
    ? Number(Math.max(0, Number(goal.account.balance)).toFixed(2))
    : 0;

  const progress = targetAmount > 0 ? Number(((currentAmount / targetAmount) * 100).toFixed(1)) : 0;
  const remainingAmount = Number(Math.max(0, targetAmount - currentAmount).toFixed(2));

  let monthlyPaceNeeded: number | null = null;
  if (goal.targetDate) {
    const now = new Date();
    const target = new Date(goal.targetDate);
    const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());

    if (months > 0 && remainingAmount > 0) {
      monthlyPaceNeeded = Number((remainingAmount / months).toFixed(2));
    } else if (months <= 0 && remainingAmount > 0) {
      monthlyPaceNeeded = remainingAmount;
    } else {
      monthlyPaceNeeded = 0;
    }
  }

  return {
    id: goal.id,
    name: goal.name,
    targetAmount,
    currentAmount,
    accountId: goal.accountId,
    accountName: goal.account ? resolveAccountName(goal.account) : null,
    targetDate: goal.targetDate?.toISOString() ?? null,
    progress,
    remainingAmount,
    monthlyPaceNeeded,
    createdAt: goal.createdAt.toISOString(),
  };
}

const goalInclude = {
  account: { select: { name: true, customName: true, balance: true } },
} as const;

// A conta pode ser do parceiro: amarrar a meta à conta dele é o caso de uso do
// espaço conjunto, não uma exceção. Por isso o filtro é por membro do espaço,
// não pelo dono do escopo.
async function assertAccountNoEspaco(scope: Scope, accountId: string) {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId: { in: scope.memberIds } },
  });
  if (!account) {
    throw new AccountNotFoundError();
  }
}

export async function listGoals(scope: Scope): Promise<GoalDTO[]> {
  const goals = await prisma.goal.findMany({
    where: { householdId: scope.householdId },
    include: goalInclude,
    orderBy: { createdAt: "asc" },
  });

  return goals.map(formatGoalDTO);
}

export async function getGoalById(scope: Scope, id: string): Promise<GoalDTO | null> {
  const goal = await prisma.goal.findFirst({
    where: { id, householdId: scope.householdId },
    include: goalInclude,
  });

  if (!goal) return null;
  return formatGoalDTO(goal);
}

export async function createGoal(scope: Scope, input: CreateGoalInput): Promise<GoalDTO> {
  await assertAccountNoEspaco(scope, input.accountId);

  const created = await prisma.goal.create({
    data: {
      householdId: scope.householdId,
      // Guardado para a dissolução (Task 15) saber com quem a meta fica —
      // accountId não serve porque é opcional e uma meta sem conta não teria
      // destino.
      createdByUserId: scope.userId,
      accountId: input.accountId,
      name: input.name.trim(),
      targetAmount: new Prisma.Decimal(input.targetAmount),
      targetDate: input.targetDate ? new Date(input.targetDate) : null,
    },
    include: goalInclude,
  });

  return formatGoalDTO(created);
}

export async function updateGoal(scope: Scope, id: string, input: UpdateGoalInput): Promise<GoalDTO> {
  const existing = await prisma.goal.findFirst({
    where: { id, householdId: scope.householdId },
  });
  if (!existing) {
    throw new GoalNotFoundError();
  }

  if (input.accountId !== undefined) {
    await assertAccountNoEspaco(scope, input.accountId);
  }

  const updated = await prisma.goal.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(input.accountId !== undefined && { accountId: input.accountId }),
      ...(input.targetAmount !== undefined && { targetAmount: new Prisma.Decimal(input.targetAmount) }),
      ...(input.targetDate !== undefined && { targetDate: input.targetDate ? new Date(input.targetDate) : null }),
    },
    include: goalInclude,
  });

  return formatGoalDTO(updated);
}

export async function deleteGoal(scope: Scope, id: string): Promise<{ success: true }> {
  const existing = await prisma.goal.findFirst({
    where: { id, householdId: scope.householdId },
  });
  if (!existing) {
    throw new GoalNotFoundError();
  }

  await prisma.goal.delete({
    where: { id },
  });

  return { success: true };
}
