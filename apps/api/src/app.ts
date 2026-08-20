import express from "express";
import cors from "cors";
import { env } from "./env";
import { authRouter } from "./modules/auth/auth.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { transactionsRouter } from "./modules/transactions/transactions.routes";
import { pluggyRouter } from "./modules/pluggy/pluggy.routes";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import { goalsRouter } from "./modules/goals/goals.routes";
import { notificationsRouter } from "./modules/notifications/notifications.routes";
import { accountsRouter } from "./modules/accounts/accounts.routes";
import { reportsRouter } from "./modules/reports/reports.routes";
import { errorHandler } from "./middleware/errorHandler";
import { ForbiddenError } from "./lib/errors";

export const app = express();

/**
 * CORS restrito ao renderer.
 *
 * `cors()` sem opções libera qualquer origem — o que numa API que só o próprio
 * app consome é permissão sem uso. Origens aceitas: o dev server do Vite (por
 * localhost e pelo IP da rede, que é como o app abre no celular durante o
 * desenvolvimento) e as requisições sem `Origin`, como `curl` e os testes.
 *
 * Em produção isto não tem papel nenhum: o Express serve o build do app e a API
 * sob a mesma origem, então o navegador nem chega a fazer requisição cruzada.
 *
 * `CORS_ORIGINS` acrescenta origens extras, separadas por vírgula.
 */
const VITE_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|(\d{1,3}\.){3}\d{1,3}):5173$/;

const extraOrigins = (env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (VITE_DEV_ORIGIN.test(origin)) return callback(null, true);
      if (extraOrigins.includes(origin)) return callback(null, true);
      return callback(new ForbiddenError(`Origem não permitida: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/auth", authRouter);
app.use("/accounts", accountsRouter);
app.use("/categories", categoriesRouter);
app.use("/transactions", transactionsRouter);
app.use("/reports", reportsRouter);
app.use("/pluggy", pluggyRouter);
app.use("/budgets", budgetsRouter);
app.use("/goals", goalsRouter);
app.use("/notifications", notificationsRouter);

app.use(errorHandler);
