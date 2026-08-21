import { Router } from "express";
import { z } from "zod";
import { listAccounts, updateAccount } from "./accounts.service";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);

const updateAccountSchema = z.object({
  name: z.string().max(80, "Nome muito longo").nullable().optional(),
  excludedFromBalance: z.boolean().optional(),
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
