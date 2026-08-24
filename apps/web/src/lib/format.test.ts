import { describe, expect, it } from "vitest";
import { contagem, formatDate, formatDateTime } from "./format";

describe("fuso dos testes", () => {
  it("roda em America/Sao_Paulo, onde o bug aparece", () => {
    // Se esta guarda cair, o resto do arquivo deixa de provar qualquer coisa:
    // em UTC a formatacao local e a UTC coincidem.
    expect(new Date("2026-09-10T00:00:00.000Z").getHours()).toBe(21);
  });
});

describe("formatDate", () => {
  it("mostra o dia UTC de uma data de dia inteiro", () => {
    // Vencimento de fatura e gravado a meia-noite UTC. Formatado no fuso local
    // ele viraria 09/09 em GMT-3 — o app discordaria da propria API.
    expect(formatDate("2026-09-10T00:00:00.000Z")).toBe("10/09/2026");
  });

  it("nao atrasa a virada de mes", () => {
    expect(formatDate("2026-09-01T00:00:00.000Z")).toBe("01/09/2026");
  });

  it("nao atrasa a virada de ano", () => {
    expect(formatDate("2027-01-01T00:00:00.000Z")).toBe("01/01/2027");
  });

  it("usa o dia UTC tambem quando a data tem hora", () => {
    // O mes em que a transacao conta e decidido em UTC no backend. Exibir o dia
    // no fuso local faria uma transacao de 21h30 de 31/08 aparecer como 31/08 e
    // contar em setembro.
    expect(formatDate("2026-09-01T00:30:00.000Z")).toBe("01/09/2026");
  });

  it("aceita Date alem de string", () => {
    expect(formatDate(new Date("2026-09-10T00:00:00.000Z"))).toBe("10/09/2026");
  });

  it("devolve vazio para entrada invalida", () => {
    expect(formatDate("")).toBe("");
    expect(formatDate("nao e data")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("continua no fuso local, porque mostra um instante e nao um dia", () => {
    // `lastSyncedAt` e `createdAt` sao momentos reais: quem sincronizou as 21h
    // quer ler 21h, no relogio dele.
    expect(formatDateTime("2026-09-10T00:00:00.000Z")).toBe("09/09/2026 às 21:00");
  });
});

describe("contagem", () => {
  it("usa o singular para exatamente um", () => {
    expect(contagem(1, "transação importada", "transações importadas")).toBe(
      "1 transação importada"
    );
  });

  it("usa o plural para muitos", () => {
    expect(contagem(12, "transação importada", "transações importadas")).toBe(
      "12 transações importadas"
    );
  });

  it("usa o plural para zero", () => {
    // "0 transação importada" e errado em portugues: zero pede plural.
    expect(contagem(0, "transação importada", "transações importadas")).toBe(
      "0 transações importadas"
    );
  });

  it("concorda o particípio junto, e nao so o substantivo", () => {
    // O motivo de a forma inteira entrar nos dois argumentos: pluralizar so o
    // substantivo deixaria "2 transações importada".
    expect(contagem(2, "conta atualizada", "contas atualizadas")).toBe("2 contas atualizadas");
  });
});
