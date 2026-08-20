import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Limite de tentativas por IP, em memória.
 *
 * Em memória basta: a API é um processo só, por instalação, e o que se quer
 * evitar aqui é um script criando contas ou varrendo senhas numa porta 4000
 * exposta na rede local — não um ataque distribuído. Reiniciar o processo zera
 * a contagem, e isso é aceitável pelo mesmo motivo.
 */

interface RateLimitOptions {
  /** Janela de contagem, em milissegundos. */
  windowMs: number;
  /** Quantas requisições um mesmo IP pode fazer dentro da janela. */
  max: number;
  /** Mensagem devolvida quando o limite estoura. */
  message?: string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function rateLimit({
  windowMs,
  max,
  message = "Muitas tentativas. Tente novamente em alguns minutos.",
}: RateLimitOptions): RequestHandler {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? req.socket.remoteAddress ?? "desconhecido";

    // Varre os expirados de vez em quando para o mapa não crescer sem teto.
    if (buckets.size > 1000) {
      for (const [ip, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(ip);
      }
    }

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count++;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message, code: "RATE_LIMITED" });
    }

    return next();
  };
}
