import { createHash } from "node:crypto";
import { merchantKey } from "./categorization/normalize";

/**
 * A chave que junta as parcelas de uma mesma compra.
 *
 * A Pluggy nao manda identificador de compra nenhum: manda N transacoes que so
 * se parecem. Entao a chave e derivada — e derivada de coisas estaveis entre as
 * parcelas, que sao a conta, o dia da compra, o lojista e o total de parcelas.
 *
 * O que **nao** entra: o valor da parcela (que pode variar em centavos no
 * arredondamento) e o numero da parcela (que e justamente o que difere).
 */
export interface EntradaDeCompra {
  accountId: string;
  date: Date;
  description: string;
  /** `creditCardMetadata.purchaseDate`, quando a Pluggy o manda. */
  purchaseDate?: Date | null;
  /** `merchant.cnpj`, quando vem. Estavel, e por isso tem precedencia. */
  cnpj?: string | null;
  totalInstallments?: number | null;
}

/** "YYYY-MM-DD" em UTC. A hora nao entra: parcelas podem chegar em horas diferentes. */
function diaDe(data: Date): string {
  return data.toISOString().slice(0, 10);
}

/**
 * A chave, ou null quando nao ha compra a agrupar.
 *
 * Devolve null em dois casos, e os dois sao deliberados: compra a vista (um
 * grupo de um item e ruido na tela) e lojista irreconhecivel (agrupar por acaso
 * e pior que nao agrupar).
 */
export function purchaseKeyDe(entrada: EntradaDeCompra): string | null {
  const total = entrada.totalInstallments;
  if (typeof total !== "number" || !Number.isInteger(total) || total < 2) return null;

  // CNPJ antes da descricao: descricao de cartao carrega o numero da parcela e
  // a cidade, e varia entre as linhas da mesma compra.
  const lojista = entrada.cnpj?.replace(/\D/g, "") || merchantKey(entrada.description);
  if (!lojista) return null;

  const dia = diaDe(entrada.purchaseDate ?? entrada.date);

  return createHash("sha1")
    .update([entrada.accountId, dia, lojista, String(total)].join("|"))
    .digest("hex");
}
