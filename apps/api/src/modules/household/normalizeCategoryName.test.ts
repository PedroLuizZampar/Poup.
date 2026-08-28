import { describe, expect, it } from "vitest";
import { normalizeCategoryName } from "./normalizeCategoryName";

describe("normalizeCategoryName", () => {
  it("ignora acento e caixa", () => {
    expect(normalizeCategoryName("Saúde")).toBe(normalizeCategoryName("saude"));
  });

  it("ignora espaço nas pontas e espaço repetido", () => {
    expect(normalizeCategoryName("  Casa   e   Jardim ")).toBe("casa e jardim");
  });

  /**
   * O motivo de esta função existir em vez de reusar a `normalizeDescription`
   * da categorização: aquela derruba stopwords de extrato — "conta",
   * "pagamento", "cartao" —, que em nome de categoria são o conteúdo inteiro.
   */
  it("preserva palavras que a normalização de extrato derruba", () => {
    expect(normalizeCategoryName("Conta de Luz")).toBe("conta de luz");
    expect(normalizeCategoryName("Pagamento de fatura")).toBe("pagamento de fatura");
  });

  it("não funde nomes que só se parecem", () => {
    expect(normalizeCategoryName("Mercado")).not.toBe(normalizeCategoryName("Mercadinho"));
  });
});
