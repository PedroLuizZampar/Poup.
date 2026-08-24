import type { Account as PluggyAccount, Transaction as PluggyTransaction } from "pluggy-sdk";

/**
 * O que a Pluggy manda, traduzido — e nada mais.
 *
 * Estas decisoes viviam dentro do laco do `syncItem`, cercadas de Prisma e de
 * rede, e por isso nunca tiveram teste. Uma delas estava errada havia meses: o
 * estorno de cartao, que chega como CREDIT com valor negativo, era gravado como
 * despesa. Aqui elas sao funcoes puras, e o caso do estorno e um teste de
 * quatro linhas.
 */

/** Quando a Pluggy nao diz quando a fatura vence, o app assume dia 10. */
export const DIA_DE_VENCIMENTO_PADRAO = 10;

/**
 * O valor, sempre positivo — o sinal mora em `type`, e essa e a invariante que
 * o resto do app assume (filtro de faixa de valor, soma de relatorio).
 *
 * Nao-finito vira zero de proposito: um `NaN` viraria `Prisma.Decimal`
 * invalido e derrubaria o `createMany` do lote inteiro, e nao so a linha ruim.
 */
export function valorAbsoluto(raw: number | null | undefined): number {
  if (raw == null || !Number.isFinite(raw)) return 0;
  return Math.abs(raw);
}

/**
 * A direcao do dinheiro.
 *
 * `type` e o dado; o sinal do valor e o palpite. A versao antiga usava os dois
 * ao mesmo tempo (`type === "DEBIT" || raw < 0`), e num cartao de credito isso
 * inverte todo estorno: compra vem DEBIT com valor positivo, devolucao vem
 * CREDIT com valor **negativo**. O `raw < 0` ganhava, e a devolucao virava
 * despesa.
 */
export function sinalDaTransacao(
  type: string | null | undefined,
  raw: number | null | undefined
): "INCOME" | "EXPENSE" {
  const normalizado = String(type ?? "").toUpperCase();
  if (normalizado === "CREDIT") return "INCOME";
  if (normalizado === "DEBIT") return "EXPENSE";
  // Conector que nao mandou `type`: so resta o sinal.
  return (raw ?? 0) < 0 ? "EXPENSE" : "INCOME";
}

/** "YYYY-MM" a partir de um ano e um mes 1-based. */
function chaveDeMes(ano: number, mes: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

/**
 * O mes da fatura em que a transacao cai, como "YYYY-MM".
 *
 * Quando o conector e Open Finance, a Pluggy manda `billForecastDate` — o mes
 * que o proprio banco projetou, valido inclusive para lancamento pendente. Ele
 * ganha sempre.
 *
 * Sem ele, deriva: mes da transacao mais um. Cada parcela ja chega como uma
 * transacao na fatura dela, entao o numero da parcela nao entra nesta conta.
 *
 * A derivacao erra em um mes para compra feita depois do fechamento da fatura.
 * Modelar fechamento exigiria guardar o dia de fechamento e decidir o que fazer
 * quando ele muda, e so melhoraria os conectores que ja nao mandam
 * `billForecastDate`. Esta anotado no Backlog do spec.
 */
export function mesDaFatura(data: Date, billForecastDate?: string | null): string {
  if (billForecastDate && /^\d{4}-(0[1-9]|1[0-2])$/.test(billForecastDate)) {
    return billForecastDate;
  }

  const proximo = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth() + 1, 1));
  return chaveDeMes(proximo.getUTCFullYear(), proximo.getUTCMonth() + 1);
}

export interface DadosDeParcela {
  installmentIndex: number | null;
  installmentTotal: number | null;
  /** "YYYY-MM". Nulo fora de cartao de credito. */
  billMonth: string | null;
}

/** Um inteiro dentro de uma faixa, ou null. */
function inteiroNaFaixa(valor: unknown, min: number, max: number): number | null {
  if (typeof valor !== "number" || !Number.isInteger(valor)) return null;
  return valor >= min && valor <= max ? valor : null;
}

/**
 * Os tres campos de cartao de uma transacao.
 *
 * `creditCardMetadata` presente e o unico sinal confiavel de que a linha e de
 * cartao — dai `billMonth` sair preenchido mesmo para compra a vista, que tem
 * fatura sem ter parcela.
 *
 * Numero e total andam juntos: "3 de ?" e "? de 10" nao sao exibiveis, entao um
 * sem o outro derruba os dois.
 */
export function dadosDeParcela(
  pTx: Pick<PluggyTransaction, "date" | "creditCardMetadata">
): DadosDeParcela {
  const meta = pTx.creditCardMetadata;
  if (!meta) {
    return { installmentIndex: null, installmentTotal: null, billMonth: null };
  }

  const billMonth = mesDaFatura(new Date(pTx.date), meta.billForecastDate);
  const total = inteiroNaFaixa(meta.totalInstallments, 1, 999);
  const indice = total === null ? null : inteiroNaFaixa(meta.installmentNumber, 1, total);

  return indice === null
    ? { installmentIndex: null, installmentTotal: null, billMonth }
    : { installmentIndex: indice, installmentTotal: total, billMonth };
}

/**
 * A data de vencimento, do cruzamento do mes da fatura com o dia da conta.
 *
 * Nao e coluna de propósito: derivar na leitura faz com que corrigir o dia de
 * vencimento do cartao conserte todas as parcelas de uma vez, sem backfill.
 *
 * O limite ao ultimo dia do mes existe para vencimento 31 em fevereiro. Sem
 * ele, `Date.UTC(2026, 1, 31)` vira 3 de marco em silencio.
 */
export function vencimentoDaFatura(billMonth: string | null, dueDay: number | null): Date | null {
  if (!billMonth || dueDay == null) return null;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(billMonth)) return null;
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return null;

  const [ano, mes] = billMonth.split("-").map(Number);
  // Dia 0 do mes seguinte e o ultimo dia deste.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return new Date(Date.UTC(ano, mes - 1, Math.min(dueDay, ultimoDia)));
}

/**
 * O dia de vencimento com que uma conta de credito nasce.
 *
 * A Pluggy manda a data de vencimento da fatura corrente; o dia dela e o que
 * vale para as proximas. Sem esse dado, 10 — um numero comum, e sobretudo um
 * numero, porque a tela exige que o campo nunca fique vazio.
 */
export function diaDeVencimentoInicial(pAccount: Pick<PluggyAccount, "creditData">): number {
  const bruta = pAccount?.creditData?.balanceDueDate;
  if (!bruta) return DIA_DE_VENCIMENTO_PADRAO;

  const data = bruta instanceof Date ? bruta : new Date(bruta);
  if (Number.isNaN(data.getTime())) return DIA_DE_VENCIMENTO_PADRAO;

  const dia = data.getUTCDate();
  return dia >= 1 && dia <= 31 ? dia : DIA_DE_VENCIMENTO_PADRAO;
}
