/**
 * Reconhecer que um debito na conta corrente e o pagamento de uma fatura.
 *
 * O motivo e a duplicidade: a compra de R$ 300 no cartao ja e despesa, e o
 * debito de R$ 300 que quita a fatura nao e uma segunda despesa — e o mesmo
 * dinheiro saindo. Reconhecido, o debito vira transferencia, e transferencia ja
 * e excluida de todos os totais.
 *
 * Errar aqui e caro nas duas direcoes: nao reconhecer duplica o gasto;
 * reconhecer errado faz uma despesa real sumir do relatorio. Por isso o
 * casamento exige valor **exato** e proximidade de data, e nunca aproxima.
 */

/** Mesma janela do pareamento de transferencia, e pela mesma razao: a data que o banco registra nem sempre e a que o dinheiro andou. */
export const JANELA_DE_PAGAMENTO_DIAS = 3;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface FaturaPaga {
  billId: string;
  /** A conta **do cartao**. Serve para nao casar o debito com a propria fatura dele. */
  accountId: string;
  paidAt: Date;
  paidAmount: number;
}

export interface DebitoCandidato {
  id: string;
  accountId: string;
  date: Date;
  amount: number;
}

export interface Casamento {
  transactionId: string;
  billId: string;
}

/**
 * Casa faturas pagas com os debitos que as pagaram.
 *
 * Um debito casa com no maximo uma fatura, e uma fatura com no maximo um
 * debito: dois cartoes com faturas de mesmo valor no mesmo dia existem, e
 * deixar um debito quitar as duas inventaria dinheiro que nao saiu.
 *
 * Empate resolve pela proximidade da data — e, persistindo, pelo id, para que a
 * saida seja estavel entre execucoes.
 */
export function casarPagamentos(
  faturas: FaturaPaga[],
  candidatos: DebitoCandidato[]
): Casamento[] {
  const casamentos: Casamento[] = [];
  const usados = new Set<string>();

  for (const fatura of faturas) {
    const compativeis = candidatos
      .filter(
        (c) =>
          !usados.has(c.id) &&
          // O debito sai de outra conta: a ponta que mora no cartao ja e
          // tratada pelo pareamento de transferencia que existe.
          c.accountId !== fatura.accountId &&
          c.amount === fatura.paidAmount &&
          Math.abs(c.date.getTime() - fatura.paidAt.getTime()) <=
            JANELA_DE_PAGAMENTO_DIAS * DIA_MS
      )
      .sort((a, b) => {
        const distA = Math.abs(a.date.getTime() - fatura.paidAt.getTime());
        const distB = Math.abs(b.date.getTime() - fatura.paidAt.getTime());
        return distA === distB ? a.id.localeCompare(b.id) : distA - distB;
      });

    const escolhido = compativeis[0];
    if (!escolhido) continue;

    usados.add(escolhido.id);
    casamentos.push({ transactionId: escolhido.id, billId: fatura.billId });
  }

  return casamentos;
}

/**
 * Caixa baixa e sem acento, e so isso.
 *
 * `normalizeDescription`, da categorizacao, nao serve aqui: ela descarta
 * "pagamento", "cartao" e "credito" como stopwords — sao palavras que nao
 * distinguem um comerciante de outro. Aqui elas sao justamente o sinal, entao a
 * normalizacao precisa preserva-las.
 */
