import { Router } from "express";
import { z } from "zod";
import {
  acceptSuggestion,
  countPendingSuggestions,
  dismissSuggestion,
  listPendingSuggestions,
} from "./suggestions.service";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const suggestionsRouter = Router();

suggestionsRouter.use(requireAuth);

const acceptSchema = z.object({
  categoryId: z.string().min(1).optional(),
});

suggestionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(await listPendingSuggestions(req.userId!));
  })
);

suggestionsRouter.get(
  "/count",
  asyncHandler(async (req, res) => {
    res.json({ count: await countPendingSuggestions(req.userId!) });
  })
);

suggestionsRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const { categoryId } = acceptSchema.parse(req.body ?? {});
    res.json(await acceptSuggestion(req.userId!, req.params.id, categoryId));
  })
);

suggestionsRouter.post(
  "/:id/dismiss",
  asyncHandler(async (req, res) => {
    res.json(await dismissSuggestion(req.userId!, req.params.id));
  })
);
