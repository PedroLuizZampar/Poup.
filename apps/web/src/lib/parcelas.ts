import type { InstallmentDTO } from "@poup/shared";
import { formatDate } from "./format";

/**
 * O que a linha de uma parcela diz sobre a data dela.
 *
 * Cada estado fala de uma data diferente, e trocar as duas mostraria uma
 * informacao errada com cara de certa: "paga em 10/06" quando 10/06 e o
 * vencimento, e nao o dia em que o dinheiro saiu. Por isso a escolha da data e
 * do verbo anda junto, aqui, e nao espalhada pelo JSX.
 *
 * `FORECAST` cobre tanto a parcela que ainda vai ser faturada quanto aquela
 * cuja fatura o app nao tem — e por isso fala no futuro, sem afirmar nada sobre
 * pagamento.
 */
export function descricaoDaParcela(
  parcela: Pick<InstallmentDTO, "status" | "dueDate" | "paidAt">
): string {
  if (parcela.status === "PAID") {
    return parcela.paidAt ? `paga em ${formatDate(parcela.paidAt)}` : "paga";
  }

  if (!parcela.dueDate) {
    return parcela.status === "OVERDUE" ? "vencida" : "sem vencimento";
  }

  const data = formatDate(parcela.dueDate);
  return parcela.status === "OVERDUE" ? `venceu ${data}` : `vence ${data}`;
}
