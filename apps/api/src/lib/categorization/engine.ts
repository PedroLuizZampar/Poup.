import { merchantKey } from "./normalize";
import { CATEGORIZATION_RULES } from "./rules";

/**
 * De onde sai o palpite, em ordem de quem conhece mais o usuário.
 *
 * O histórico vem primeiro porque é a única fonte que sabe que ESTE usuário põe
 * a farmácia em Saúde e não em Casa. A tabela de palavras-chave é a rede de
 * segurança para quem ainda não tem histórico, e a categoria da Pluggy é o
 * último recurso — ela acerta a família do gasto e erra o vocabulário.
 */

export const RULE_CONFIDENCE = 0.5;
export const PLUGGY_CONFIDENCE = 0.35;

/** chave de comerciante -> (categoria -> quantas vezes) */
export type HistoryIndex = Map<string, Map<string, number>>;

export interface CategoryRef {
  id: string;
  name: string;
}

export interface SuggestionContext {
  history: HistoryIndex;
  /** Apenas as selecionáveis: categoria de sistema nunca é sugerida. */
  categories: CategoryRef[];
}

export interface SuggestionInput {
  description: string;
  pluggyCategory?: string | null;
}

export interface Suggestion {
  categoryId: string;
  source: "HISTORY" | "RULE" | "PLUGGY";
  confidence: number;
}

export function buildHistoryIndex(
  entries: { description: string; categoryId: string }[]
): HistoryIndex {
  const index: HistoryIndex = new Map();

  for (const entry of entries) {
    const key = merchantKey(entry.description);
    if (key === null) continue;

    let porCategoria = index.get(key);
    if (!porCategoria) {
      porCategoria = new Map();
      index.set(key, porCategoria);
    }
    porCategoria.set(entry.categoryId, (porCategoria.get(entry.categoryId) ?? 0) + 1);
  }

  return index;
}

function fromHistory(description: string, ctx: SuggestionContext): Suggestion | null {
  const key = merchantKey(description);
  if (key === null) return null;

  const porCategoria = ctx.history.get(key);
  if (!porCategoria || porCategoria.size === 0) return null;

  let melhorId: string | null = null;
  let melhorContagem = 0;
  let total = 0;

  for (const [categoryId, contagem] of porCategoria) {
    total += contagem;
    if (contagem > melhorContagem) {
      melhorContagem = contagem;
      melhorId = categoryId;
    }
  }

  if (melhorId === null) return null;
  if (!ctx.categories.some((c) => c.id === melhorId)) return null;

  return { categoryId: melhorId, source: "HISTORY", confidence: melhorContagem / total };
}

/**
 * Só a descrição, de propósito. Jogar a categoria da Pluggy nesta busca faria
 * "Lazer" casar com a palavra-chave "lazer" e voltar como RULE — o palpite
 * viria do banco mas seria anunciado ao usuário como "pelo nome do
 * estabelecimento", com a confiança da fonte errada.
 */
function fromRules(description: string, ctx: SuggestionContext): Suggestion | null {
  const text = description.toLowerCase();

  for (const rule of CATEGORIZATION_RULES) {
    if (!rule.keywords.some((keyword) => text.includes(keyword))) continue;

    const match = ctx.categories.find(
      (category) => category.name.toLowerCase() === rule.targetName.toLowerCase()
    );
    if (match) {
      return { categoryId: match.id, source: "RULE", confidence: RULE_CONFIDENCE };
    }
  }

  return null;
}

function fromPluggy(
  pluggyCategory: string | null | undefined,
  ctx: SuggestionContext
): Suggestion | null {
  if (!pluggyCategory) return null;

  const alvo = pluggyCategory.toLowerCase();
  const match = ctx.categories.find((category) => {
    const name = category.name.toLowerCase();
    return name.includes(alvo) || alvo.includes(name);
  });

  if (!match) return null;
  return { categoryId: match.id, source: "PLUGGY", confidence: PLUGGY_CONFIDENCE };
}

export function suggestCategory(
  input: SuggestionInput,
  ctx: SuggestionContext
): Suggestion | null {
  if (ctx.categories.length === 0) return null;

  return (
    fromHistory(input.description, ctx) ??
    fromRules(input.description, ctx) ??
    fromPluggy(input.pluggyCategory, ctx)
  );
}
