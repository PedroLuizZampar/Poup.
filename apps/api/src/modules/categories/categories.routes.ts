import { Router } from "express";
import { z } from "zod";
import {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
} from "./categories.service";
import { CategoryNotFoundError } from "../../lib/errors";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);

const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório"),
  icon: z.string().trim().min(1).optional(),
  colorKey: z.string().trim().min(1).optional(),
});

const updateCategorySchema = z.object({
  name: z.string().trim().min(1).optional(),
  icon: z.string().trim().min(1).optional(),
  colorKey: z.string().trim().min(1).optional(),
});

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await listCategories(req.userId!);
    res.json({ categories });
  })
);

categoriesRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const category = await getCategoryById(req.userId!, req.params.id);
    if (!category) {
      throw new CategoryNotFoundError();
    }
    res.json({ category });
  })
);

categoriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const category = await createCategory(req.userId!, createCategorySchema.parse(req.body));
    res.status(201).json({ category });
  })
);

const updateHandler = asyncHandler(async (req, res) => {
  const category = await updateCategory(
    req.userId!,
    req.params.id,
    updateCategorySchema.parse(req.body)
  );
  res.json({ category });
});

categoriesRouter.patch("/:id", updateHandler);
categoriesRouter.put("/:id", updateHandler);

categoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    await deleteCategory(req.userId!, req.params.id);
    res.json({ success: true });
  })
);
