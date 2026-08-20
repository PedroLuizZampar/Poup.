import { app } from "./app";
import { env } from "./env";
import { disconnectPrisma } from "./prisma";

const server = app.listen(env.PORT, () => {
  // `PORT=0` pede uma porta livre ao sistema, então a porta real só se conhece
  // depois do listen — é o que hosts como Fly e Render fazem ao injetar a porta.
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : env.PORT;

  console.log(`Poup API rodando em http://localhost:${port}`);
});

/**
 * Fecha o servidor e o pool do Prisma antes de sair. Sem isto o Neon segura a
 * conexão até o próprio timeout — visível como "too many connections" depois de
 * alguns reinícios seguidos do dev server.
 */
async function shutdown(signal: string) {
  console.log(`Encerrando a API (${signal})...`);
  server.close();
  await disconnectPrisma().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("beforeExit", () => void disconnectPrisma().catch(() => undefined));
