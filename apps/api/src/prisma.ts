import { PrismaClient } from "@prisma/client";

/**
 * O `tsx watch` recarrega o módulo a cada alteração de arquivo, e cada recarga
 * instanciaria um `PrismaClient` novo — com pool próprio — contra o Neon, que
 * cobra conexão. Guardar a instância no `globalThis` faz a recarga reaproveitar
 * o pool já aberto. Em produção o módulo é carregado uma vez só e o guard não
 * muda nada.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * Fecha o pool antes do processo morrer. Sem isso, o Neon mantém a conexão
 * pendurada até o timeout dele — o que aparece como "too many connections"
 * depois de algumas dezenas de reinícios do dev server.
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
