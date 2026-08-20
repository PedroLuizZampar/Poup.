/**
 * Imagens escolhidas pelo usuário (foto de perfil, logo de banco) são enviadas
 * como data URL dentro do JSON da API. Redimensionamos antes de enviar para que
 * o payload fique na casa das dezenas de KB em vez dos megabytes de uma foto de
 * câmera — o servidor recusa acima de 512KB.
 */

const MAX_DIMENSION = 256;
const JPEG_QUALITY = 0.85;

export class ImageReadError extends Error {}

/** Tamanho máximo do arquivo original aceito antes de redimensionar. */
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new ImageReadError("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageReadError("O arquivo não é uma imagem válida."));
    img.src = src;
  });
}

/**
 * Lê um arquivo de imagem e devolve um data URL quadrado de até 256px.
 *
 * SVG passa direto: é vetorial, já é pequeno, e rasterizar destruiria a
 * qualidade justamente nos logos de banco, que é onde ele mais aparece.
 */
export async function fileToResizedDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new ImageReadError("Selecione um arquivo de imagem.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageReadError("A imagem é grande demais (máximo 10MB).");
  }

  const original = await readFileAsDataUrl(file);

  if (file.type === "image/svg+xml") {
    return original;
  }

  const img = await loadImage(original);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ImageReadError("Não foi possível processar a imagem.");
  }

  // PNG e WebP costumam trazer transparência (logos de banco quase sempre têm).
  // Convertê-los para JPEG pintaria o fundo de preto, então mantemos PNG nesses
  // casos e só usamos JPEG para fotos, onde ele economiza de verdade.
  const keepsAlpha = file.type === "image/png" || file.type === "image/webp";
  ctx.drawImage(img, 0, 0, width, height);

  return keepsAlpha
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
