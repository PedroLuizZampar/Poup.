/**
 * Encontrar as duas pontas de uma transferência entre contas do próprio usuário.
 *
 * A Pluggy não entrega nada que ligue uma ponta à outra: chegam duas linhas
 * independentes, de contas independentes. O que resta é parear por valor e data,
 * e o cuidado todo está em errar para menos — este é o único caminho do sistema
 * que grava uma categoria sem passar pelo usuário.
 *
 * O caso que quebra a intuição é a poupança: depositar 100 na poupança aparece
 * como saída de 100 nas DUAS pontas, porque o extrato da poupança registra a
 * aplicação como débito. Por isso "mesmo sinal" é aceito — mas só quando uma das
 * contas é de poupança ou investimento. Entre duas contas correntes, duas
 * despesas de mesmo valor no mesmo dia são só duas despesas.
 */

export const TRANSFER_WINDOW_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TransferCandidate {
  id: string;
  accountId: string;
  /**
   * `DEBIT_CARD` nunca vem do sync — e um rotulo manual sobre uma conta
   * corrente. Ele entra aqui porque o tipo efetivo da conta pode traze-lo, e
   * de proposito fica fora de `acumula`: cartao de debito e conta corrente, e
   * duas despesas de mesmo valor entre duas contas correntes sao so duas
   * despesas.
   */
  accountType: "CHECKING" | "SAVINGS" | "CREDIT" | "DEBIT_CARD" | "INVESTMENT";
  /** Sempre o módulo: o sinal está em `type`. */
  amount: number;
  type: "INCOME" | "EXPENSE";
  date: Date;
  transferPairId: string | null;
}

export interface TransferPair {
  aId: string;
  bId: string;
}

function acumula(candidate: TransferCandidate): boolean {
  return candidate.accountType === "SAVINGS" || candidate.accountType === "INVESTMENT";
}

function podeParear(a: TransferCandidate, b: TransferCandidate): boolean {
  if (a.id === b.id) return false;
  if (a.accountId === b.accountId) return false;
  if (a.transferPairId !== null || b.transferPairId !== null) return false;
  if (a.amount !== b.amount) return false;
  if (Math.abs(a.date.getTime() - b.date.getTime()) > TRANSFER_WINDOW_DAYS * DAY_MS) {
    return false;
  }
  if (a.type !== b.type) return true;
  return acumula(a) || acumula(b);
}

export function detectTransferPairs(
  candidates: TransferCandidate[],
  universe: TransferCandidate[]
): TransferPair[] {
  const pairs: TransferPair[] = [];
  const usados = new Set<string>();

  for (const candidate of candidates) {
    if (usados.has(candidate.id)) continue;
    if (candidate.transferPairId !== null) continue;

    const contrapartes = universe.filter(
      (other) => !usados.has(other.id) && podeParear(candidate, other)
    );
    if (contrapartes.length === 0) continue;

    const distancia = (other: TransferCandidate) =>
      Math.abs(other.date.getTime() - candidate.date.getTime());

    const menor = Math.min(...contrapartes.map(distancia));
    const maisProximas = contrapartes.filter((other) => distancia(other) === menor);

    // Empate significa que a informação disponível não decide. Marcar uma das
    // duas seria adivinhar num caminho que não pede confirmação a ninguém.
    if (maisProximas.length !== 1) continue;

    const escolhida = maisProximas[0];
    usados.add(candidate.id);
    usados.add(escolhida.id);
    pairs.push({ aId: candidate.id, bId: escolhida.id });
  }

  return pairs;
}
