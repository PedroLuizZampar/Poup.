import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma";
import type { HouseholdInviteDTO, HouseholdStateDTO } from "@poup/shared";
import { resolveScope, type Scope } from "../../lib/scope";
import {
  ConviteInvalidoError,
  ConviteNaoEncontradoError,
  UnprocessableError,
} from "../../lib/errors";
import { mergeHouseholds } from "./merge";
import { splitHousehold } from "./split";

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
 * Uma transação só, com folga de tempo.
 *
 * A fusão é uma sequência longa de idas ao banco — quatro por categoria
 * absorvida — contra um Neon remoto, e o teto padrão do Prisma para transação
 * interativa é de 5 s. Estourar no meio de uma fusão é o pior desfecho possível,
 * então o teto sobe; somado ao `maxWait` continua bem abaixo dos 60 s da função
 * da Vercel.
 */
const TRANSACAO_DA_FUSAO = { timeout: 25_000, maxWait: 10_000 } as const;

/**
 * Aceitar funde o meu espaço no de quem convidou, e some com o meu.
 *
 * O `status: "PENDING"` viaja dentro do `updateMany`, e não fica só na leitura
 * anterior: entre ler e escrever, quem convidou pode ter cancelado. E como esta
 * é a primeira escrita da transação, quem chega depois casa zero linhas e a
 * transação inteira volta atrás — em vez de mudar alguém de espaço por causa de
 * um convite que já não existe. O `findFirst` continua aqui só para saber para
 * onde fundir e quem notificar.
 *
 * Tudo o que move dado acontece dentro do mesmo `$transaction`: meia fusão
 * deixaria duas pessoas meio juntas, e não há de-para para desfazer.
 */
export async function acceptInvite(
  scope: Scope,
  inviteId: string
): Promise<HouseholdStateDTO> {
  const invite = await prisma.householdInvite.findFirst({
    where: { id: inviteId, inviteeId: scope.userId, status: "PENDING" },
    select: { householdId: true, inviterId: true, inviteeEmail: true },
  });
  if (!invite) throw new ConviteNaoEncontradoError();

  // Quem ja divide um espaco com outra pessoa precisa sair de la primeiro: a
  // fusao move o espaco inteiro, e mover um espaco povoado levaria junto quem
  // nao foi convidado. Se alguem entrar no meu espaco entre esta contagem e a
  // transacao, o `household.delete` la embaixo esbarra na FK de `User` e a
  // fusao inteira volta atras — o banco e a guarda de verdade.
  const membrosDoMeu = await prisma.user.count({
    where: { householdId: scope.householdId },
  });
  if (membrosDoMeu > 1) {
    throw new ConviteInvalidoError(
      "Saia da sua conta conjunta atual antes de aceitar outro convite"
    );
  }

  const origemId = scope.householdId;
  const destinoId = invite.householdId;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.householdInvite.updateMany({
      where: { id: inviteId, inviteeId: scope.userId, status: "PENDING" },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    });
    if (count === 0) throw new ConviteNaoEncontradoError();

    await mergeHouseholds(tx, origemId, destinoId);

    await tx.user.update({
      where: { id: scope.userId },
      data: { householdId: destinoId },
    });

    // Os convites que eu recebi de terceiros vivem sob o `householdId` deles e
    // nao morrem na cascata do espaco que estou deixando. Sem isto eu ficaria
    // com um convite de outra pessoa esperando resposta numa tela que ja nao
    // faz sentido. Vem depois da guarda de proposito: antes dela, apagaria o
    // ACCEPTED que ela acabou de escrever.
    await tx.householdInvite.updateMany({
      where: { inviteeId: scope.userId, status: "PENDING" },
      data: { status: "CANCELLED", respondedAt: new Date() },
    });

    // O espaco que esvaziei. A cascata leva junto os convites que ele enviou —
    // que a fusao ja deixou cancelados, para o caso de outro chamador dela nao
    // apagar o espaco.
    await tx.household.delete({ where: { id: origemId } });

    await tx.notification.create({
      data: {
        userId: invite.inviterId,
        title: "Convite aceito",
        body: `${invite.inviteeEmail} entrou na sua conta conjunta. As categorias e orçamentos de vocês agora são um conjunto só.`,
        link: LINK_CONJUNTA,
      },
    });
  }, TRANSACAO_DA_FUSAO);

  return getHouseholdState(await resolveScope(scope.userId));
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

/**
 * A dissolução é maior que a fusão, e o teto de tempo acompanha.
 *
 * A fusão faz ~4 idas ao banco por categoria absorvida; a dissolução copia cada
 * categoria **por membro** e religa por membro — no maior espaço real, 22
 * categorias, um casal chega perto de 230 idas sequenciais contra um Neon
 * remoto. Com 25 ms por ida isso é ~6 s, e um dia ruim de 100 ms ainda cabe nos
 * 40 s. Somado ao `maxWait`, o pior caso são 48 s, abaixo dos 60 s da função da
 * Vercel.
 */
const TRANSACAO_DA_DISSOLUCAO = { timeout: 40_000, maxWait: 8_000 } as const;

/**
 * Sair dissolve o espaço: cada um leva uma cópia do conjunto do casal.
 *
 * A guarda de verdade é a primeira escrita da transação, e não a leitura de
 * antes. O `where` do `updateMany` carrega o estado que torna a saída válida —
 * o espaço ainda existe e ainda tem gente nele — e o `count` diz quantos eram.
 * É o que resolve os dois "sair" simultâneos: as duas transações começam
 * escrevendo nas **mesmas** linhas de usuário, então a segunda espera a primeira
 * commitar e reavalia o `where` já com os membros em espaços novos — casa zero
 * linhas e volta atrás inteira. Um `findFirst` antes não daria isso: os dois
 * leriam "somos dois" e os dois dissolveriam.
 *
 * O `data` só toca as linhas (o `updatedAt` já seria reescrito pela mudança de
 * espaço logo adiante): o que importa aqui é o bloqueio e a contagem, não o
 * valor. Como todas as saídas escrevem esse mesmo conjunto de linhas primeiro, e
 * numa ordem só, não há como duas se travarem em cruz.
 *
 * A checagem de `memberIds` antes é atalho, não guarda: evita abrir transação
 * para quem está sozinho e já sabe disso pela própria tela.
 */
export async function leaveHousehold(scope: Scope): Promise<HouseholdStateDTO> {
  if (scope.memberIds.length < 2) {
    // Nao ha de quem se separar, e dissolver aqui seria trocar o espaco por
    // outro identico: trabalho e risco por nada.
    throw new UnprocessableError("Você não está numa conta conjunta");
  }

  const antigo = scope.householdId;
  const outros = scope.memberIds.filter((id) => id !== scope.userId);

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.user.updateMany({
      where: { householdId: antigo },
      data: { updatedAt: new Date() },
    });
    if (count < 2) throw new UnprocessableError("Você não está numa conta conjunta");

    await splitHousehold(tx, antigo);

    for (const membroId of [...outros, scope.userId]) {
      await tx.notification.create({
        data: {
          userId: membroId,
          title: "Conta conjunta desfeita",
          body: "Cada um voltou a ter as próprias categorias, orçamentos e metas, com o histórico preservado.",
          link: LINK_CONJUNTA,
        },
      });
    }
  }, TRANSACAO_DA_DISSOLUCAO);

  return getHouseholdState(await resolveScope(scope.userId));
}