function semAcentoEmMinusculas(raw: string): string {
  return raw
    .normalize("NFD")
    // A faixa combinante do Unicode, escrita por codigo para que o arquivo nao
    // dependa de como o editor salva um acento solto.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * A reserva, para o conector que nao devolve fatura nenhuma.
 *
 * Deliberadamente estreita: exige a palavra do pagamento **e** a do cartao ou da
 * fatura, juntas. "PAGAMENTO ALUGUEL" tem a primeira e nao passa; "FATURA DE
 * ENERGIA" tem a segunda e nao passa.
 */
export function parecePagamentoDeFatura(description: string): boolean {
  const texto = semAcentoEmMinusculas(description);
  const temPagamento = /\b(pagto|pagamento)\b/.test(texto);
  if (!temPagamento) return false;
  return /\b(fatura|cartao|cartoes)\b/.test(texto);
}

/** Um debito que a descricao acusa de ser pagamento de fatura. */
export interface DebitoDescrito extends DebitoCandidato {
  description: string;
}

/** Um credito no extrato de uma conta de cartao do proprio usuario. */
export interface CreditoEmCartao {
  id: string;
  accountId: string;
  date: Date;
  amount: number;
}

/** As duas linhas de um mesmo pagamento de fatura. */
export interface PontasDoPagamento {
  /** O debito, na conta de onde o dinheiro saiu. */
  debitoId: string;
  /** O credito que o espelha, no extrato do cartao. */
  creditoId: string;
}

/**
 * Acha, para cada debito, o credito que o espelha no cartao.
 *
 * As duas pontas precisam ser marcadas juntas. Marcar so o debito — que era o
 * que o app fazia — deixa o credito do cartao contando como **receita**: no
 * caso real, um pagamento de R$ 94,62 aparecia como despesa abatida de um lado
 * e como entrada de dinheiro do outro, inflando o relatorio.
 *
 * Um credito espelha no maximo um debito: dois debitos de mesmo valor contra
 * uma quitacao so fariam duas despesas sumirem por um pagamento que aconteceu
 * uma vez. Empate resolve pela data e, persistindo, pelo id, para que a saida
 * seja estavel entre execucoes.
 */
export function casarPontas(
  debitos: DebitoCandidato[],
  creditos: CreditoEmCartao[]
): PontasDoPagamento[] {
  const pares: PontasDoPagamento[] = [];
  const usados = new Set<string>();

  for (const debito of debitos) {
    const compativeis = creditos
      .filter(
        (c) =>
          !usados.has(c.id) &&
          // O debito sai de outra conta. Um credito na propria conta do debito
          // nao e a outra ponta de nada.
          c.accountId !== debito.accountId &&
          c.amount === debito.amount &&
          Math.abs(c.date.getTime() - debito.date.getTime()) <=
            JANELA_DE_PAGAMENTO_DIAS * DIA_MS
      )
      .sort((a, b) => {
        const distA = Math.abs(a.date.getTime() - debito.date.getTime());
        const distB = Math.abs(b.date.getTime() - debito.date.getTime());
        return distA === distB ? a.id.localeCompare(b.id) : distA - distB;
      });

    const escolhido = compativeis[0];
    if (!escolhido) continue;

    usados.add(escolhido.id);
    pares.push({ debitoId: debito.id, creditoId: escolhido.id });
  }

  return pares;
}

/**
 * A reserva por descricao, **corroborada** pela outra ponta.
 *
 * A descricao sozinha nao basta, e o caso que provou isso e concreto: um
 * "Pagamento Cartão de crédito" de R$ 94,62 numa conta cujo cartao nao esta
 * vinculado ao app. `parecePagamentoDeFatura` diz sim, e a linha virava
 * pagamento de fatura — apagando dos relatorios uma despesa real, porque as
 * compras daquele cartao nunca foram importadas para compensa-la.
 *
 * A regra que resolve e a mesma que vale para transferencia entre contas: sem
 * as **duas** pontas vinculadas, nao se categoriza nada. Aqui a outra ponta e
 * um credito de valor identico numa conta de cartao do proprio usuario, dentro
 * da mesma janela de tres dias.
 *
 * Isso preserva o unico caso que justifica a reserva — o conector que nao
 * devolve fatura nenhuma (o do Inter e um). O cartao esta vinculado; o que
 * falta e a fatura. O credito da quitacao aparece no extrato do cartao do mesmo
 * jeito, e e ele que autoriza a descricao a decidir.
 *
 * Diferente do casamento por fatura, onde a fatura ja e prova suficiente e o
 * debito e reconhecido mesmo sem contraparte importada.
 */
export function casarPorDescricao(
  debitos: DebitoDescrito[],
  creditos: CreditoEmCartao[]
): PontasDoPagamento[] {
  return casarPontas(
    debitos.filter((d) => parecePagamentoDeFatura(d.description)),
    creditos
  );
}

/** O minimo de um `payments[]` da Pluggy para decidir qual deles quita. */
export interface PagamentoDeFatura {
  valueType: "INSTALLMENT_PAYMENT" | "FULL_PAYMENT" | "OTHER_PAYMENT";
  paymentDate: Date;
  amount: number;
}

/**
 * Qual dos pagamentos de uma fatura e a quitacao dela.
 *
 * A versao antiga pegava o ultimo por data, e isso quebrou no dia em que o
 * emissor lancou um **estorno** de compra como pagamento da fatura: a de agosto
 * de 2026, de R$ 94,62, ficou registrada como paga por R$ 272 — o valor da
 * compra devolvida, creditada no cartao onze dias depois da quitacao real.
 *
 * `OTHER_PAYMENT` e a gaveta do resto: e la que cai o credito que nao veio da
 * conta do usuario. Descartar a gaveta inteira custa o conector que nao
 * classifica nada — e esse custo e o barato dos dois, porque nao reconhecer
 * deixa a despesa no relatorio (e a reserva por descricao ainda tem chance de
 * acertar), enquanto reconhecer errado faz uma despesa real sumir.
 *
 * `INSTALLMENT_PAYMENT` fica: parcelar a fatura tambem e pagar a fatura, e o
 * debito da parcela existe na conta corrente esperando ser reconhecido.
 */
export function pagamentoQueQuita<T extends PagamentoDeFatura>(pagamentos: T[]): T | null {
  const classificados = pagamentos.filter((p) => p.valueType !== "OTHER_PAYMENT");

  // Pagamento parcial e depois o resto: quem quita e o ultimo.
  return (
    [...classificados]
      .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())
      .pop() ?? null
  );
}
