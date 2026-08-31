import { describe, expect, it } from "vitest";
import type { HouseholdMemberDTO } from "@poup/shared";
import { donoDaLinha, ownerParaQuery } from "./OwnerFilter";

function membro(overrides: Partial<HouseholdMemberDTO> & { id: string }): HouseholdMemberDTO {
  return { name: overrides.id, avatarUrl: null, ...overrides };
}

describe("donoDaLinha", () => {
  it("nunca mostra dono quando o espaço é de uma pessoa só", () => {
    const eu = membro({ id: "eu" });
    expect(donoDaLinha([eu], "eu")).toBeNull();
  });

  it("acha o membro dono da transação quando o espaço tem mais de um", () => {
    const eu = membro({ id: "eu", name: "Eu" });
    const parceiro = membro({ id: "parceiro", name: "Parceiro" });
    expect(donoDaLinha([eu, parceiro], "parceiro")).toBe(parceiro);
  });

  it("some quando o id não cruza com nenhum membro atual", () => {
    // Uma transação antiga de alguém que já saiu do espaço: o cruzamento
    // falha, e é melhor não mostrar avatar do que apontar para o membro errado.
    const eu = membro({ id: "eu" });
    const parceiro = membro({ id: "parceiro" });
    expect(donoDaLinha([eu, parceiro], "quem-saiu")).toBeNull();
  });
});

describe("ownerParaQuery", () => {
  it("\"all\" vira ausente — é assim que a API soma o espaço inteiro", () => {
    expect(ownerParaQuery("all")).toBeUndefined();
  });

  it("qualquer outro valor segue como o id do membro escolhido", () => {
    expect(ownerParaQuery("membro-1")).toBe("membro-1");
  });
});
