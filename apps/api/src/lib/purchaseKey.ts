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
 * arredondamento) e o numero da parcela (que e justamente o que difere). Do
 * lojista entra so um prefixo, porque o conector corta a descricao no fim —
 * ver `PREFIXO_DO_LOJISTA`.
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
 * Quantos caracteres do lojista entram na chave.
 *
 * Existe porque o conector corta a descricao **no fim**, e corta diferente
 * conforme a parcela ja esteja postada ou ainda seja previsao. O caso real, do
 * Mercado Pago: as parcelas 1 a 3 chegaram como "MERCADOLIVRE*AUMAIMPOR" e as
 * 4 a 8 como "MERCADOLIVRE*AUMA" — a mesma compra de 8x, no mesmo dia e na
 * mesma conta, partida em dois grupos na tela porque a chave via dois lojistas.
 *
 * O CNPJ resolveria sozinho e tem precedencia justamente por isso, mas veio
 * ausente em todas as linhas. Sobrou a descricao, e de uma descricao que pode
 * ser cortada no fim so o comeco e confiavel.
 *
 * O numero e um equilibrio, e erra para os dois lados se for mal escolhido:
 * curto demais junta compras que nao sao a mesma (dois vendedores do mesmo
 * marketplace, no mesmo dia, com o mesmo numero de parcelas); longo demais volta
 * a partir a compra que o conector cortou. Dezesseis preserva o marketplace
 * inteiro mais o comeco do vendedor — o suficiente para separar "AUMAIMPOR" de
 * "KAIRON" e curto o bastante para sobreviver ao corte.
 */
const PREFIXO_DO_LOJISTA = 16;

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
  // a cidade, e varia entre as linhas da mesma compra. Quando ele vem, entra
  // inteiro — e identificador, nao texto, e nao sofre corte.
  const cnpj = entrada.cnpj?.replace(/\D/g, "");
  const doTexto = merchantKey(entrada.description)?.slice(0, PREFIXO_DO_LOJISTA).trim();
  const lojista = cnpj || doTexto;
  if (!lojista) return null;

  const dia = diaDe(entrada.purchaseDate ?? entrada.date);

  return createHash("sha1")
    .update([entrada.accountId, dia, lojista, String(total)].join("|"))
    .digest("hex");
}
