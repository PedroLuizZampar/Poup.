import { prisma } from "../prisma";
import { ForbiddenError, UserNotFoundError } from "./errors";

/**
 * Quem sou eu, e quem mais conta nesta requisicao.
 *
 * Substitui o `userId: string` que os servicos recebiam. Nao e cosmetico: e o
 * que transforma "esqueci de somar o parceiro nesta consulta" de um bug
 * silencioso num erro do compilador.
 */
export interface Scope {
  /** Quem esta agindo. Dono do que for criado e sujeito das permissoes. */
  userId: string;
  /** O espaco em que categorias, orcamentos e metas vivem. */
  householdId: string;
  /** Todos os membros, em ordem de entrada. E o que a leitura somada usa. */
  memberIds: string[];
}

/**
 * Duas idas ao banco, as duas por indice. Nenhuma delas pode ir para o JWT:
 * entrar num espaco mudaria o escopo, e o token velho continuaria valendo com o
 * escopo antigo ate expirar.
 */
export async function resolveScope(userId: string): Promise<Scope> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { householdId: true },
  });
  if (!user) throw new UserNotFoundError();

  const membros = await prisma.user.findMany({
    where: { householdId: user.householdId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    userId,
    householdId: user.householdId,
    memberIds: membros.map((m) => m.id),
  };
}

/**
 * O filtro "Todos / Fulano / Beltrano" das telas, resolvido em ids.
 *
 * A checagem de pertinencia nao e opcional — ver o teste que a guarda.
 */
export function ownerIds(scope: Scope, owner?: string | null): string[] {
  if (!owner || owner === "all") return scope.memberIds;
  if (!scope.memberIds.includes(owner)) {
    throw new ForbiddenError("Este usuário não faz parte da sua conta conjunta");
  }
  return [owner];
}
