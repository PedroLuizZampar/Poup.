import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../../prisma";
import { env } from "../../env";
import { validateImageDataUrl } from "../../lib/imageDataUrl";
import { encryptSecret } from "../../lib/crypto";
import {
  createPluggyClient,
  invalidatePluggyClient,
  verifyPluggyCredentials,
} from "../../lib/pluggy";
import { createDefaultCategories } from "../../lib/defaultCategories";
import type { PluggyCredentialsDTO, UserDTO } from "@poup/shared";
import {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  UnprocessableError,
  UserNotFoundError,
} from "../../lib/errors";

export { UserNotFoundError };

export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    super("Email ou senha inválidos");
  }
}

/** Senha atual errada ao editar perfil ou trocar de senha. */
export class WrongPasswordError extends UnauthorizedError {
  constructor() {
    super("Senha atual incorreta", { field: "currentPassword" });
  }
}

export class EmailInUseError extends ConflictError {
  constructor() {
    super("Este email já está em uso", { field: "email" });
  }
}

/** Par client id/secret recusado pela própria Pluggy. */
export class InvalidPluggyCredentialsError extends UnprocessableError {
  constructor(field = "pluggyClientSecret") {
    super("A Pluggy recusou este client id / client secret", { field });
  }
}

export class PasswordMismatchError extends BadRequestError {
  constructor() {
    super("As senhas não conferem", { field: "confirmPassword" });
  }
}

export interface AuthTokenPayload {
  userId: string;
}

const MIN_PASSWORD_LENGTH = 8;

async function toUserDTO(user: {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  householdId: string;
}): Promise<UserDTO> {
  const household = await prisma.household.findUniqueOrThrow({
    where: { id: user.householdId },
    include: {
      members: { select: { id: true, name: true, avatarUrl: true } },
      invites: { include: { inviter: { select: { id: true, name: true, avatarUrl: true } } } },
    },
  });

  const invitesReceived = household.invites.filter(
    (inv) => inv.inviteeId === user.id && inv.status === "PENDING"
  );

  const invitesSent = household.invites.filter(
    (inv) => inv.householdId === household.id && inv.status === "PENDING" && inv.inviterId !== user.id
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    household: {
      id: household.id,
      members: household.members,
      invitesReceived: invitesReceived.map((inv) => ({
        id: inv.id,
        status: inv.status,
        inviter: inv.inviter,
        inviteeEmail: inv.inviteeEmail,
        createdAt: inv.createdAt.toISOString(),
      })),
      invitesSent: invitesSent.map((inv) => ({
        id: inv.id,
        status: inv.status,
        inviter: inv.inviter,
        inviteeEmail: inv.inviteeEmail,
        createdAt: inv.createdAt.toISOString(),
      })),
    },
  };
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, avatarUrl: true, passwordHash: true, householdId: true }
  });
  if (!user) {
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    throw new InvalidCredentialsError();
  }

  const signOptions: jwt.SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  };
  const token = jwt.sign({ userId: user.id } satisfies AuthTokenPayload, env.JWT_SECRET, signOptions);

  return {
    token,
    user: await toUserDTO(user),
  };
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  pluggyClientId: string;
  pluggyClientSecret: string;
}

/**
 * Cria a conta e já devolve a sessão, como o login.
 *
 * As credenciais da Pluggy são conferidas com a própria Pluggy **antes** de o
 * usuário existir: conta criada com credencial que não funciona é uma conta que
 * só falha na primeira sincronização, longe do formulário que a causou. A
 * confirmação de senha também é reconferida aqui — validar só no cliente deixa
 * a regra de fora de qualquer outro caminho que chame a API.
 */
export async function register(input: RegisterInput) {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (input.password !== input.confirmPassword) {
    throw new PasswordMismatchError();
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new EmailInUseError();
  }

  const clientId = input.pluggyClientId.trim();
  const clientSecret = input.pluggyClientSecret.trim();

  const credentialsOk = await verifyPluggyCredentials(clientId, clientSecret);
  if (!credentialsOk) {
    throw new InvalidPluggyCredentialsError();
  }

  await registrarWebhooks(clientId, clientSecret);

  const passwordHash = await bcrypt.hash(input.password, 10);

  // O usuário e o espaço nascem juntos, na mesma transação: um usuário sem
  // `householdId` não enxerga categoria, orçamento nem meta — é o espaço que
  // define o que ele pode ler —, então ele não pode existir sem espaço nem por
  // um instante. Falhar no meio não pode deixar para trás uma conta que faz
  // login e não carrega nenhuma tela.
  const user = await prisma.$transaction(async (tx) => {
    const household = await tx.household.create({ data: {} });

    const criado = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        pluggyClientId: clientId,
        pluggyClientSecret: encryptSecret(clientSecret),
        householdId: household.id,
      },
    });

    // Espaço sem categoria não categoriza a primeira transação nem cria
    // orçamento — e as categorias são do espaço, não do usuário.
    await createDefaultCategories(tx, household.id);

    return criado;
  });

  const signOptions: jwt.SignOptions = {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  };
  const token = jwt.sign({ userId: user.id } satisfies AuthTokenPayload, env.JWT_SECRET, signOptions);

  // Buscar os dados completos do usuário com avatar URL após criação
  const fullUser = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { id: true, email: true, name: true, avatarUrl: true, householdId: true }
  });

  return { token, user: await toUserDTO(fullUser) };
}

