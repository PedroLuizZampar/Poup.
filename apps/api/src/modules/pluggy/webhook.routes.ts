import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../../prisma";
import { asyncHandler } from "../../middleware/errorHandler";
import { sincronizarPorIds } from "./pluggy.service";

export const webhookRouter = Router();

/**
 * O header que autentica a Pluggy.
 *
 * A Pluggy não assina os webhooks deste SDK: `createWebhook` aceita headers
 * arbitrários, e é esse o mecanismo previsto. O segredo é registrado junto com o
 * webhook e conferido aqui.
 */
const HEADER = "x-poup-webhook-secret";

/** Comparação em tempo constante — comparar segredo com `===` vaza o prefixo. */
function segredoConfere(recebido: unknown): boolean {
  const esperado = process.env.PLUGGY_WEBHOOK_SECRET;
  if (!esperado || typeof recebido !== "string") return false;

  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // `timingSafeEqual` exige o mesmo tamanho, e o próprio tamanho é informação:
  // por isso a checagem sai antes, e o retorno é o mesmo `false` de sempre.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Onde a Pluggy avisa que algo mudou.
 *
 * Fica fora do `pluggyRouter` de propósito: aquele exige sessão de usuário, e
 * aqui quem chama é um servidor. A autenticação é o header, e nada acontece
 * antes de ele conferir.
 *
 * Responde 200 para evento que não interessa em vez de 4xx: a Pluggy desativa
 * webhook que responde erro, e "não é comigo" não é erro.
 */
webhookRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    if (!segredoConfere(req.header(HEADER))) {
      res.status(401).json({ error: "Não autorizado." });
      return;
    }

    const evento = req.body?.event;
    const itemId = req.body?.itemId;

    if (typeof itemId !== "string") {
      res.json({ ok: true });
      return;
    }

    const item = await prisma.item.findFirst({
      where: { pluggyItemId: itemId },
      select: { id: true, userId: true },
    });

    if (!item) {
      res.json({ ok: true });
      return;
    }

    if (evento === "transactions/updated") {
      // Os ids vêm no payload: dá para resolver o vínculo agora, num tamanho
      // conhecido. É o "sem polling" que a fatura fechada exige.
      const ids: unknown = req.body?.transactionIds;
      const accountId: unknown = req.body?.accountId;

      if (Array.isArray(ids) && typeof accountId === "string") {
        const atualizadas = await sincronizarPorIds(
          item.userId,
          accountId,
          ids.filter((id): id is string => typeof id === "string")
        );
        res.json({ ok: true, updated: atualizadas });
        return;
      }
    }

    if (evento === "transactions/created") {
      // O payload traz um link, e não os ids: o volume não tem tamanho
      // conhecido, e o sync normal resolve. Aqui só fica o aviso.
      await prisma.item.update({
        where: { id: item.id },
        data: { hasPendingSync: true },
      });
    }

    res.json({ ok: true });
  })
);
