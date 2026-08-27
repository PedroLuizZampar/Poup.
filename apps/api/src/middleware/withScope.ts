import { NextFunction, Request, Response } from "express";
import { resolveScope, type Scope } from "../lib/scope";

declare global {
  namespace Express {
    interface Request {
      scope?: Scope;
    }
  }
}

/**
 * Monta sempre **depois** do `requireAuth`: sem `req.userId` nao ha o que
 * resolver. Falha aqui e falha da requisicao inteira, e nao um escopo vazio
 * que silenciosamente devolveria a lista errada.
 */
export async function withScope(req: Request, _res: Response, next: NextFunction) {
  try {
    req.scope = await resolveScope(req.userId!);
    next();
  } catch (err) {
    next(err);
  }
}
