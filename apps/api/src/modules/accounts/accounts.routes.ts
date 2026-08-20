import { Router } from "express";
import { z } from "zod";
import { listAccounts, renameAccount } from "./accounts.service";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const accountsRouter = Router();

accountsRouter.use(requireAuth);

const renameAccountSchema = z.object({
  name: z.string().max(80, "Nome muito longo").nullable(),
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
    const { name } = renameAccountSchema.parse(req.body);
    const account = await renameAccount(req.userId!, req.params.id, name);
    res.json({ account });
  })
);
