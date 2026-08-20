/**
 * Resolução do logo de uma instituição financeira.
 *
 * Quatro fontes, nesta ordem de precedência:
 *
 * 1. `customImageUrl`: a imagem que o usuário enviou pelo app, guardada em
 *    `Item.customImageUrl`. Vence sobre tudo, e o sync não a sobrescreve.
 * 2. Arquivo local em `src/assets/institutions/<slug>.(svg|png|webp|jpg)`.
 * 3. `institutionImageUrl`, capturada do conector da Pluggy durante o sync
 *    (`connector.imageUrl`) e persistida em `Item`.
 * 4. Nada: quem chama desenha o ícone genérico de banco.
 *
 * O glob é resolvido em build: os arquivos entram no bundle com hash, com URL
 * absoluta e cache-busting de graça — o que também os torna precacheáveis pelo
 * service worker, ao contrário de caminhos soltos em `public/`.
 */

const localLogos = import.meta.glob<string>(
  "../assets/institutions/*.{svg,png,webp,jpg,jpeg}",
  { eager: true, query: "?url", import: "default" }
);

/** "Caixa Econômica Federal" -> "caixa-economica-federal" */
export function slugifyInstitution(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const localBySlug: Record<string, string> = {};
for (const [path, url] of Object.entries(localLogos)) {
  const file = path.split("/").pop() ?? "";
  const slug = file.replace(/\.[^.]+$/, "").toLowerCase();
  localBySlug[slug] = url;
}

/**
 * Retorna a URL do logo, ou null quando não há nem arquivo local nem imagem
 * vinda da API.
 */
export function resolveInstitutionLogo(
  institutionName?: string | null,
  apiImageUrl?: string | null,
  customImageUrl?: string | null
): string | null {
  if (customImageUrl) return customImageUrl;

  if (institutionName) {
    const local = localBySlug[slugifyInstitution(institutionName)];
    if (local) return local;
  }
  return apiImageUrl || null;
}
