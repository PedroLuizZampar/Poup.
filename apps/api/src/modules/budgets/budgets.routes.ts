import { Router } from "express";
import { z } from "zod";
import { listBudgets, upsertBudget, deleteBudget } from "./budgets.service";
import { BudgetNotFoundError } from "../../lib/errors";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);

const upsertBudgetSchema = z.object({
  categoryId: z.string().min(1, "Categoria é obrigatória"),
  monthlyLimit: z.number().positive("Limite mensal deve ser maior que zero"),
});

const updateBudgetSchema = z.object({
  monthlyLimit: z.number().positive("Limite mensal deve ser maior que zero"),
});

budgetsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const month = typeof req.query.month === "string" ? req.query.month : undefined;
    const budgets = await listBudgets(req.userId!, month);
    res.json({ budgets });
  })
);

budgetsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { categoryId, monthlyLimit } = upsertBudgetSchema.parse(req.body);
    const budget = await upsertBudget(req.userId!, categoryId, monthlyLimit);
    res.status(201).json({ budget });
  })
);

budgetsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { monthlyLimit } = updateBudgetSchema.parse(req.body);

    // O orçamento é único por (usuário, categoria), então editar pelo id é
    // reescrever o limite daquela categoria.
    const existing = await listBudgets(req.userId!);
    const target = existing.find((b) => b.id === req.params.id);
    if (!target) {
      throw new BudgetNotFoundError();
    }

    const budget = await upsertBudget(req.userId!, target.categoryId, monthlyLimit);
    res.json({ budget });
  })
);

budgetsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteBudget(req.userId!, req.params.id);
    res.json({ success: true });
  })
);
