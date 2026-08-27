import { Router } from "express";
import { z } from "zod";
import { listGoals, getGoalById, createGoal, updateGoal, deleteGoal } from "./goals.service";
import { GoalNotFoundError } from "../../lib/errors";
import { requireAuth } from "../../middleware/requireAuth";
import { withScope } from "../../middleware/withScope";
import { asyncHandler } from "../../middleware/errorHandler";

export const goalsRouter = Router();

goalsRouter.use(requireAuth);
goalsRouter.use(withScope);

const createGoalSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório"),
  accountId: z.string().min(1, "Selecione a conta da meta"),
  targetAmount: z.number().positive("Valor alvo deve ser maior que zero"),
  targetDate: z.string().nullable().optional(),
});

const updateGoalSchema = z.object({
  name: z.string().trim().min(1).optional(),
  accountId: z.string().min(1).optional(),
  targetAmount: z.number().positive().optional(),
  targetDate: z.string().nullable().optional(),
});

goalsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const goals = await listGoals(req.userId!);
    res.json({ goals });
  })
);

goalsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const goal = await getGoalById(req.userId!, req.params.id);
    if (!goal) {
      throw new GoalNotFoundError();
    }
    res.json({ goal });
  })
);

goalsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const goal = await createGoal(req.userId!, createGoalSchema.parse(req.body));
    res.status(201).json({ goal });
  })
);

goalsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const goal = await updateGoal(req.userId!, req.params.id, updateGoalSchema.parse(req.body));
    res.json({ goal });
  })
);

goalsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteGoal(req.userId!, req.params.id);
    res.json({ success: true });
  })
);
