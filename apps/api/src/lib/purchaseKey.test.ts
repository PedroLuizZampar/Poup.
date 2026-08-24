import { describe, expect, it } from "vitest";
import { purchaseKeyDe } from "./purchaseKey";

const base = {
  accountId: "conta-1",
  date: new Date("2026-08-03T00:00:00Z"),
  description: "LOJA X SAO PAULO",
  purchaseDate: new Date("2026-08-03T00:00:00Z"),
  totalInstallments: 10,
};

describe("purchaseKeyDe", () => {
  it("duas parcelas da mesma compra dao a mesma chave", () => {
    expect(purchaseKeyDe(base)).toBe(purchaseKeyDe({ ...base }));
  });

  it("ignora o numero da parcela grudado na descricao", () => {
    // "LOJA X 01/10" e "LOJA X 02/10" sao a mesma compra. `merchantKey` corta
    // nos tres primeiros tokens normalizados, entao o sufixo cai fora.
    const p1 = purchaseKeyDe({ ...base, description: "LOJA X SAO 01/10" });
    const p2 = purchaseKeyDe({ ...base, description: "LOJA X SAO 02/10" });
    expect(p1).toBe(p2);
  });

  it("compras em contas diferentes nao se juntam", () => {
    expect(purchaseKeyDe(base)).not.toBe(purchaseKeyDe({ ...base, accountId: "conta-2" }));
  });

  it("parcelamentos diferentes no mesmo lojista nao se juntam", () => {
    // Uma compra em 10x e outra em 3x no mesmo dia sao duas compras.
    expect(purchaseKeyDe(base)).not.toBe(purchaseKeyDe({ ...base, totalInstallments: 3 }));
  });

  it("dias diferentes nao se juntam", () => {
    expect(purchaseKeyDe(base)).not.toBe(
      purchaseKeyDe({ ...base, purchaseDate: new Date("2026-08-04T00:00:00Z") })
    );
  });

  it("o CNPJ tem precedencia sobre a descricao", () => {
    // Mesmo CNPJ, descricoes que nao casariam: ainda e a mesma compra.
    const a = purchaseKeyDe({ ...base, cnpj: "12345678000199", description: "LOJA X SAO" });
    const b = purchaseKeyDe({ ...base, cnpj: "12345678000199", description: "OUTRO NOME AQUI" });
    expect(a).toBe(b);
  });

  it("CNPJ diferente nao se junta", () => {
    const a = purchaseKeyDe({ ...base, cnpj: "12345678000199" });
    const b = purchaseKeyDe({ ...base, cnpj: "99999999000100" });
    expect(a).not.toBe(b);
  });

  it("cai na data da transacao quando nao ha purchaseDate", () => {
    const semCompra = purchaseKeyDe({ ...base, purchaseDate: null });
    expect(semCompra).not.toBeNull();
    // A `date` do base e o mesmo dia do purchaseDate, entao a chave coincide.
    expect(semCompra).toBe(purchaseKeyDe(base));
  });

  it("sem parcelamento nao ha compra a agrupar", () => {
    // Compra a vista nao vira grupo: um dropdown de uma parcela so e ruido.
    expect(purchaseKeyDe({ ...base, totalInstallments: null })).toBeNull();
    expect(purchaseKeyDe({ ...base, totalInstallments: 1 })).toBeNull();
  });

  it("descricao curta demais e sem CNPJ nao gera chave", () => {
    // Sem nada que identifique o lojista, agrupar seria juntar por acaso.
    expect(purchaseKeyDe({ ...base, description: "X", cnpj: null })).toBeNull();
  });

  it("a chave e estavel entre execucoes", () => {
    // Ela e gravada no banco: mudar o algoritmo silenciosamente separaria
    // parcelas ja agrupadas.
    expect(purchaseKeyDe(base)).toBe(purchaseKeyDe(base));
    expect(purchaseKeyDe(base)).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("purchaseKeyDe: descricao truncada pelo conector", () => {
  /**
   * O caso real, do Mercado Pago: as parcelas ja postadas chegam como
   * "MERCADOLIVRE*AUMAIMPOR" e as previstas como "MERCADOLIVRE*AUMA" — a mesma
   * compra de 8x, com o mesmo dia e a mesma conta, cortada no fim. O CNPJ, que
   * teria precedencia e resolveria sozinho, vem ausente em todas as linhas.
   *
   * O resultado era uma compra partida em dois grupos na tela: "3 de 8" e
   * "5 de 8".
   */
  const compra = {
    accountId: "cartao-1",
    date: new Date("2026-06-02T00:00:00Z"),
    purchaseDate: new Date("2026-06-02T00:00:00Z"),
    totalInstallments: 8,
  };

  it("junta a parcela postada com a prevista, apesar do corte", () => {
    const postada = purchaseKeyDe({ ...compra, description: "MERCADOLIVRE*AUMAIMPOR" });
    const prevista = purchaseKeyDe({ ...compra, description: "MERCADOLIVRE*AUMA" });

    expect(postada).not.toBeNull();
    expect(postada).toBe(prevista);
  });

  it("ainda separa lojistas de verdade sob o mesmo prefixo", () => {
    // O corte e no fim, entao o prefixo tem de ser longo o bastante para que
    // dois vendedores diferentes do mesmo marketplace nao virem uma compra so.
    const auma = purchaseKeyDe({ ...compra, description: "MERCADOLIVRE*AUMAIMPOR" });
    const kairon = purchaseKeyDe({ ...compra, description: "MERCADOLIVRE*KAIRON" });

    expect(auma).not.toBe(kairon);
  });

  it("nao junta o marketplace consigo mesmo em outro dia", () => {
    const junho = purchaseKeyDe({ ...compra, description: "MERCADOLIVRE*AUMAIMPOR" });
    const agosto = purchaseKeyDe({
      ...compra,
      description: "MERCADOLIVRE*AUMAIMPOR",
      purchaseDate: new Date("2026-08-17T00:00:00Z"),
    });

    expect(junho).not.toBe(agosto);
  });
});
