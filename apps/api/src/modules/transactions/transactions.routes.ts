import { Router } from "express";
import { z } from "zod";
import {
  listTransactions,
  getTransactionById,
  createTransaction,
  updateTransaction,
} from "./transactions.service";
import { ForbiddenError, TransactionNotFoundError } from "../../lib/errors";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);

const createTransactionSchema = z.object({
  accountId: z.string().min(1, "Conta é obrigatória"),
  description: z.string().trim().min(1, "Descrição é obrigatória"),
  amount: z.number().positive("Valor deve ser maior que zero"),
  type: z.enum(["INCOME", "EXPENSE"]),
  date: z.string().min(1, "Data é obrigatória"),
  categoryId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  isRecurring: z.boolean().optional(),
});

const updateTransactionSchema = z.object({
  description: z.string().trim().min(1).optional(),
  categoryId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  isRecurring: z.boolean().optional(),
});

const queryFilterSchema = z.object({
  month: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  accountId: z.string().optional(),
  categoryId: z.string().optional(),
  uncategorized: z
    .preprocess((val) => (val === "true" || val === true ? true : false), z.boolean())
    .optional(),
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

transactionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const filters = queryFilterSchema.parse(req.query);
    const transactions = await listTransactions(req.userId!, filters);
    res.json({ transactions });
  })
);

transactionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const transaction = await getTransactionById(req.userId!, req.params.id);
    if (!transaction) {
      throw new TransactionNotFoundError();
    }
    res.json({ transaction });
  })
);

transactionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const transaction = await createTransaction(
      req.userId!,
      createTransactionSchema.parse(req.body)
    );
    res.status(201).json({ transaction });
  })
);

const updateHandler = asyncHandler(async (req, res) => {
  const transaction = await updateTransaction(
    req.userId!,
    req.params.id,
    updateTransactionSchema.parse(req.body)
  );
  res.json({ transaction });
});

transactionsRouter.patch("/:id", updateHandler);
transactionsRouter.put("/:id", updateHandler);

// Transação importada é registro do banco, não anotação: apagá-la faria o saldo
// do app divergir do extrato sem deixar rastro. Editar categoria e nota basta.
transactionsRouter.delete("/:id", () => {
  throw new ForbiddenError("Exclusão de transações desabilitada");
});
