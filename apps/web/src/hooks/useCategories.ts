import { useCallback, useEffect, useMemo, useState } from "react";
import type { CategoryDTO } from "@poup/shared";
import { fetchCategories } from "../lib/api";

export type CategoryMap = Record<string, CategoryDTO>;

/**
 * Índice de categorias por id.
 *
 * Este `useMemo` estava copiado em cinco arquivos — sempre com o mesmo nome, o
 * mesmo corpo e a mesma dependência. Para quem já recebe as categorias por
 * prop, é este hook que basta; quem precisa buscá-las usa `useCategories`.
 */
export function useCategoryMap(categories: CategoryDTO[]): CategoryMap {
  return useMemo(() => {
    const map: CategoryMap = {};
    for (const category of categories) {
      map[category.id] = category;
    }
    return map;
  }, [categories]);
}

export interface UseCategoriesResult {
  /** Só as selecionáveis: é o que todo seletor quer mostrar. */
  categories: CategoryDTO[];
  /** Todas, inclusive as de sistema — para desenhar o chip de uma transação. */
  allCategories: CategoryDTO[];
  categoryMap: CategoryMap;
  loading: boolean;
  /** Recarrega do servidor — use depois de criar, editar ou excluir. */
  reload: () => Promise<CategoryDTO[]>;
}

/** Busca as categorias do usuário e devolve a lista já indexada por id. */
export function useCategories(): UseCategoriesResult {
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const result = await fetchCategories();
      setCategories(result);
      return result;
    } catch (err) {
      console.error("Erro ao carregar categorias:", err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // O mapa continua com todas: a lista de transações precisa saber desenhar
  // "Transferência entre contas", que nenhum seletor deve oferecer.
  const selectable = useMemo(() => categories.filter((c) => !c.systemKey), [categories]);

  return {
    categories: selectable,
    allCategories: categories,
    categoryMap: useCategoryMap(categories),
    loading,
    reload,
  };
}
