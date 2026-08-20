import type { NextFunction, Request, Response, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";

/**
 * O Express 4 não encaminha promessa rejeitada de handler `async` para o
 * middleware de erro — ela vira `unhandledRejection` e a requisição fica
 * pendurada até o timeout do cliente. `asyncHandler` fecha esse buraco: é o que
 * faz o `throw` dentro de uma rota chegar de fato no `errorHandler`.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

/**
 * Traduz erro em resposta. `AppError` carrega o próprio status; o resto é 500 —
 * e só o 500 é registrado no log, porque 404 e 409 são conversa normal com o
 * cliente, não incidente.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
      ...(err.field ? { field: err.field } : {}),
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Dados inválidos", details: err.flatten() });
  }

  console.error(err);
  return res.status(500).json({ error: "Erro interno" });
}
