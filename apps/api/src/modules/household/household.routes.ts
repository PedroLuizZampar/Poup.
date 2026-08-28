import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { withScope } from "../../middleware/withScope";
import { asyncHandler } from "../../middleware/errorHandler";
import {
  getHouseholdState,
  inviteToHousehold,
  acceptInvite,
  declineInvite,
  cancelInvite,
  leaveHousehold,
} from "./household.service";

export const householdRouter = Router();

householdRouter.use(requireAuth);
householdRouter.use(withScope);

const inviteSchema = z.object({
  email: z.string().trim().email("Informe um e-mail válido"),
});

householdRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json({ household: await getHouseholdState(req.scope!) });
  })
);

householdRouter.post(
  "/invites",
  asyncHandler(async (req, res) => {
    const { email } = inviteSchema.parse(req.body);
    const invite = await inviteToHousehold(req.scope!, email);
    res.status(201).json({ invite });
  })
);

householdRouter.post(
  "/invites/:id/accept",
  asyncHandler(async (req, res) => {
    const household = await acceptInvite(req.scope!, req.params.id);
    res.json({ household });
  })
);

householdRouter.post(
  "/invites/:id/decline",
  asyncHandler(async (req, res) => {
    res.json(await declineInvite(req.scope!, req.params.id));
  })
);

householdRouter.delete(
  "/invites/:id",
  asyncHandler(async (req, res) => {
    res.json(await cancelInvite(req.scope!, req.params.id));
  })
);

householdRouter.post(
  "/leave",
  asyncHandler(async (req, res) => {
    const household = await leaveHousehold(req.scope!);
    res.json({ household });
  })
);
