import { prisma } from "../../prisma";
import { NotificationSeverity } from "@prisma/client";
import type { NotificationDTO } from "@poup/shared";
import { listBudgets } from "../budgets/budgets.service";
import { NotificationNotFoundError } from "../../lib/errors";

export { NotificationNotFoundError };

function formatNotificationDTO(n: {
  id: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  read: boolean;
  createdAt: Date;
}): NotificationDTO {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    severity: n.severity,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

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

export async function generateAutomaticAlerts(userId: string): Promise<number> {
  let createdCount = 0;
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // 1. Checar Orçamentos do mês atual
  const budgets = await listBudgets(userId);
  for (const b of budgets) {
    if (b.status === "exceeded") {
      const title = `Orçamento estourado: ${b.categoryName}`;
      const existing = await prisma.notification.findFirst({
        where: {
          userId,
          title,
          createdAt: { gte: sevenDaysAgo },
        },
      });

      if (!existing) {
        await prisma.notification.create({
          data: {
            userId,
            title,
            body: `Você ultrapassou o limite definido para ${b.categoryName}. Total gasto: R$ ${b.spent.toFixed(2)} de R$ ${b.monthlyLimit.toFixed(2)} (${b.percentage}%).`,
            severity: NotificationSeverity.ERROR,
          },
        });
        createdCount++;
      }
    } else if (b.status === "warning") {
      const title = `Atenção ao orçamento: ${b.categoryName}`;
      const existing = await prisma.notification.findFirst({
        where: {
          userId,
          title,
          createdAt: { gte: sevenDaysAgo },
        },
      });

      if (!existing) {
        await prisma.notification.create({
          data: {
            userId,
            title,
            body: `Você atingiu ${b.percentage}% do limite de R$ ${b.monthlyLimit.toFixed(2)} em ${b.categoryName}.`,
            severity: NotificationSeverity.WARNING,
          },
        });
        createdCount++;
      }
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
