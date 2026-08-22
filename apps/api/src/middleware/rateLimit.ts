import type { NextFunction, Request, RequestHandler, Response } from "express";
import { prisma } from "../prisma";

/**
 * Limite de tentativas por IP, contado no banco.
 *
 * Era um `Map` de processo, e o argumento era bom enquanto valeu: "a API é um
 * processo só, por instalação". Hospedada como função serverless ela deixa de
 * ser um processo só — a plataforma cria e destrói instâncias à vontade, cada
 * uma com o próprio mapa. O limite de 10 tentativas por 15 minutos viraria 10
 * por instância, que não é limite nenhum contra quem justamente faz muitas
 * requisições em série.
 *
 * O custo é uma ida ao banco nas rotas limitadas — e só nelas, que são as duas
 * sem autenticação.
 */

interface RateLimitOptions {
  /** Prefixo da chave. Separa limites diferentes sobre o mesmo IP. */
  scope: string;
  /** Janela de contagem, em milissegundos. */
  windowMs: number;
  /** Quantas requisições um mesmo IP pode fazer dentro da janela. */
  max: number;
  /** Mensagem devolvida quando o limite estoura. */
  message?: string;
}

interface Contagem {
  count: number;
  resetAt: Date;
}

/**
 * Uma chance em cem de varrer as janelas vencidas.
 *
 * Sem isso a tabela cresce com cada IP que já apareceu. Fazer a limpeza em toda
 * requisição seria uma segunda ida ao banco no caminho do login para apagar,
 * quase sempre, nada.
 */
const CHANCE_DE_LIMPEZA = 0.01;

export function rateLimit({
  scope,
  windowMs,
  max,
  message = "Muitas tentativas. Tente novamente em alguns minutos.",
}: RateLimitOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `${scope}:${resolverIp(req)}`;
    const agora = new Date();
    const proximoReset = new Date(agora.getTime() + windowMs);

    let contagem: Contagem;

    try {
      contagem = await registrarTentativa(key, agora, proximoReset);
    } catch (err) {
      /**
       * Falhou a contagem: deixa passar.
       *
       * Barrar seria trocar uma degradação por uma indisponibilidade — e sem
       * ganho nenhum, porque a rota que este middleware protege também precisa
       * do banco para autenticar. Se ele está fora, o login falha logo adiante
       * de qualquer jeito; o que não pode é o app parecer bloqueado por excesso
       * de tentativas quando o problema é outro.
       */
      console.error("Falha ao contar tentativa de acesso:", err);
      return next();
    }

    if (Math.random() < CHANCE_DE_LIMPEZA) {
      void prisma.rateLimitHit
        .deleteMany({ where: { resetAt: { lte: agora } } })
        .catch(() => undefined);
    }

    if (contagem.count > max) {
      const retryAfter = Math.max(
        1,
        Math.ceil((contagem.resetAt.getTime() - agora.getTime()) / 1000)
      );
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: message, code: "RATE_LIMITED" });
    }

    return next();
  };
}

/**
 * De quem é a tentativa.
 *
 * `x-vercel-forwarded-for` vem antes de `req.ip` porque é escrito pela própria
 * plataforma e sobrescrito a cada requisição: o cliente não consegue forjá-lo,
 * e forjar é exatamente o que resolveria o problema de quem está sendo
 * limitado. Fora da Vercel o cabeçalho não existe e vale o `req.ip` de sempre.
 */
export function resolverIp(req: Request): string {
  const daPlataforma = req.headers["x-vercel-forwarded-for"];
  const bruto = Array.isArray(daPlataforma) ? daPlataforma[0] : daPlataforma;
  const primeiro = bruto?.split(",")[0]?.trim();

  return primeiro || req.ip || req.socket.remoteAddress || "desconhecido";
}

/**
 * Incrementa a contagem e devolve o valor já atualizado, numa consulta só.
 *
 * É SQL cru porque ler-decidir-gravar em três passos é uma corrida perdida
 * justamente contra o tráfego que se quer limitar: duas requisições simultâneas
 * leem `count: 9`, as duas gravam `10`, e a décima primeira passa. O `ON
 * CONFLICT` resolve incremento e virada de janela dentro do próprio comando,
 * onde o banco serializa por linha.
 */
async function registrarTentativa(
  key: string,
  agora: Date,
  proximoReset: Date
): Promise<Contagem> {
  const linhas = await prisma.$queryRaw<Contagem[]>`
    INSERT INTO "RateLimitHit" ("key", "count", "resetAt")
    VALUES (${key}, 1, ${proximoReset})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitHit"."resetAt" <= ${agora} THEN 1
        ELSE "RateLimitHit"."count" + 1
      END,
      "resetAt" = CASE
        WHEN "RateLimitHit"."resetAt" <= ${agora} THEN ${proximoReset}
        ELSE "RateLimitHit"."resetAt"
      END
    RETURNING "count", "resetAt"
  `;

  return linhas[0];
}
