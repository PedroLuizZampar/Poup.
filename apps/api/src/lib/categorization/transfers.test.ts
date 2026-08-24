import { describe, expect, it } from "vitest";
import {
  TRANSFER_WINDOW_DAYS,
  detectTransferPairs,
  type TransferCandidate,
} from "./transfers";

function tx(over: Partial<TransferCandidate> & { id: string }): TransferCandidate {
  return {
    accountId: "conta-corrente",
    accountType: "CHECKING",
    amount: 100,
    type: "EXPENSE",
    date: new Date("2026-08-10T00:00:00Z"),
    transferPairId: null,
    ...over,
  };
}

describe("detectTransferPairs", () => {
  it("pareia sinais opostos de mesmo valor em contas diferentes", () => {
    const saida = tx({ id: "a" });
    const entrada = tx({ id: "b", accountId: "poupanca", type: "INCOME" });

    expect(detectTransferPairs([saida], [saida, entrada])).toEqual([
      { aId: "a", bId: "b" },
    ]);
  });

  it("não pareia quando uma das pontas é cartão de crédito", () => {
    // O pagamento de fatura tem dono proprio: `reconhecerPagamentos`, que tem a
    // fatura na mao para confirmar e marca as duas pontas como "Pagamento de
    // fatura". Enquanto os dois mecanismos disputavam o mesmo par, o resultado
    // dependia de quem chegasse primeiro — e no caso real uma das pontas ficou
    // sem marcacao nenhuma, contando como receita no relatorio.
    const debito = tx({ id: "a" });
    const creditoNoCartao = tx({
      id: "b",
      accountId: "cartao",
      accountType: "CREDIT",
      type: "INCOME",
    });

    expect(detectTransferPairs([debito], [debito, creditoNoCartao])).toEqual([]);
  });

  it("não pareia nem quando o cartão é o candidato", () => {
    // A regra vale nos dois sentidos: qual das duas pontas entrou no lote de
    // novas nao pode mudar a classificacao.
    const creditoNoCartao = tx({
      id: "b",
      accountId: "cartao",
      accountType: "CREDIT",
      type: "INCOME",
    });
    const debito = tx({ id: "a" });

    expect(detectTransferPairs([creditoNoCartao], [creditoNoCartao, debito])).toEqual([]);
  });

  it("pareia mesmo sinal quando uma das contas é poupança (o caso -100/-100)", () => {
    const saida = tx({ id: "a" });
    const aplicacao = tx({
      id: "b",
      accountId: "poupanca",
      accountType: "SAVINGS",
      type: "EXPENSE",
    });

    expect(detectTransferPairs([saida], [saida, aplicacao])).toEqual([
      { aId: "a", bId: "b" },
    ]);
  });

  it("pareia mesmo sinal quando a conta é de investimento", () => {
    const saida = tx({ id: "a" });
    const aplicacao = tx({
      id: "b",
      accountId: "corretora",
      accountType: "INVESTMENT",
      type: "EXPENSE",
    });

    expect(detectTransferPairs([saida], [saida, aplicacao])).toHaveLength(1);
  });

  it("não pareia mesmo sinal entre duas contas correntes", () => {
    const uma = tx({ id: "a" });
    const outra = tx({ id: "b", accountId: "outra-corrente" });

    expect(detectTransferPairs([uma], [uma, outra])).toEqual([]);
  });

  it("não pareia valores diferentes", () => {
    const saida = tx({ id: "a" });
    const entrada = tx({ id: "b", accountId: "poupanca", type: "INCOME", amount: 99.99 });

    expect(detectTransferPairs([saida], [saida, entrada])).toEqual([]);
  });

  it("não pareia na mesma conta", () => {
    const saida = tx({ id: "a" });
    const entrada = tx({ id: "b", type: "INCOME" });

    expect(detectTransferPairs([saida], [saida, entrada])).toEqual([]);
  });

  it("pareia dentro da janela e recusa fora dela", () => {
    const saida = tx({ id: "a" });
    const dentro = tx({
      id: "b",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-13T00:00:00Z"),
    });
    const fora = tx({
      id: "c",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-14T01:00:00Z"),
    });

    expect(TRANSFER_WINDOW_DAYS).toBe(3);
    expect(detectTransferPairs([saida], [saida, dentro])).toHaveLength(1);
    expect(detectTransferPairs([saida], [saida, fora])).toEqual([]);
  });

  it("escolhe a contraparte de data mais próxima quando há várias", () => {
    const saida = tx({ id: "a", date: new Date("2026-08-10T00:00:00Z") });
    const longe = tx({
      id: "b",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-12T00:00:00Z"),
    });
    const perto = tx({
      id: "c",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-11T00:00:00Z"),
    });

    expect(detectTransferPairs([saida], [saida, longe, perto])).toEqual([
      { aId: "a", bId: "c" },
    ]);
  });

  it("não pareia quando duas contrapartes estão à mesma distância", () => {
    const saida = tx({ id: "a", date: new Date("2026-08-10T00:00:00Z") });
    const antes = tx({
      id: "b",
      accountId: "poupanca",
      type: "INCOME",
      date: new Date("2026-08-09T00:00:00Z"),
    });
    const depois = tx({
      id: "c",
      accountId: "corretora",
      type: "INCOME",
      date: new Date("2026-08-11T00:00:00Z"),
    });

    expect(detectTransferPairs([saida], [saida, antes, depois])).toEqual([]);
  });

  it("ignora quem já está pareado, dos dois lados", () => {
    const jaPareada = tx({ id: "a", transferPairId: "par-antigo" });
    const livre = tx({ id: "b", accountId: "poupanca", type: "INCOME" });
    expect(detectTransferPairs([jaPareada], [jaPareada, livre])).toEqual([]);

    const saida = tx({ id: "c" });
    const contraparteOcupada = tx({
      id: "d",
      accountId: "poupanca",
      type: "INCOME",
      transferPairId: "par-antigo",
    });
    expect(detectTransferPairs([saida], [saida, contraparteOcupada])).toEqual([]);
  });

  it("não usa a mesma contraparte para dois candidatos", () => {
    const primeira = tx({ id: "a" });
    const segunda = tx({ id: "b" });
    const unica = tx({ id: "c", accountId: "poupanca", type: "INCOME" });

    const pairs = detectTransferPairs([primeira, segunda], [primeira, segunda, unica]);
    expect(pairs).toHaveLength(1);
  });
});