export async function getUserById(userId: string): Promise<UserDTO | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, avatarUrl: true, householdId: true },
  });

  return user ? await toUserDTO(user) : null;
}

export interface UpdateProfileInput {
  name?: string;
  email?: string;
  avatarUrl?: string | null;
  currentPassword?: string;
}

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<UserDTO> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UserNotFoundError();
  }

  const nextEmail = input.email?.trim().toLowerCase();
  const emailChanged = nextEmail !== undefined && nextEmail !== user.email;

  // Trocar o email é o que efetivamente muda a credencial de acesso, então é o
  // único campo do perfil que exige confirmar a senha atual.
  if (emailChanged) {
    if (!input.currentPassword) {
      throw new WrongPasswordError();
    }
    const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!matches) {
      throw new WrongPasswordError();
    }

    const existing = await prisma.user.findUnique({ where: { email: nextEmail } });
    if (existing && existing.id !== userId) {
      throw new EmailInUseError();
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined && { name: input.name.trim() }),
      ...(emailChanged && { email: nextEmail }),
      ...(input.avatarUrl !== undefined && { avatarUrl: validateImageDataUrl(input.avatarUrl) }),
    },
    select: { id: true, email: true, name: true, avatarUrl: true, householdId: true },
  });

  return await toUserDTO(updated);
}

/** O secret nunca sai da API: o app só precisa saber se existe um cadastrado. */
export async function getPluggyCredentials(userId: string): Promise<PluggyCredentialsDTO> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pluggyClientId: true, pluggyClientSecret: true },
  });

  if (!user) {
    throw new UserNotFoundError();
  }

  return {
    clientId: user.pluggyClientId,
    hasSecret: Boolean(user.pluggyClientSecret),
  };
}

/**
 * Registra os webhooks na aplicação Pluggy **do usuário**.
 *
 * Cada usuário fala com a Pluggy com a própria aplicação, então o webhook
 * precisa ser registrado uma vez por aplicação — e não uma vez no app. O
 * `itemId` do payload é quem diz depois de quem é o evento.
 *
 * `createPluggyClient` é usado no lugar de `new PluggyClient(...)` de propósito:
 * ele passa `baseUrl: env.PLUGGY_BASE_URL` junto, e instanciar o cliente à mão
 * deixaria o registro do webhook falando com o ambiente errado da Pluggy.
 *
 * Nunca derruba o salvamento das credenciais: um webhook que não registrou
 * deixa o app exatamente como ele é hoje, que é sincronizando pelo botão.
 */
async function registrarWebhooks(clientId: string, clientSecret: string): Promise<void> {
  const base = process.env.PUBLIC_API_URL;
  const segredo = process.env.PLUGGY_WEBHOOK_SECRET;

  if (!base || !segredo) {
    console.warn("PUBLIC_API_URL ou PLUGGY_WEBHOOK_SECRET ausentes: webhooks não registrados.");
    return;
  }

  try {
    const client = createPluggyClient(clientId, clientSecret);
    const url = `${base.replace(/\/$/, "")}/api/pluggy/webhook`;
    const existentes = await client.fetchWebhooks();

    for (const evento of ["transactions/created", "transactions/updated"] as const) {
      const jaTem = existentes.results.some(
        (w) => w.event === evento && w.url === url && !w.disabledAt
      );
      if (jaTem) continue;
      await client.createWebhook(evento, url, { "x-poup-webhook-secret": segredo });
    }
  } catch (err: any) {
    console.warn("Não foi possível registrar os webhooks na Pluggy:", err?.message || err);
  }
}

/**
 * Trocar as credenciais exige a senha atual: são credenciais de acesso a dados
 * bancários, no mesmo nível do email.
 */
export async function updatePluggyCredentials(
  userId: string,
  input: { clientId: string; clientSecret: string; currentPassword: string }
): Promise<PluggyCredentialsDTO> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UserNotFoundError();
  }

  const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!matches) {
    throw new WrongPasswordError();
  }

  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();

  const credentialsOk = await verifyPluggyCredentials(clientId, clientSecret);
  if (!credentialsOk) {
    throw new InvalidPluggyCredentialsError("clientSecret");
  }

  await registrarWebhooks(clientId, clientSecret);

  await prisma.user.update({
    where: { id: userId },
    data: { pluggyClientId: clientId, pluggyClientSecret: encryptSecret(clientSecret) },
  });

  // Sem isto, a próxima chamada usaria o cliente cacheado com a credencial antiga.
  invalidatePluggyClient(userId);

  return { clientId, hasSecret: true };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ success: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UserNotFoundError();
  }

  const matches = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!matches) {
    throw new WrongPasswordError();
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  return { success: true };
}

export { MIN_PASSWORD_LENGTH };
