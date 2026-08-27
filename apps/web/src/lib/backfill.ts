import { backfillAccount } from "./api";
import { contagem } from "./format";

export interface BackfillProgresso {
  /** Índice da conta sendo buscada, começando em 1. */
  atual: number;
  total: number;
}

export interface BackfillTotais {
  criadas: number;
  atualizadas: number;
  falhas: number;
}

/**
 * Busca o extrato inteiro de um conjunto de contas, uma de cada vez.
 *
 * O laço é do cliente de propósito: o servidor corta por conta porque o extrato
 * completo não tem tamanho conhecido e cada requisição precisa caber no tempo de
 * uma função. É aqui que dá para mostrar em qual delas está.
 */
export async function backfillContas(
  accountIds: string[],
  onProgresso: (p: BackfillProgresso) => void
): Promise<BackfillTotais> {
  const totais: BackfillTotais = { criadas: 0, atualizadas: 0, falhas: 0 };

  for (let i = 0; i < accountIds.length; i++) {
    onProgresso({ atual: i + 1, total: accountIds.length });
    try {
      const res = await backfillAccount(accountIds[i]);
      totais.criadas += res.created;
      totais.atualizadas += res.updated;
    } catch (err: any) {
      // Uma conta que falha não interrompe as outras: a busca é idempotente,
      // e trazer três de quatro é melhor que nenhuma.
      console.warn(`Falha ao buscar o histórico da conta ${accountIds[i]}:`, err?.message || err);
      totais.falhas++;
    }
  }

  return totais;
}

/** O texto do toast e se ele é de sucesso ou de erro. */
export function resumoDoBackfill(totais: BackfillTotais): { ok: boolean; texto: string } {
  if (totais.falhas > 0) {
    return {
      ok: false,
      texto:
        `${contagem(totais.criadas, "transação importada", "transações importadas")}, mas ` +
        `${contagem(totais.falhas, "conta falhou", "contas falharam")} por tempo esgotado. ` +
        "Tente de novo para continuar de onde parou.",
    };
  }

  if (totais.criadas === 0 && totais.atualizadas === 0) {
    return { ok: true, texto: "Nada novo: o histórico já está completo." };
  }

  return {
    ok: true,
    texto:
      `${contagem(totais.criadas, "transação importada", "transações importadas")} e ` +
      `${contagem(totais.atualizadas, "atualizada", "atualizadas")}.`,
  };
}
