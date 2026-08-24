import { Router } from "express";
import { z } from "zod";
import { listAccounts, updateAccount } from "./accounts.service";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);

const accountTypeSchema = z.enum([
  "CHECKING",
  "SAVINGS",
  "CREDIT",
  "DEBIT_CARD",
  "INVESTMENT",
]);

const updateAccountSchema = z.object({
  name: z.string().max(80, "Nome muito longo").nullable().optional(),
  excludedFromBalance: z.boolean().optional(),
  customType: accountTypeSchema.nullable().optional(),
  // O zod valida a forma; se o campo e *obrigatorio* depende do tipo efetivo
  // depois do PATCH, que so a service conhece.
  creditCardDueDay: z
    .number()
    .int("O dia de vencimento tem de ser um número inteiro")
    .min(1, "O dia de vencimento vai de 1 a 31")
    .max(31, "O dia de vencimento vai de 1 a 31")
    .nullable()
    .optional(),
});

accountsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const accounts = await listAccounts(req.userId!);
    res.json({ accounts });
  })
);

accountsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const input = updateAccountSchema.parse(req.body);
    const account = await updateAccount(req.userId!, req.params.id, input);
    res.json({ account });
  })
);
