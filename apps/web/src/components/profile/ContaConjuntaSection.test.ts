import { describe, expect, it } from "vitest";
import type { HouseholdInviteDTO, HouseholdMemberDTO, HouseholdStateDTO } from "@poup/shared";
import { resolverEstado } from "./ContaConjuntaSection";

function membro(overrides: Partial<HouseholdMemberDTO> & { id: string }): HouseholdMemberDTO {
  return { name: overrides.id, avatarUrl: null, ...overrides };
}

function convite(overrides: Partial<HouseholdInviteDTO> & { id: string }): HouseholdInviteDTO {
  return {
    status: "PENDING",
    inviter: { id: "outro", name: "Outra Pessoa", avatarUrl: null },
    inviteeEmail: "convidado@exemplo.com",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function household(overrides: Partial<HouseholdStateDTO> = {}): HouseholdStateDTO {
  return {
    id: "casa-1",
    members: [membro({ id: "eu" })],
    invitesReceived: [],
    invitesSent: [],
    ...overrides,
  };
}

describe("resolverEstado", () => {
  it("sozinho quando não há membros extras, nem convites", () => {
    expect(resolverEstado(household())).toBe("sozinho");
  });

  it("convite-enviado quando eu mandei um convite pendente", () => {
    expect(
      resolverEstado(household({ invitesSent: [convite({ id: "conv-1" })] }))
    ).toBe("convite-enviado");
  });

  it("espaco-formado quando o espaço já tem mais de um membro", () => {
    expect(
      resolverEstado(
        household({ members: [membro({ id: "eu" }), membro({ id: "parceiro" })] })
      )
    ).toBe("espaco-formado");
  });

  it("convite-recebido tem prioridade sobre espaço formado e convite enviado", () => {
    const estado = resolverEstado(
      household({
        members: [membro({ id: "eu" }), membro({ id: "parceiro" })],
        invitesReceived: [convite({ id: "recebido-1" })],
        invitesSent: [convite({ id: "enviado-1" })],
      })
    );
    expect(estado).toBe("convite-recebido");
  });

  it("espaço formado tem prioridade sobre convite enviado", () => {
    const estado = resolverEstado(
      household({
        members: [membro({ id: "eu" }), membro({ id: "parceiro" })],
        invitesSent: [convite({ id: "enviado-1" })],
      })
    );
    expect(estado).toBe("espaco-formado");
  });
});
