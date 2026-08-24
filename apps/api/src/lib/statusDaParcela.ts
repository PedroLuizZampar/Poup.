import type { InstallmentStatus } from "@poup/shared";

/** O que a fatura precisa dizer para que o estado da parcela se decida. */
export interface FaturaDaParcela {
  dueDate: Date;
  paidAt: Date | null;
}

/**
 * Em que pe esta uma parcela, a partir da fatura em que ela caiu.
 *
 * A regra toda esta em **so afirmar o que a fatura prova**. Uma parcela cuja
 * fatura o app nao tem nao e vencida — e desconhecida, e o desconhecido cai em
 * `FORECAST` junto com as parcelas que ainda nao foram faturadas.
 *
 * Isso nao e cautela abstrata: o conector do Inter nao devolve fatura nenhuma.
 * Deduzir "vencida" da data que passou pintaria de vermelho o parcelamento
 * inteiro de quem usa aquele cartao, sem que nada esteja errado.
 *
 * `agora` e injetavel porque uma funcao que le o relogio por dentro nao tem
 * como ser testada na virada do vencimento.
 */
export function statusDaParcela(
  fatura: FaturaDaParcela | null | undefined,
  agora: Date = new Date()
): InstallmentStatus {
  if (!fatura) return "FORECAST";
  if (fatura.paidAt) return "PAID";
  return fatura.dueDate.getTime() < agora.getTime() ? "OVERDUE" : "OPEN";
}
