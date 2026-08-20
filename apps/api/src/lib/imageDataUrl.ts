import { BadRequestError } from "./errors";

/**
 * Imagens enviadas pelo app (foto de perfil, logo de banco) viajam como data
 * URL base64 dentro do JSON. O cliente já redimensiona antes de enviar; aqui
 * apenas garantimos que o que chega é mesmo uma imagem e cabe no limite.
 */

/** ~512KB de payload já codificado em base64. */
const MAX_DATA_URL_LENGTH = 512 * 1024;

const DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

export class InvalidImageError extends BadRequestError {}

/**
 * Valida uma imagem recebida do cliente. `null` é válido e significa "remover".
 * Devolve o valor normalizado, pronto para gravar.
 */
export function validateImageDataUrl(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (value.length > MAX_DATA_URL_LENGTH) {
    throw new InvalidImageError("A imagem é grande demais (máximo 512KB).");
  }

  if (!DATA_URL_PATTERN.test(value)) {
    throw new InvalidImageError("Formato de imagem inválido.");
  }

  return value;
}
