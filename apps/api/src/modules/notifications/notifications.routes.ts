import { Router } from "express";
import {
  listNotifications,
  generateAutomaticAlerts,
  markAsRead,
  markAllAsRead,
  deleteNotification,
} from "./notifications.service";
import { requireAuth } from "../../middleware/requireAuth";
import { withScope } from "../../middleware/withScope";
import { asyncHandler } from "../../middleware/errorHandler";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);
notificationsRouter.use(withScope);

/**
 * Só lê. A geração de alertas automáticos vive no `POST /check` — abrir o
 * sininho não pode gravar no banco, e não precisa: o app chama o `/check`
 * depois do sync, que é quando os dados de fato mudaram.
 */
notificationsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await listNotifications(req.userId!);
    res.json(result);
  })
);

notificationsRouter.post(
  "/check",
  asyncHandler(async (req, res) => {
    const count = await generateAutomaticAlerts(req.userId!);
    res.json({ generated: count });
  })
);

notificationsRouter.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    const result = await markAllAsRead(req.userId!);
    res.json(result);
  })
);

notificationsRouter.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    const notification = await markAsRead(req.userId!, req.params.id);
    res.json({ notification });
  })
);

notificationsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteNotification(req.userId!, req.params.id);
    res.json({ success: true });
  })
);
