import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { resolverIp } from "./rateLimit";

function req(headers: Record<string, unknown>, ip?: string, socketIp?: string): Request {
  return { headers, ip, socket: { remoteAddress: socketIp } } as unknown as Request;
}

/**
 * De quem é a tentativa. É a única pergunta que o limite por IP faz, e errá-la
 * tem dois modos de falha opostos: contar todo mundo no mesmo balde (e barrar
 * usuários legítimos em massa) ou aceitar um IP que o cliente escreveu (e não
 * limitar ninguém).
 */
describe("resolverIp", () => {
  it("prefere o cabeçalho da plataforma ao req.ip", () => {
    // Atrás do proxy, `req.ip` é o mesmo para todos os clientes.
    expect(resolverIp(req({ "x-vercel-forwarded-for": "203.0.113.7" }, "10.0.0.1"))).toBe(
      "203.0.113.7"
    );
  });

  it("pega só o primeiro endereço de uma cadeia", () => {
    expect(
      resolverIp(req({ "x-vercel-forwarded-for": "203.0.113.7, 70.41.3.18" }))
    ).toBe("203.0.113.7");
  });

  it("tolera espaços na cadeia", () => {
    expect(resolverIp(req({ "x-vercel-forwarded-for": "  203.0.113.7  , 70.41.3.18" }))).toBe(
      "203.0.113.7"
    );
  });

  it("aceita o cabeçalho repetido, usando a primeira ocorrência", () => {
    expect(
      resolverIp(req({ "x-vercel-forwarded-for": ["203.0.113.7", "198.51.100.2"] }))
    ).toBe("203.0.113.7");
  });

  it("cai no req.ip fora da plataforma", () => {
    expect(resolverIp(req({}, "192.168.0.10"))).toBe("192.168.0.10");
  });

  it("cai no endereço do socket quando nem req.ip existe", () => {
    expect(resolverIp(req({}, undefined, "127.0.0.1"))).toBe("127.0.0.1");
  });

  it("cabeçalho vazio não engole o req.ip", () => {
    // Um `""` truthy-falso aqui faria a chave virar "auth:" para todo mundo —
    // um balde único, que é exatamente o modo de falha que se quer evitar.
    expect(resolverIp(req({ "x-vercel-forwarded-for": "" }, "192.168.0.10"))).toBe("192.168.0.10");
    expect(resolverIp(req({ "x-vercel-forwarded-for": "  ,  " }, "192.168.0.10"))).toBe(
      "192.168.0.10"
    );
  });

  it("sem nada, devolve um marcador em vez de vazio", () => {
    expect(resolverIp(req({}))).toBe("desconhecido");
  });
});
