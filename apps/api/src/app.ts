import path from "node:path";
import fs from "node:fs";
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
import { suggestionsRouter } from "./modules/categorization/suggestions.routes";
import { errorHandler } from "./middleware/errorHandler";
import { ForbiddenError } from "./lib/errors";

export const app = express();

/**
 * CORS restrito ao renderer, e **só sobre a API**.
 *
 * Aplicá-lo à aplicação inteira quebrava o próprio app em produção: o Vite
 * marca `<script type="module">` e `<link rel="stylesheet">` com `crossorigin`,
 * o navegador então manda `Origin` até nos pedidos de mesma origem, e cada
 * asset do build voltava 403. Aqui ele guarda apenas o que precisa ser
 * guardado.
 *
 * Origens aceitas: a própria origem que serve o app, o dev server do Vite (por
 * localhost e pelo IP da rede, que é como o app abre no celular durante o
 * desenvolvimento) e as requisições sem `Origin`, como `curl` e os testes.
 *
 * `CORS_ORIGINS` acrescenta origens extras, separadas por vírgula.
 */
const VITE_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]|(\d{1,3}\.){3}\d{1,3}):5173$/;

const extraOrigins = (env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * Mesma origem não é requisição cruzada — mas o navegador manda `Origin` mesmo
 * assim em `POST`, `PATCH` e `DELETE`. Sem esta comparação, todo login em
 * produção voltaria 403.
 */
function isSameOrigin(origin: string, host?: string): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const apiCors = cors<express.Request>((req, callback) => {
  const origin = req.headers.origin;
  const permitida =
    !origin ||
    isSameOrigin(origin, req.headers.host) ||
    VITE_DEV_ORIGIN.test(origin) ||
    extraOrigins.includes(origin);

  if (!permitida) {
    return callback(new ForbiddenError(`Origem não permitida: ${origin}`));
  }
  callback(null, { origin: true, credentials: true });
});

/** Sonda de saúde da plataforma — fora do `/api` porque não é da aplicação. */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Tudo da aplicação vive sob `/api`.
 *
 * O prefixo é o mesmo em desenvolvimento e em produção: no dev o Vite passa
 * `/api` adiante sem reescrever, e em produção é este processo que atende. É o
 * que permite ao service worker do PWA distinguir dado de casca por caminho —
 * `/api/*` nunca sai do cache, o resto sempre pode.
 */
const apiRouter = express.Router();

apiRouter.use(apiCors);
apiRouter.use(express.json({ limit: "2mb" }));

apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

apiRouter.use("/auth", authRouter);
apiRouter.use("/accounts", accountsRouter);
apiRouter.use("/categories", categoriesRouter);
apiRouter.use("/transactions", transactionsRouter);
apiRouter.use("/reports", reportsRouter);
apiRouter.use("/pluggy", pluggyRouter);
apiRouter.use("/budgets", budgetsRouter);
apiRouter.use("/goals", goalsRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/suggestions", suggestionsRouter);

app.use("/api", apiRouter);

/**
 * O build do `apps/web`, servido pela própria API.
 *
 * Origem única é requisito do PWA, não conveniência de deploy: o service worker
 * só controla páginas do seu próprio escopo, e `start_url`, `scope` e o
 * fallback de navegação todos assumem que app e dados moram no mesmo domínio.
 *
 * Em desenvolvimento a pasta não existe e o bloco inteiro não entra — quem
 * serve o app ali é o Vite.
 */
const webDist = process.env.WEB_DIST
  ? path.resolve(process.env.WEB_DIST)
  : path.resolve(__dirname, "../../web/dist");

if (fs.existsSync(path.join(webDist, "index.html"))) {
  // Os assets do Vite vêm com hash no nome: podem ser guardados para sempre.
  app.use(
    express.static(webDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  /**
   * Fallback de SPA. Com `BrowserRouter`, recarregar em `/transacoes` pede esse
   * caminho ao servidor — sem isto, 404. Só vale para navegação: uma requisição
   * a `/api` que não casou com rota nenhuma continua sendo 404 de API, e não
   * uma página HTML disfarçada de resposta.
   */
  app.get(/^(?!\/api\/).*/, (req, res, next) => {
    if (!req.accepts("html")) return next();
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use(errorHandler);
