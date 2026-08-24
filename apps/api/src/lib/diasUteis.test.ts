import { describe, expect, it } from "vitest";
import { ehDiaUtil, feriadosNacionais, proximoDiaUtil } from "./diasUteis";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("feriadosNacionais", () => {
  it("traz os nove fixos", () => {
    const f = feriadosNacionais(2026);
    for (const dia of [
      "01-01",
      "04-21",
      "05-01",
      "09-07",
      "10-12",
      "11-02",
      "11-15",
      "11-20",
      "12-25",
    ]) {
      expect(f.has(dia)).toBe(true);
    }
  });

  it("calcula os moveis a partir da Pascoa", () => {
    // Pascoa de 2026 e 5 de abril. Carnaval cai 47 dias antes (19/02),
    // Sexta-Feira Santa 2 dias antes (03/04), Corpus Christi 60 depois (04/06).
    const f = feriadosNacionais(2026);
    expect(f.has("02-17")).toBe(true); // Carnaval (terca)
    expect(f.has("04-03")).toBe(true); // Sexta-Feira Santa
    expect(f.has("06-04")).toBe(true); // Corpus Christi
  });

  it("acompanha a Pascoa quando ela muda de ano", () => {
    // Pascoa de 2027 e 28 de marco: Carnaval vai para 09/02.
    const f = feriadosNacionais(2027);
    expect(f.has("02-09")).toBe(true);
    expect(f.has("02-17")).toBe(false);
  });
});

describe("ehDiaUtil", () => {
  it("recusa sabado e domingo", () => {
    expect(ehDiaUtil(new Date("2026-09-12T00:00:00Z"))).toBe(false); // sabado
    expect(ehDiaUtil(new Date("2026-09-13T00:00:00Z"))).toBe(false); // domingo
  });

  it("recusa feriado nacional", () => {
    expect(ehDiaUtil(new Date("2026-09-07T00:00:00Z"))).toBe(false);
  });

  it("aceita um dia comum", () => {
    expect(ehDiaUtil(new Date("2026-09-10T00:00:00Z"))).toBe(true);
  });
});

describe("proximoDiaUtil", () => {
  it("nao mexe num dia util", () => {
    expect(iso(proximoDiaUtil(new Date("2026-09-10T00:00:00Z")))).toBe("2026-09-10");
  });

  it("sabado anda para segunda", () => {
    expect(iso(proximoDiaUtil(new Date("2026-09-12T00:00:00Z")))).toBe("2026-09-14");
  });

  it("domingo anda para segunda", () => {
    expect(iso(proximoDiaUtil(new Date("2026-09-13T00:00:00Z")))).toBe("2026-09-14");
  });

  it("pula feriado que cai em dia de semana", () => {
    // 07/09/2026 e segunda-feira e feriado: o vencimento vai para terca.
    expect(iso(proximoDiaUtil(new Date("2026-09-07T00:00:00Z")))).toBe("2026-09-08");
  });

  it("atravessa a virada de ano", () => {
    // 01/01 e feriado; 2027-01-01 e sexta, entao anda so um dia.
    expect(iso(proximoDiaUtil(new Date("2027-01-01T00:00:00Z")))).toBe("2027-01-04");
  });

  it("preserva a hora do dia", () => {
    // O vencimento e gravado a meia-noite UTC; andar de dia nao pode
    // introduzir hora nenhuma, ou a comparacao de data quebra.
    expect(proximoDiaUtil(new Date("2026-09-12T00:00:00Z")).toISOString()).toBe(
      "2026-09-14T00:00:00.000Z"
    );
  });
});
