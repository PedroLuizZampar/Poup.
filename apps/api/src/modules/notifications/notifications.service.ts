import { prisma } from "../../prisma";
import { NotificationSeverity } from "@prisma/client";
import type { NotificationDTO } from "@poup/shared";
import { listBudgets } from "../budgets/budgets.service";
import { NotificationNotFoundError } from "../../lib/errors";
import type { ProcessResult } from "../categorization/categorization.service";
import type { Scope } from "../../lib/scope";

export { NotificationNotFoundError };

function formatNotificationDTO(n: {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  read: boolean;
  link: string | null;
  createdAt: Date;
}): NotificationDTO {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    severity: n.severity,
    read: n.read,
    link: n.link,
    createdAt: n.createdAt.toISOString(),
  };
}

const REVIEW_LINK = "/revisao";

/**
 * Uma notificação por lote, não uma por transação — uma importação de 200
 * lançamentos encheria o sininho e enterraria os alertas de orçamento. Se já
 * existe uma não lida apontando para a revisão, ela é atualizada: o que o
 * usuário quer saber é quantas estão esperando agora, não quantas chegaram em
 * cada sync.
 *
 * O título conta as **pendentes**, não as do lote: quem abre o sininho depois de
 * três syncs quer saber o tamanho do trabalho que sobrou, e a notificação é o
 * único lugar onde esse número aparece antes de a tela abrir. O corpo é que
 * conta o lote — quantas o app adivinhou e quantas ficaram sem palpite.
 *
 * A linha vai só para quem rodou o sync — foi a ação dele que trouxe as
 * transações —, mas a contagem é a do espaço, porque a fila que ela abre também
 * é.
 */
export async function createReviewNotification(
  scope: Scope,
  result: ProcessResult
): Promise<void> {
  // O sync pode não ter trazido nada novo, ou ter trazido só transferências
  // internas — que já nascem categorizadas e não vão para a fila.
  if (result.suggested + result.withoutGuess === 0) return;

  const userId = scope.userId;

  // A contagem é do espaço: o título promete um número, e a tela de revisão que
  // ele abre mostra a fila do casal. Contar só as minhas mentiria no título.
  const pendentes = await prisma.categorySuggestion.count({
    where: { userId: { in: scope.memberIds }, status: "PENDING" },
  });
  if (pendentes === 0) return;

  const title = `${pendentes} ${pendentes === 1 ? "transação" : "transações"} sem categoria`;
  const chegaram = result.suggested + result.withoutGuess;
  const partes = [
    `${chegaram} ${chegaram === 1 ? "nova" : "novas"} neste sync`,
    result.suggested > 0
      ? `${result.suggested} com categoria sugerida`
      : null,
    result.withoutGuess > 0 ? `${result.withoutGuess} sem palpite` : null,
    result.transfers > 0
      ? `${result.transfers} identificadas como transferência entre suas contas`
      : null,
  ].filter(Boolean);
  const body = `${partes.join(", ")}. Toque para categorizar uma a uma.`;

  const existing = await prisma.notification.findFirst({
    where: { userId, link: REVIEW_LINK, read: false },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    await prisma.notification.update({
      where: { id: existing.id },
      data: { title, body, createdAt: new Date() },
    });
    return;
  }

  await prisma.notification.create({
    data: { userId, title, body, severity: NotificationSeverity.INFO, link: REVIEW_LINK },
  });
}

/**
 * Continua por pessoa, e não por espaço: "lido" é um estado de quem leu, e uma
 * linha só compartilhada faria a leitura de um apagar o aviso do outro.
 */
export async function listNotifications(userId: string): Promise<{
  notifications: NotificationDTO[];
  unreadCount: number;
}> {
  const notifications = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications: notifications.map(formatNotificationDTO),
    unreadCount,
  };
}

/**
 * Os alertas de orçamento do mês, gravados uma vez para cada membro do espaço.
 *
 * O orçamento é do casal: quem estourou o teto de mercado foram os dois, e
 * avisar só quem abriu o app deixaria o outro sem saber. A linha, porém, é por
 * pessoa — "lido" é por pessoa —, e por isso a deduplicação de sete dias
 * continua sendo por `(userId, título)`, que segue correta com uma linha para
 * cada.
 */
export async function generateAutomaticAlerts(scope: Scope): Promise<number> {
  let createdCount = 0;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // 1. Checar Orçamentos do mês atual
  const budgets = await listBudgets(scope);
  for (const b of budgets) {
    if (b.status !== "exceeded" && b.status !== "warning") continue;

    const excedido = b.status === "exceeded";
    const title = excedido
      ? `Orçamento estourado: ${b.categoryName}`
      : `Atenção ao orçamento: ${b.categoryName}`;
    const body = excedido
      ? `Você ultrapassou o limite definido para ${b.categoryName}. Total gasto: R$ ${b.spent.toFixed(2)} de R$ ${b.monthlyLimit.toFixed(2)} (${b.percentage}%).`
      : `Você atingiu ${b.percentage}% do limite de R$ ${b.monthlyLimit.toFixed(2)} em ${b.categoryName}.`;
    const severity = excedido ? NotificationSeverity.ERROR : NotificationSeverity.WARNING;

    for (const memberId of scope.memberIds) {
      const existing = await prisma.notification.findFirst({
        where: { userId: memberId, title, createdAt: { gte: sevenDaysAgo } },
      });
      if (existing) continue;

      await prisma.notification.create({
        data: { userId: memberId, title, body, severity },
      });
      createdCount++;
    }
  }

  return createdCount;
}

export async function markAsRead(userId: string, id: string): Promise<NotificationDTO> {
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new NotificationNotFoundError();
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { read: true },
  });

  return formatNotificationDTO(updated);
}

export async function markAllAsRead(userId: string): Promise<{ success: true; count: number }> {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });

  return { success: true, count: result.count };
}

export async function deleteNotification(userId: string, id: string): Promise<{ success: true }> {
  const existing = await prisma.notification.findFirst({
    where: { id, userId },
  });
  if (!existing) {
    throw new NotificationNotFoundError();
  }

  await prisma.notification.delete({
    where: { id },
  });

  return { success: true };
}
