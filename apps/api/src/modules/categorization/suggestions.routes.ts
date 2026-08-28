import { Router } from "express";
import { z } from "zod";
import {
  applySuggestions,
  countPendingSuggestions,
  dismissSuggestions,
  listPendingSuggestions,
} from "./suggestions.service";
import { requireAuth } from "../../middleware/requireAuth";
import { withScope } from "../../middleware/withScope";
import { asyncHandler } from "../../middleware/errorHandler";

export const suggestionsRouter = Router();

suggestionsRouter.use(requireAuth);
suggestionsRouter.use(withScope);

const applySchema = z.object({
  categoryId: z.string().min(1),
  // Lote vazio é legítimo: desmarcar tudo e confirmar é como se diz "nenhuma
  // destas é desta categoria", e o que sai daí são só recusas.
  acceptIds: z.array(z.string().min(1)).default([]),
  rejectIds: z.array(z.string().min(1)).default([]),
});

const dismissSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

suggestionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listPendingSuggestions(req.scope!));
  })
);

suggestionsRouter.get(
  "/count",
  asyncHandler(async (req, res) => {
    res.json({ count: await countPendingSuggestions(req.scope!) });
  })
);

// As duas respondem com a fila já recarregada: depois de aplicar um lote o
// servidor reavalia as pendentes, então a lista que o cliente tinha na mão
// envelheceu no mesmo instante em que ele a confirmou.
suggestionsRouter.post(
  "/apply",
  asyncHandler(async (req, res) => {
    res.json(await applySuggestions(req.scope!, applySchema.parse(req.body ?? {})));
  })
);

suggestionsRouter.post(
  "/dismiss",
  asyncHandler(async (req, res) => {
    const { ids } = dismissSchema.parse(req.body ?? {});
    res.json(await dismissSuggestions(req.scope!, ids));
  })
);
