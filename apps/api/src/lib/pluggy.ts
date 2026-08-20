import { PluggyClient } from "pluggy-sdk";
import { env } from "../env";
import { prisma } from "../prisma";
import { decryptSecret } from "./crypto";
import { ConflictError } from "./errors";

/**
 * Cliente Pluggy **por usuário**: as credenciais são cadastradas na conta, não
 * no ambiente, então cada usuário fala com a Pluggy com a própria aplicação.
 *
 * O SDK cacheia internamente a apiKey (que expira em ~2h), então recriar o
 * cliente a cada requisição jogaria fora esse cache e faria uma autenticação
 * extra em toda chamada. Por isso o cliente é guardado em memória e só é
 * descartado quando as credenciais do usuário mudam.
 */

export class MissingPluggyCredentialsError extends ConflictError {
  constructor() {
    super("Credenciais da Pluggy não configuradas. Cadastre-as no seu perfil.", {
      code: "MISSING_PLUGGY_CREDENTIALS",
    });
  }
}

interface CachedClient {
  clientId: string;
  clientSecret: string;
  client: PluggyClient;
}

const cache = new Map<string, CachedClient>();

export function createPluggyClient(clientId: string, clientSecret: string): PluggyClient {
  return new PluggyClient({ clientId, clientSecret, baseUrl: env.PLUGGY_BASE_URL });
}

export async function getPluggyClientForUser(userId: string): Promise<PluggyClient> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pluggyClientId: true, pluggyClientSecret: true },
  });

  if (!user?.pluggyClientId || !user.pluggyClientSecret) {
    throw new MissingPluggyCredentialsError();
  }

  const clientSecret = decryptSecret(user.pluggyClientSecret);
  const cached = cache.get(userId);

  if (cached && cached.clientId === user.pluggyClientId && cached.clientSecret === clientSecret) {
    return cached.client;
  }

  const client = createPluggyClient(user.pluggyClientId, clientSecret);
  cache.set(userId, { clientId: user.pluggyClientId, clientSecret, client });
  return client;
}

/** Chamado ao trocar as credenciais, para a próxima chamada não usar as antigas. */
export function invalidatePluggyClient(userId: string): void {
  cache.delete(userId);
}

/**
 * Confere um par client id/secret contra a Pluggy antes de gravá-lo. Sem isso,
 * a credencial errada só apareceria como falha na primeira sincronização, longe
 * do formulário que a causou.
 */
export async function verifyPluggyCredentials(
  clientId: string,
  clientSecret: string
): Promise<boolean> {
  try {
    await createPluggyClient(clientId, clientSecret).createConnectToken();
    return true;
  } catch (err: any) {
    console.warn("Credenciais Pluggy recusadas:", err?.message || err);
    return false;
  }
}
