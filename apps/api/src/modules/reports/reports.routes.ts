import { Router } from "express";
import { z } from "zod";
import { getReportSummary } from "./reports.service";
import { requireAuth } from "../../middleware/requireAuth";
import { withScope } from "../../middleware/withScope";
import { asyncHandler } from "../../middleware/errorHandler";

export const reportsRouter = Router();

reportsRouter.use(requireAuth);
reportsRouter.use(withScope);

const summaryQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Mês deve estar no formato YYYY-MM")
    .optional(),
  period: z.enum(["current", "3m", "6m", "year", "all"]).optional(),
  history: z.coerce.number().int().min(1).max(24).optional(),
});

reportsRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const query = summaryQuerySchema.parse(req.query);
    const summary = await getReportSummary(req.userId!, query);
    res.json({ summary });
  })
);
