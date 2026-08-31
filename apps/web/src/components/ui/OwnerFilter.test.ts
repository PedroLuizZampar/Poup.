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
  const eu = membro({ id: "eu" });
  const parceiro = membro({ id: "parceiro" });

  it("\"all\" vira ausente — é assim que a API soma o espaço inteiro", () => {
    expect(ownerParaQuery([eu, parceiro], "all")).toBeUndefined();
  });

  it("qualquer outro valor segue como o id do membro escolhido", () => {
    expect(ownerParaQuery([eu, parceiro], "parceiro")).toBe("parceiro");
  });

  it("some quando o espaço voltou a ser de uma pessoa só, mesmo com uma seleção presa", () => {
    // O caso do 403: alguém saiu do espaço, e a tela ainda guarda a escolha de
    // antes. `ownerFilter` não muda sozinho — é este guard que impede o id de
    // quem já não está no espaço de chegar na API.
    expect(ownerParaQuery([eu], "parceiro")).toBeUndefined();
  });

  it("um espaço de três ou mais membros também filtra normalmente", () => {
    // Nada no modelo trava o espaço em dois membros — o guard é `< 2`, não
    // `!== 2`, e continua deixando passar a seleção em qualquer tamanho maior.
    const terceiro = membro({ id: "terceiro" });
    expect(ownerParaQuery([eu, parceiro, terceiro], "terceiro")).toBe("terceiro");
  });
});
