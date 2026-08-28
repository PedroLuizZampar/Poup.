import { Prisma } from "@prisma/client";

/**
 * Dissolve o espaco: cada membro sai com uma copia do conjunto do casal, e as
 * proprias transacoes religadas a ela.
 *
 * Simetrica de proposito. Com dois membros, "um sai e o outro fica" e "os dois
 * se separam" sao o mesmo caso, e tratar os dois como um so evita o desenho
 * assimetrico em que o espaco e secretamente de um deles.
 *
 * Como a fusao, roda dentro de um `$transaction` do chamador. E a ordem das
 * escritas nao e livre:
 *
 * - as categorias originais morrem na cascata de `Household`, e
 *   `Transaction.categoryId` e as duas colunas de `CategorySuggestion` sao
 *   `ON DELETE SET NULL` — religar depois da exclusao nao daria erro nenhum, so
 *   esvaziaria a categorizacao de todo mundo em silencio. Por isso tudo e
 *   religado antes do `household.delete`;
 * - `Budget.category` e `onDelete: Cascade`, entao os tetos sao copiados
 *   enquanto as originais ainda existem, e a copia aponta para a copia;
 * - `User.household` nao tem `onDelete`, ou seja, e Restrict: todo mundo muda de
 *   espaco antes de o antigo ser apagado, senao a transacao inteira volta atras.
 *
 * O laco por categoria e por membro nao e distracao: cada copia so ganha id
 * depois de criada, e e esse id que as religacoes daquele membro usam.
 */
export async function splitHousehold(
  tx: Prisma.TransactionClient,
  householdId: string
): Promise<void> {
  const membros = await tx.user.findMany({
    where: { householdId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  const categorias = await tx.category.findMany({ where: { householdId } });
  const orcamentos = await tx.budget.findMany({ where: { householdId } });

  for (const membro of membros) {
    const novo = await tx.household.create({ data: {} });

    /** Categoria do casal → a copia deste membro. */
    const dePara = new Map<string, string>();

    for (const cat of categorias) {
      const copia = await tx.category.create({
        data: {
          householdId: novo.id,
          name: cat.name,
          icon: cat.icon,
          colorKey: cat.colorKey,
          kind: cat.kind,
          systemKey: cat.systemKey,
        },
      });
      dePara.set(cat.id, copia.id);

      await tx.transaction.updateMany({
        where: { userId: membro.id, categoryId: cat.id },
        data: { categoryId: copia.id },
      });
      await tx.categorySuggestion.updateMany({
        where: { userId: membro.id, categoryId: cat.id },
        data: { categoryId: copia.id },
      });
      await tx.categorySuggestion.updateMany({
        where: { userId: membro.id, resolvedCategoryId: cat.id },
        data: { resolvedCategoryId: copia.id },
      });
    }

    // O teto do casal vale inteiro para cada um. Foi a escolha de "copia
    // identica" — dividir por dois seria inventar uma regra que ninguem pediu —,
    // e a tela avisa disso antes de confirmar.
    for (const orcamento of orcamentos) {
      const categoriaCopiada = dePara.get(orcamento.categoryId);
      if (!categoriaCopiada) continue;
      await tx.budget.create({
        data: {
          householdId: novo.id,
          categoryId: categoriaCopiada,
          monthlyLimit: new Prisma.Decimal(orcamento.monthlyLimit),
        },
      });
    }

    // Meta e de quem a criou; nao se copia para os dois.
    await tx.goal.updateMany({
      where: { householdId, createdByUserId: membro.id },
      data: { householdId: novo.id },
    });

    // A meta veio, mas a conta em que ela acumula pode ser do outro — amarrar a
    // meta a conta do parceiro e o caso de uso do espaco, nao uma excecao. Fora
    // do espaco comum essa conta vira uma referencia entre espacos: o
    // `assertAccountNoEspaco` das metas filtra por `scope.memberIds`, entao
    // qualquer edicao passaria a falhar com "Conta nao encontrada", sem dizer o
    // porque. Soltar a conta poe a meta no estado orfao que o app ja desenhou
    // para a conta excluida — o cartao mostra "Vincule uma conta".
    await tx.goal.updateMany({
      where: { householdId: novo.id, account: { is: { userId: { not: membro.id } } } },
      data: { accountId: null },
    });

    await tx.user.update({
      where: { id: membro.id },
      data: { householdId: novo.id },
    });
  }

  // Esvaziado: as categorias e orcamentos que sobraram aqui sao os originais, e
  // a cascata os leva junto. As transacoes ja apontam para as copias.
  await tx.household.delete({ where: { id: householdId } });
}
