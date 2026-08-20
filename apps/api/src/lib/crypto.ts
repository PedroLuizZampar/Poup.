import crypto from "node:crypto";
import { env } from "../env";
import { AppError } from "./errors";

/**
 * Cifragem simétrica dos segredos que precisam voltar em claro — hoje só o
 * `clientSecret` da Pluggy, que a API precisa reenviar à Pluggy a cada troca de
 * token (por isso hash não serve, como serve para senha).
 *
 * AES-256-GCM: além de cifrar, autentica. Uma linha adulterada no banco falha
 * na verificação da tag em vez de decifrar em lixo silencioso.
 *
 * Formato guardado: `v1:<iv b64>:<tag b64>:<ciphertext b64>`. O prefixo de
 * versão existe para que uma futura troca de algoritmo consiga distinguir o que
 * é velho sem adivinhar pelo tamanho.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const PREFIX = "v1";

export class MissingEncryptionKeyError extends AppError {
  constructor() {
    super(
      "APP_ENCRYPTION_KEY não configurada — sem ela os segredos guardados no banco não podem ser lidos",
      500,
      { code: "SECRET_UNREADABLE" }
    );
  }
}

export class CorruptedSecretError extends AppError {
  constructor() {
    super("Segredo guardado não pôde ser decifrado (chave trocada ou dado corrompido)", 500, {
      code: "SECRET_UNREADABLE",
    });
  }
}

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = env.APP_ENCRYPTION_KEY;
  if (!raw) {
    throw new MissingEncryptionKeyError();
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY precisa ser 32 bytes em base64 (gere com `openssl rand -base64 32`)");
  }

  cachedKey = key;
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new CorruptedSecretError();
  }

  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString(
      "utf8"
    );
  } catch (err) {
    if (err instanceof MissingEncryptionKeyError) throw err;
    throw new CorruptedSecretError();
  }
}
