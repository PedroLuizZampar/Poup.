import { Router } from "express";
import { z } from "zod";
import {
  listTransactions,
  getTransactionById,
  createTransaction,
  updateTransaction,
  listInstallments,
} from "./transactions.service";
import {
  bulkCategorize,
  findSimilarTransactions,
} from "../categorization/similar.service";
import {
  compensar,
  desfazerCompensacao,
  detalheDaCompensacao,
  listarCandidatas,
} from "./compensacao.service";
import { ForbiddenError, TransactionNotFoundError } from "../../lib/errors";
import { requireAuth } from "../../middleware/requireAuth";
import { withScope } from "../../middleware/withScope";
import { asyncHandler } from "../../middleware/errorHandler";

export const transactionsRouter = Router();

transactionsRouter.use(requireAuth);
transactionsRouter.use(withScope);

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

const compensateSchema = z.object({
  purchaseKey: z.string().min(1, "Compra é obrigatória"),
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
  minAmount: z.coerce.number().min(0).optional(),
  maxAmount: z.coerce.number().min(0).optional(),
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

const bulkCategorizeSchema = z.object({
  transactionIds: z.array(z.string().min(1)).min(1, "Selecione ao menos uma transação"),
  categoryId: z.string().min(1, "Categoria é obrigatória"),
});

// Antes de "/:id": sem isso o Express casaria "bulk-categorize" como um id.
transactionsRouter.post(
  "/bulk-categorize",
  asyncHandler(async (req, res) => {
    const { transactionIds, categoryId } = bulkCategorizeSchema.parse(req.body);
    res.json(await bulkCategorize(req.userId!, transactionIds, categoryId));
  })
);

transactionsRouter.get(
  "/:id/similar",
  asyncHandler(async (req, res) => {
    const categoryId = z.string().min(1).parse(req.query.categoryId);
    res.json(await findSimilarTransactions(req.userId!, req.params.id, categoryId));
  })
);

/**
 * As parcelas da compra a que esta transação pertence. Endpoint próprio porque
 * a lista mensal traz uma parcela por compra, e as demais só interessam quando
 * o usuário abre o dropdown.
 *
 * Antes de "/:id": sem isso o Express casaria "abc/installments" como um id.
 */
transactionsRouter.get(
  "/:id/installments",
  asyncHandler(async (req, res) => {
    const result = await listInstallments(req.userId!, req.params.id);
    res.json(result);
  })
);

/**
 * Compensacao de estorno: ligar um credito as parcelas da compra que ele
 * cancela, e desfazer o vinculo.
 *
 * Antes de "/:id" pelo mesmo motivo de "/:id/installments": sem isso o Express
 * casaria "abc/compensation" como um id. O DELETE tambem precisa vir antes do
 * `delete("/:id")` la embaixo, que recusa exclusao sempre.
 */
transactionsRouter.get(
  "/:id/compensation/candidates",
  asyncHandler(async (req, res) => {
    res.json(await listarCandidatas(req.userId!, req.params.id));
  })
);

transactionsRouter.get(
  "/:id/compensation",
  asyncHandler(async (req, res) => {
    res.json(await detalheDaCompensacao(req.userId!, req.params.id));
  })
);

transactionsRouter.post(
  "/:id/compensation",
  asyncHandler(async (req, res) => {
    const { purchaseKey } = compensateSchema.parse(req.body);
    res.json(await compensar(req.userId!, req.params.id, purchaseKey));
  })
);

transactionsRouter.delete(
  "/:id/compensation",
  asyncHandler(async (req, res) => {
    res.json(await desfazerCompensacao(req.userId!, req.params.id));
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
