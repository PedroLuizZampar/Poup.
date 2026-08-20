import "dotenv/config";
import { z } from "zod";

/**
 * As credenciais da Pluggy (client id/secret) e os ids de item **não** vivem
 * mais aqui: eles pertencem ao usuário e ficam no banco, cadastrados pelo app.
 * O que resta no ambiente é só o que é da instalação, não da conta.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL não configurada"),
  PLUGGY_BASE_URL: z.string().url().default("https://api.pluggy.ai"),
  /** Chave de 32 bytes em base64 que cifra os segredos guardados no banco. */
  APP_ENCRYPTION_KEY: z.string().min(1, "APP_ENCRYPTION_KEY não configurada"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET precisa ter pelo menos 16 caracteres"),
  JWT_EXPIRES_IN: z.string().default("30d"),
  PORT: z.coerce.number().default(4000),
  /**
   * Origens extras aceitas pelo CORS, separadas por vírgula. O dev server do
   * Vite e as requisições sem `Origin` já passam sem isto; em produção, com o
   * app servido pela própria API, não há origem cruzada nenhuma.
   */
  CORS_ORIGINS: z.string().optional(),
});

export const env = envSchema.parse(process.env);
