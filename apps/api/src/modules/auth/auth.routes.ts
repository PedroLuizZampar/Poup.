import { Router } from "express";
import { z } from "zod";
import {
  login,
  register,
  getUserById,
  getPluggyCredentials,
  updatePluggyCredentials,
  updateProfile,
  changePassword,
  MIN_PASSWORD_LENGTH,
} from "./auth.service";
import { UserNotFoundError } from "../../lib/errors";
import { requireAuth } from "../../middleware/requireAuth";
import { asyncHandler } from "../../middleware/errorHandler";
import { rateLimit } from "../../middleware/rateLimit";

export const authRouter = Router();

/**
 * Cadastro e login são as duas portas abertas da API — as únicas rotas sem
 * `requireAuth`. Basta a origem ficar alcançável para alguém criar contas ou
 * tentar senhas em série; o limite por IP é a barreira mínima.
 */
const authAttemptLimit = rateLimit({
  scope: "auth",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.",
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório").optional(),
  email: z.string().email("Email inválido").optional(),
  avatarUrl: z.string().nullable().optional(),
  currentPassword: z.string().optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Informe a senha atual"),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `A nova senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres`),
});

const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Nome é obrigatório"),
    email: z.string().email("Email inválido"),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres`),
    confirmPassword: z.string().min(1, "Confirme a senha"),
    pluggyClientId: z.string().trim().min(1, "Informe o Client ID da Pluggy"),
    pluggyClientSecret: z.string().trim().min(1, "Informe o Client Secret da Pluggy"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não conferem",
    path: ["confirmPassword"],
  });

const pluggyCredentialsSchema = z.object({
  clientId: z.string().trim().min(1, "Informe o Client ID da Pluggy"),
  clientSecret: z.string().trim().min(1, "Informe o Client Secret da Pluggy"),
  currentPassword: z.string().min(1, "Informe a senha atual"),
});

authRouter.post(
  "/login",
  authAttemptLimit,
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    res.json(await login(email, password));
  })
);

authRouter.post(
  "/register",
  authAttemptLimit,
  asyncHandler(async (req, res) => {
    const result = await register(registerSchema.parse(req.body));
    res.status(201).json(result);
  })
);

authRouter.get(
  "/pluggy-credentials",
  requireAuth,
  asyncHandler(async (req, res) => {
    const credentials = await getPluggyCredentials(req.userId!);
    res.json({ credentials });
  })
);

authRouter.patch(
  "/pluggy-credentials",
  requireAuth,
  asyncHandler(async (req, res) => {
    const credentials = await updatePluggyCredentials(
      req.userId!,
      pluggyCredentialsSchema.parse(req.body)
    );
    res.json({ credentials });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.userId!);
    if (!user) {
      throw new UserNotFoundError();
    }
    res.json({ user });
  })
);

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await updateProfile(req.userId!, updateProfileSchema.parse(req.body));
    res.json({ user });
  })
);

authRouter.patch(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await changePassword(req.userId!, currentPassword, newPassword);
    res.json({ success: true });
  })
);
