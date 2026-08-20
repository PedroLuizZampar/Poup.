import { describe, expect, it } from "vitest";
import { buildHistoryIndex, suggestCategory } from "./engine";

const CATEGORIES = [
  { id: "cat-restaurante", name: "Restaurante" },
  { id: "cat-lazer", name: "Lazer" },
  { id: "cat-mercado", name: "Mercado" },
];

describe("buildHistoryIndex", () => {
  it("conta por chave de comerciante e categoria", () => {
    const index = buildHistoryIndex([
      { description: "IFOOD *IFD 1111", categoryId: "cat-restaurante" },
      { description: "IFOOD *IFD 2222", categoryId: "cat-restaurante" },
      { description: "IFOOD *IFD 3333", categoryId: "cat-lazer" },
    ]);

    expect(index.get("ifood ifd")?.get("cat-restaurante")).toBe(2);
    expect(index.get("ifood ifd")?.get("cat-lazer")).toBe(1);
  });

  it("descarta descrição sem chave aproveitável", () => {
    const index = buildHistoryIndex([{ description: "123", categoryId: "cat-lazer" }]);
    expect(index.size).toBe(0);
  });
});

describe("suggestCategory", () => {
  const history = buildHistoryIndex([
    { description: "IFOOD *IFD 1111", categoryId: "cat-restaurante" },
    { description: "IFOOD *IFD 2222", categoryId: "cat-restaurante" },
    { description: "IFOOD *IFD 3333", categoryId: "cat-lazer" },
  ]);

  it("usa o histórico e reporta a consistência dele como confiança", () => {
    const result = suggestCategory(
      { description: "IFOOD *IFD 9999" },
      { history, categories: CATEGORIES }
    );

    expect(result).toEqual({
      categoryId: "cat-restaurante",
      source: "HISTORY",
      confidence: 2 / 3,
    });
  });

  it("o histórico vence a regra fixa", () => {
    // "ifood" também está na tabela de palavras-chave apontando para
    // Restaurante; aqui o histórico manda em Lazer e é ele que deve valer.
    const historicoDivergente = buildHistoryIndex([
      { description: "IFOOD *IFD 1111", categoryId: "cat-lazer" },
    ]);

    const result = suggestCategory(
      { description: "IFOOD *IFD 9999" },
      { history: historicoDivergente, categories: CATEGORIES }
    );

    expect(result?.categoryId).toBe("cat-lazer");
    expect(result?.source).toBe("HISTORY");
  });

  it("cai na regra fixa quando o histórico não conhece o comerciante", () => {
    const result = suggestCategory(
      { description: "CARREFOUR OSASCO" },
      { history: new Map(), categories: CATEGORIES }
    );

    expect(result).toEqual({
      categoryId: "cat-mercado",
      source: "RULE",
      confidence: 0.5,
    });
  });

  it("cai na categoria da Pluggy quando não há histórico nem regra", () => {
    const result = suggestCategory(
      { description: "ESTABELECIMENTO XPTO", pluggyCategory: "Lazer" },
      { history: new Map(), categories: CATEGORIES }
    );

    expect(result).toEqual({
      categoryId: "cat-lazer",
      source: "PLUGGY",
      confidence: 0.35,
    });
  });

  it("devolve null quando nada se aplica", () => {
    const result = suggestCategory(
      { description: "ESTABELECIMENTO XPTO" },
      { history: new Map(), categories: CATEGORIES }
    );

    expect(result).toBeNull();
  });

  it("não sugere nada quando o usuário não tem categoria selecionável", () => {
    const result = suggestCategory(
      { description: "CARREFOUR OSASCO" },
      { history: new Map(), categories: [] }
    );

    expect(result).toBeNull();
  });
});
