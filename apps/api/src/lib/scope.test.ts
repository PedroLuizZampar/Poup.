import { describe, expect, it } from "vitest";
import { ownerIds, type Scope } from "./scope";

const casal: Scope = {
  userId: "ana",
  householdId: "casa-1",
  memberIds: ["ana", "bento"],
};

describe("ownerIds", () => {
  it("sem filtro, soma o espaço inteiro", () => {
    expect(ownerIds(casal)).toEqual(["ana", "bento"]);
  });

  it("'all' é o mesmo que sem filtro", () => {
    expect(ownerIds(casal, "all")).toEqual(["ana", "bento"]);
  });

  it("string vazia é o mesmo que sem filtro", () => {
    expect(ownerIds(casal, "")).toEqual(["ana", "bento"]);
  });

  it("restringe a um membro", () => {
    expect(ownerIds(casal, "bento")).toEqual(["bento"]);
  });

  /**
   * O buraco que o filtro por pessoa abre. A rota está autenticada; o que
   * faltaria sem esta checagem é a autorização — e `?owner=<id qualquer>` leria
   * a vida financeira de um estranho.
   */
  it("recusa quem não é do espaço", () => {
    expect(() => ownerIds(casal, "estranho")).toThrowError(
      /não faz parte da sua conta conjunta/
    );
  });

  it("recusa mesmo quando o espaço tem um membro só", () => {
    const sozinha: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana"] };
    expect(() => ownerIds(sozinha, "bento")).toThrow();
  });
});
