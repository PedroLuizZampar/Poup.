import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Scope } from "../../lib/scope";

/**
 * Os dois caminhos que erravam **em silêncio** quando o filtro era um `userId`
 * só: a linha do parceiro não casava com nada, ninguém recebia erro, e a
 * resposta ainda dizia que o trabalho tinha sido feito.
 *
 * O Prisma é mockado, então o que estes testes travam é o `where` — que é
 * exatamente onde os dois bugs moravam.
 */

const categoryFindFirst = vi.fn();
const categoryFindMany = vi.fn();
const transactionFindMany = vi.fn();
const transactionUpdateMany = vi.fn();
const suggestionFindMany = vi.fn();
const suggestionUpsert = vi.fn();

/** O cliente que o `$transaction(async (tx) => ...)` entrega ao callback. */
const txTransactionUpdateMany = vi.fn();
const txSuggestionUpdateMany = vi.fn();
const txClient = {
  transaction: { updateMany: txTransactionUpdateMany },
  categorySuggestion: { updateMany: txSuggestionUpdateMany },
};

const $transaction = vi.fn(async (arg: any) =>
  typeof arg === "function" ? arg(txClient) : Promise.all(arg)
);

vi.mock("../../prisma", () => ({
  prisma: {
    category: { findFirst: categoryFindFirst, findMany: categoryFindMany },
    transaction: { findMany: transactionFindMany, updateMany: transactionUpdateMany },
    categorySuggestion: { findMany: suggestionFindMany, upsert: suggestionUpsert },
    $transaction,
  },
}));

const { enfileirarParaRevisao } = await import("./categorization.service");
const { bulkCategorize } = await import("./similar.service");

const casal: Scope = { userId: "ana", householdId: "casa-1", memberIds: ["ana", "bento"] };

/** Uma linha de cada membro: é a mistura que os dois bugs deixavam pela metade. */
const linhas = [
  { id: "tx-ana", description: "MERCADO", userId: "ana" },
  { id: "tx-bento", description: "POSTO", userId: "bento" },
];

beforeEach(() => {
  // As de sistema já existem: `ensureSystemCategories` para na primeira busca.
  categoryFindFirst.mockReset().mockImplementation(async ({ where }: any) =>
    where.systemKey ? { id: `sys-${where.systemKey}` } : { id: "cat-1", systemKey: null }
  );
  categoryFindMany.mockReset().mockResolvedValue([]);
  // O `select` separa as duas consultas de transação: a que busca as linhas do
  // lote pede `userId`; a do histórico, não.
  transactionFindMany.mockReset().mockImplementation(async ({ select }: any) =>
    select?.userId ? linhas : []
  );
  transactionUpdateMany.mockReset().mockResolvedValue({ count: linhas.length });
  suggestionFindMany.mockReset().mockResolvedValue([]);
  suggestionUpsert.mockReset().mockImplementation((args: any) => args);
  txTransactionUpdateMany.mockReset().mockResolvedValue({ count: 2 });
  txSuggestionUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  $transaction.mockClear();
});

describe("enfileirarParaRevisao no espaço", () => {
  const ids = ["tx-ana", "tx-bento"];

  it("devolve para 'Sem categoria' as linhas dos dois membros", async () => {
    await enfileirarParaRevisao(casal, ids);

    // Com `userId: scope.userId`, este `updateMany` casava com zero linhas do
    // parceiro: a despesa dele ficava em "Pagamento de fatura", que o relatório
    // esconde, e sumia dos totais sem erro nenhum.
    expect(transactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ids }, userId: { in: ["ana", "bento"] } },
      data: { categoryId: "sys-UNCATEGORIZED" },
    });
  });

  it("procura as linhas do lote pelos membros, e não por quem sincronizou", async () => {
    await enfileirarParaRevisao(casal, ids);

    expect(transactionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ids }, userId: { in: ["ana", "bento"] } },
      })
    );
  });

  it("resolve as categorias de sistema pelo espaço, e não por um usuário", async () => {
    await enfileirarParaRevisao(casal, ids);

    // O segundo parâmetro de `ensureSystemCategories` virou um id de espaço, e
    // os dois são `string`: passar o `userId` compilava e criava a categoria
    // num espaço que não existe.
    for (const call of categoryFindFirst.mock.calls) {
      expect(call[0].where.householdId).toBe("casa-1");
    }
  });

  it("a sugestão nasce com o dono da transação, e não com quem sincronizou", async () => {
    await enfileirarParaRevisao(casal, ids);

    const donos = suggestionUpsert.mock.calls.map((call) => [
      call[0].where.transactionId,
      call[0].create.userId,
    ]);
    expect(donos).toEqual([
      ["tx-ana", "ana"],
      ["tx-bento", "bento"],
    ]);
  });

  // Sem valor como guarda de regressão — o mock não filtra `where`, então o
  // retorno seria 2 mesmo com o bug. Fica só como contrato: o número devolvido
  // é o de linhas enfileiradas, e é ele que `reconhecerPagamentos` soma.
  it("devolve quantas linhas enfileirou", async () => {
    expect(await enfileirarParaRevisao(casal, ids)).toBe(2);
  });
});

describe("bulkCategorize no espaço", () => {
  const ids = ["tx-ana", "tx-bento"];

  it("categoriza as linhas dos dois membros numa seleção misturada", async () => {
    await bulkCategorize(casal, ids, "cat-1");

    // A tela oferece as transações do casal para seleção. Com `userId` único, a
    // do parceiro era descartada em silêncio e a resposta dizia sucesso.
    expect(txTransactionUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ids }, userId: { in: ["ana", "bento"] } },
      data: { categoryId: "cat-1", transferPairId: null },
    });
  });

  it("tira da fila as sugestões pendentes dos dois", async () => {
    await bulkCategorize(casal, ids, "cat-1");

    expect(txSuggestionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: { in: ["ana", "bento"] } }),
      })
    );
  });

  it("aceita a categoria do espaço, que é onde ela vive", async () => {
    await bulkCategorize(casal, ids, "cat-1");

    expect(categoryFindFirst).toHaveBeenCalledWith({
      where: { id: "cat-1", householdId: "casa-1" },
    });
  });
});
