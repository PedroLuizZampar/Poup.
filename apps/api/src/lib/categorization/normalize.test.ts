import { describe, expect, it } from "vitest";
import { merchantKey, normalizeDescription } from "./normalize";

describe("normalizeDescription", () => {
  it("baixa a caixa e remove acentos", () => {
    expect(normalizeDescription("Padaria São José")).toBe("padaria sao jose");
  });

  it("remove parcelamento", () => {
    expect(normalizeDescription("MAGAZINE LUIZA PARC 03/12")).toBe("magazine luiza");
  });

  it("remove sequências de três ou mais dígitos e a pontuação de extrato", () => {
    expect(normalizeDescription("IFOOD *IFD 4829 SAO PAULO")).toBe("ifood ifd sao paulo");
  });

  it("remove os termos genéricos de extrato", () => {
    expect(normalizeDescription("COMPRA CARTAO DEBITO POSTO IPIRANGA")).toBe(
      "posto ipiranga"
    );
  });

  it("colapsa espaço e apara as bordas", () => {
    expect(normalizeDescription("  UBER   TRIP  ")).toBe("uber trip");
  });
});

describe("merchantKey", () => {
  it("usa os três primeiros tokens", () => {
    expect(merchantKey("IFOOD *IFD 4829 SAO PAULO BR")).toBe("ifood ifd sao");
  });

  it("ignora o resto da descrição, que é onde mora o ruído", () => {
    expect(merchantKey("UBER *TRIP 8821")).toBe(merchantKey("UBER *TRIP 9930"));
  });

  it("devolve null quando sobra pouco para identificar alguém", () => {
    expect(merchantKey("12 34")).toBeNull();
    expect(merchantKey("   ")).toBeNull();
  });
});
