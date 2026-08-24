import { Router } from "express";
import { z } from "zod";
import {
  syncUserItem,
  syncAllItems,
  addItemById,
  listItems,
  deleteItem,
  updateItemImage,
  backfillAccount,
} from "./pluggy.service";
import { createReviewNotification } from "../notifications/notifications.service";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const pluggyRouter = Router();

pluggyRouter.use(requireAuth);

const syncItemSchema = z.object({
  pluggyItemId: z.string().optional(),
});

const updateItemImageSchema = z.object({
  imageUrl: z.string().nullable(),
});

const addItemSchema = z.object({
  pluggyItemId: z.string().trim().min(1, "Informe o id do item"),
});

pluggyRouter.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const parsed = syncItemSchema.parse(req.body ?? {});

    // Sem id, sincroniza tudo o que é do usuário. Com id, `syncUserItem`
    // resolve o item pelo par (userId, pluggyItemId) e devolve 404 se não for
    // dele — o id sozinho não prova nada, é único global.
    const result = parsed.pluggyItemId
      ? await syncUserItem(req.userId!, parsed.pluggyItemId)
      : await syncAllItems(req.userId!);

    await createReviewNotification(req.userId!, result.review);

    res.json(result);
  })
);

pluggyRouter.post(
  "/items",
  asyncHandler(async (req, res) => {
    const { pluggyItemId } = addItemSchema.parse(req.body);
    const result = await addItemById(req.userId!, pluggyItemId);
    await createReviewNotification(req.userId!, result.review);
    res.status(201).json(result);
  })
);

pluggyRouter.get(
  "/items",
  asyncHandler(async (req, res) => {
    const items = await listItems(req.userId!);
    res.json({ items });
  })
);

pluggyRouter.patch(
  "/items/:id/image",
  asyncHandler(async (req, res) => {
    const { imageUrl } = updateItemImageSchema.parse(req.body);
    const item = await updateItemImage(req.userId!, req.params.id, imageUrl);
    res.json({ item });
  })
);

/**
 * Histórico completo de **uma** conta. O corte por conta não é detalhe de
 * implementação: é o que dá a cada requisição alguma chance de caber no teto de
 * tempo da função. Quem escolhe a conta é a tela, uma de cada vez.
 *
 * A notificação sai como a do sync: o que entra aqui pode ser anos de extrato,
 * e a fila de revisão precisa avisar que cresceu.
 */
pluggyRouter.post(
  "/accounts/:accountId/backfill",
  asyncHandler(async (req, res) => {
    const result = await backfillAccount(req.userId!, req.params.accountId);
    await createReviewNotification(req.userId!, result.review);
    res.json(result);
  })
);

pluggyRouter.delete(
  "/items/:id",
  asyncHandler(async (req, res) => {
    await deleteItem(req.userId!, req.params.id);
    res.json({ success: true });
  })
);
