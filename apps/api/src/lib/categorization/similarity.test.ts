import { describe, expect, it } from "vitest";
import { SIMILARITY_THRESHOLD, similarityScore } from "./similarity";

describe("similarityScore", () => {
  it("dá 1 para descrições idênticas", () => {
    expect(similarityScore("PADARIA SAO JOSE", "PADARIA SAO JOSE")).toBe(1);
  });

  it("dá 1 quando a chave de comerciante é a mesma, apesar do sufixo", () => {
    expect(similarityScore("UBER *TRIP 8821 SP", "UBER *TRIP 9930 RJ")).toBe(1);
  });

  it("dá 0 para descrições sem token em comum", () => {
    expect(similarityScore("NETFLIX", "POSTO IPIRANGA")).toBe(0);
  });

  it("fica acima do limiar para variações do mesmo estabelecimento", () => {
    const score = similarityScore(
      "RESTAURANTE DONA INES LTDA",
      "RESTAURANTE DONA INES"
    );
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it("fica abaixo do limiar para estabelecimentos diferentes que compartilham uma palavra", () => {
    const score = similarityScore("RESTAURANTE DONA INES", "RESTAURANTE DO PORTO");
    expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it("dá 0 quando algum lado fica vazio depois de normalizar", () => {
    expect(similarityScore("123456", "NETFLIX")).toBe(0);
  });
});
