import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import type { HouseholdInviteDTO, HouseholdStateDTO } from "@poup/shared";
import type { Scope } from "../../lib/scope";
import { ConviteInvalidoError, ConviteNaoEncontradoError } from "../../lib/errors";

const LINK_CONJUNTA = "/perfil#conjunta";

const membroSelect = { id: true, name: true, avatarUrl: true } as const;

const conviteInclude = { inviter: { select: membroSelect } } as const;

function formatInviteDTO(invite: {
  id: string;
  status: string;
  inviteeEmail: string;
  createdAt: Date;
  inviter: { id: string; name: string; avatarUrl: string | null };
}): HouseholdInviteDTO {
  return {
    id: invite.id,
    status: invite.status as HouseholdInviteDTO["status"],
    inviter: invite.inviter,
    inviteeEmail: invite.inviteeEmail,
    createdAt: invite.createdAt.toISOString(),
  };
}

/**
 * O espaço como as telas precisam vê-lo: quem está dentro, o que me convidaram
 * e o que nós convidamos.
 *
 * `invitesReceived` não sai dos convites do meu espaço: `householdId` no convite
 * é o espaço de **quem convidou**, e quem recebe mora sempre em outro. Por isso
 * a busca é por `inviteeId`, sem olhar o meu espaço. Já `invitesSent` é do
 * espaço inteiro, e não de quem enviou: qualquer membro pode cancelar o convite
 * que o outro mandou.
 */
export async function getHouseholdState(scope: Scope): Promise<HouseholdStateDTO> {
  const [members, invitesReceived, invitesSent] = await Promise.all([
    prisma.user.findMany({
      where: { householdId: scope.householdId },
      select: membroSelect,
      orderBy: { createdAt: "asc" },
    }),
    prisma.householdInvite.findMany({
      where: { inviteeId: scope.userId, status: "PENDING" },
      include: conviteInclude,
      orderBy: { createdAt: "desc" },
    }),
    prisma.householdInvite.findMany({
      where: { householdId: scope.householdId, status: "PENDING" },
      include: conviteInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    id: scope.householdId,
    members,
    invitesReceived: invitesReceived.map(formatInviteDTO),
    invitesSent: invitesSent.map(formatInviteDTO),
  };
}

/**
 * Nao ha e-mail nem push no projeto, e esta feature nao introduz nenhum dos
 * dois: o convite alcanca apenas quem ja tem conta no Poup, e chega pelo
 * sininho.
 */
export async function inviteToHousehold(
  scope: Scope,
  email: string
): Promise<HouseholdInviteDTO> {
  const alvo = email.trim().toLowerCase();

  const convidado = await prisma.user.findFirst({
    where: { email: { equals: alvo, mode: "insensitive" } },
    select: { id: true, householdId: true },
  });
  if (!convidado) {
    throw new ConviteInvalidoError("Não encontramos ninguém com este e-mail no Poup");
  }
  if (convidado.id === scope.userId) {
    throw new ConviteInvalidoError("Não dá para convidar a si mesmo");
  }
  if (convidado.householdId === scope.householdId) {
    throw new ConviteInvalidoError("Esta pessoa já está na sua conta conjunta");
  }

  // Quem ja divide um espaco com outra pessoa precisa sair de la primeiro: a
  // fusao move o espaco inteiro, e mover um espaco povoado levaria junto quem
  // nao foi convidado.
  const membrosDoConvidado = await prisma.user.count({
    where: { householdId: convidado.householdId },
  });
  if (membrosDoConvidado > 1) {
    throw new ConviteInvalidoError("Esta pessoa já faz parte de uma conta conjunta");
  }

  let invite;
  try {
    invite = await prisma.householdInvite.create({
      data: {
        householdId: scope.householdId,
        inviterId: scope.userId,
        inviteeId: convidado.id,
        inviteeEmail: alvo,
      },
      include: conviteInclude,
    });
  } catch (err) {
    // Um convite pendente por par é garantia do índice único parcial
    // `HouseholdInvite_pendente_por_par`, e não de um `findFirst` daqui: dois
    // pedidos simultâneos passariam pelos dois lados da checagem e criariam
    // dois convites. Quem colide vê a recusa em vez de um 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConviteInvalidoError("Já existe um convite pendente para esta pessoa");
    }
    throw err;
  }

  await prisma.notification.create({
    data: {
      userId: convidado.id,
      title: "Convite para conta conjunta",
      body: `${invite.inviter.name} quer dividir a visão financeira com você. Toque para ver o convite.`,
      link: LINK_CONJUNTA,
    },
  });

  return formatInviteDTO(invite);
}

/**
 * Recusar é do lado de quem recebeu — só o próprio convidado.
 *
 * O `status: "PENDING"` viaja dentro do `updateMany`, e não fica só na leitura
 * anterior: entre ler e escrever, o outro lado pode ter cancelado. Com o status
 * no `where` da escrita, quem chega depois casa zero linhas e recebe 404 — em
 * vez de sobrescrever o CANCELLED e avisar o inviter de uma recusa que não
 * aconteceu. O `findFirst` continua aqui só para montar a notificação.
 */
export async function declineInvite(scope: Scope, inviteId: string) {
  const invite = await prisma.householdInvite.findFirst({
    where: { id: inviteId, inviteeId: scope.userId, status: "PENDING" },
    select: { inviterId: true, inviteeEmail: true },
  });
  if (!invite) throw new ConviteNaoEncontradoError();

  const { count } = await prisma.householdInvite.updateMany({
    where: { id: inviteId, inviteeId: scope.userId, status: "PENDING" },
    data: { status: "DECLINED", respondedAt: new Date() },
  });
  // Quem perdeu a corrida não recusou nada, e por isso também não notifica: é o
  // mesmo `count` que impede a segunda notificação de uma recusa em duplicata.
  if (count === 0) throw new ConviteNaoEncontradoError();

  await prisma.notification.create({
    data: {
      userId: invite.inviterId,
      title: "Convite recusado",
      body: `${invite.inviteeEmail} não aceitou o convite para a conta conjunta.`,
      link: LINK_CONJUNTA,
    },
  });

  return { success: true } as const;
}

/**
 * Cancelar e do lado de quem enviou — qualquer membro do espaco que enviou.
 *
 * Uma escrita só, condicionada: o espaço e o `PENDING` estão no `where`, então o
 * banco decide quem vence e não há janela entre ler e escrever.
 */
export async function cancelInvite(scope: Scope, inviteId: string) {
  const { count } = await prisma.householdInvite.updateMany({
    where: { id: inviteId, householdId: scope.householdId, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
  if (count === 0) throw new ConviteNaoEncontradoError();

  return { success: true } as const;
}
