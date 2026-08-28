import { Prisma } from "@prisma/client";
import type { Category } from "@prisma/client";
import { normalizeCategoryName } from "./normalizeCategoryName";

/** Categoria da origem → categoria que passa a valer no destino. */
type DePara = Map<string, string>;

/**
 * Funde o espaco `origemId` no `destinoId`.
 *
 * Roda sempre dentro de um `$transaction` do chamador: metade de uma fusao
 * deixa transacao apontando para categoria de espaco alheio, que e um estado
 * do qual nao ha volta automatica.
 *
 * Nao guarda de-para. Foi decidido assim: a dissolucao devolve a cada um uma
 * copia do conjunto do casal, e nao o conjunto que a pessoa tinha antes.
 *
 * A ordem das escritas nao e livre. `Budget.category` e `onDelete: Cascade`, e
 * por isso os orcamentos sao fundidos **antes** de qualquer categoria absorvida
 * ser excluida: exclui-la primeiro levaria junto, sem erro nenhum, o teto que a
 * soma deveria preservar.
 */
export async function mergeHouseholds(
  tx: Prisma.TransactionClient,
  origemId: string,
  destinoId: string
): Promise<void> {
  // Fundir um espaco nele mesmo nao e uma fusao vazia: `destino` e `origem`
  // trariam as mesmas linhas, toda categoria casaria consigo, e o laco das
  // absorvidas excluiria todas elas. Hoje nada chega aqui com os dois iguais, e
  // a transacao nem chegaria a commitar — mas so porque o `household.delete` do
  // chamador esbarra no Restrict de `User.household`. Nao e uma protecao para
  // se depender dela.
  if (origemId === destinoId) return;

  // `orderBy` fixo porque a fusao e irreversivel: o sufixo de desempate e a
  // escolha entre dois homonimos nao podem depender da ordem que o banco
  // resolver devolver hoje.
  const destino = await tx.category.findMany({
    where: { householdId: destinoId },
    orderBy: { createdAt: "asc" },
  });
  const origem = await tx.category.findMany({
    where: { householdId: origemId },
    orderBy: { createdAt: "asc" },
  });

  const { dePara, absorvidas, movidas } = planejarCategorias(destino, origem);

  // Quem nao casou migra inteira antes dos orcamentos, para que toda categoria
  // citada na fusao dos tetos ja esteja no destino.
  for (const movida of movidas) {
    await tx.category.update({
      where: { id: movida.id },
      data: { householdId: destinoId, name: movida.nome },
    });
  }

  await fundirOrcamentos(tx, origemId, destinoId, dePara);

  for (const absorvida of absorvidas) {
    // Tudo que apontava para ela passa a apontar para o par.
    await tx.transaction.updateMany({
      where: { categoryId: absorvida.id },
      data: { categoryId: absorvida.parId },
    });
    // Sao duas colunas apontando para categoria, e esquecer a segunda deixa a
    // fila de revisao com referencia morta — `resolvedCategoryId` nem sequer
    // tem chave estrangeira que a limpe.
    await tx.categorySuggestion.updateMany({
      where: { categoryId: absorvida.id },
      data: { categoryId: absorvida.parId },
    });
    await tx.categorySuggestion.updateMany({
      where: { resolvedCategoryId: absorvida.id },
      data: { resolvedCategoryId: absorvida.parId },
    });
    await tx.category.delete({ where: { id: absorvida.id } });
  }

  // Meta nao tem nome unico, logo nao ha colisao: vao inteiras. `createdByUserId`
  // fica intocado de proposito — e por ele que a dissolucao devolve cada meta a
  // quem a criou.
  await tx.goal.updateMany({
    where: { householdId: origemId },
    data: { householdId: destinoId },
  });

  // Os convites que a origem enviou e ninguem respondeu. Depois da fusao nenhum
  // usuario carrega esse `householdId`, entao eles sumiriam de `invitesSent` —
  // ninguem mais conseguiria cancela-los — enquanto continuariam pendentes na
  // tela de quem recebeu.
  await tx.householdInvite.updateMany({
    where: { householdId: origemId, status: "PENDING" },
    data: { status: "CANCELLED", respondedAt: new Date() },
  });
}

interface Absorvida {
  id: string;
  parId: string;
}

interface Movida {
  id: string;
  nome: string;
}

/**
 * Decide o destino de cada categoria da origem sem escrever nada.
 *
 * Separado porque a regra e a parte que nao pode errar: uma vez escrita, a
 * fusao de duas categorias nao tem desfazer.
 */
function planejarCategorias(
  destino: Category[],
  origem: Category[]
): { dePara: DePara; absorvidas: Absorvida[]; movidas: Movida[] } {
  const porChave = new Map(
    destino.filter((c) => c.systemKey).map((c) => [c.systemKey as string, c])
  );

  // So as categorias do usuario entram no casamento por nome. Fundir a "Sem
  // categoria" digitada por alguem com a categoria de sistema homonima daqui
  // daria a uma categoria que o app mantem — que nao aceita orcamento, nao pode
  // ser renomeada nem excluida — o dinheiro de uma categoria comum, sem separar
  // depois.
  const porNome = new Map<string, Category>();
  for (const c of destino) {
    if (c.systemKey) continue;
    const chave = normalizeCategoryName(c.name);
    // Nome feito so de acentos normaliza para "", e duas dessas nao sao a mesma
    // coisa: casa-las fundiria o dinheiro de categorias sem relacao nenhuma.
    if (!chave) continue;
    if (!porNome.has(chave)) porNome.set(chave, c);
  }

  // Os nomes crus ja ocupados no destino, para o desempate do unique. Inclui as
  // de sistema: o unique `(householdId, name)` nao as distingue.
  const nomesOcupados = new Set(destino.map((c) => c.name));

  const dePara: DePara = new Map();
  const absorvidas: Absorvida[] = [];
  const movidas: Movida[] = [];

  for (const cat of origem) {
    const chaveNome = normalizeCategoryName(cat.name);
    // Categoria de sistema so casa com a mesma chave. Sem par por chave ela
    // migra, e migrar e seguro justamente porque nao ter par significa que o
    // destino nao tem essa chave — o unique `(householdId, systemKey)` continua
    // valendo.
    const par = cat.systemKey
      ? porChave.get(cat.systemKey)
      : chaveNome
        ? porNome.get(chaveNome)
        : undefined;

    if (par) {
      dePara.set(cat.id, par.id);
      absorvidas.push({ id: cat.id, parId: par.id });
      continue;
    }

    // Sem par: migra inteira. As transacoes ja apontam para ela, entao nao ha o
    // que remapear — so o nome pode precisar de desempate.
    let nome = cat.name;
    let sufixo = 2;
    while (nomesOcupados.has(nome)) {
      nome = `${cat.name} (${sufixo})`;
      sufixo++;
    }
    nomesOcupados.add(nome);

    dePara.set(cat.id, cat.id);
    movidas.push({ id: cat.id, nome });
  }

  return { dePara, absorvidas, movidas };
}

/** Teto que sobrevive no destino, com o total ja acumulado em memoria. */
interface Alvo {
  id: string;
  categoriaFinal: string;
  total: Prisma.Decimal;
  /** Recebeu ao menos uma soma da origem. */
  somou: boolean;
  /** A linha que sobrevive e da origem, e portanto precisa mudar de espaco. */
  veioDaOrigem: boolean;
}

/**
 * Dois tetos para a mesma categoria viram um so, somado. E o unico agregado da
 * fusao, e por isso soma em `Decimal`: R$ 0,10 + R$ 0,20 em ponto flutuante nao
 * da R$ 0,30.
 *
 * O total e acumulado em memoria antes de escrever porque dois orcamentos da
 * origem podem cair na mesma categoria do destino (duas categorias de la que
 * casam com uma so daqui). Somar direto no banco a cada volta usaria sempre o
 * valor lido no inicio, e a segunda soma apagaria a primeira.
 */
async function fundirOrcamentos(
  tx: Prisma.TransactionClient,
  origemId: string,
  destinoId: string,
  dePara: DePara
): Promise<void> {
  const doDestino = await tx.budget.findMany({ where: { householdId: destinoId } });
  const daOrigem = await tx.budget.findMany({ where: { householdId: origemId } });

  const porCategoria = new Map<string, Alvo>();
  for (const orcamento of doDestino) {
    porCategoria.set(orcamento.categoryId, {
      id: orcamento.id,
      categoriaFinal: orcamento.categoryId,
      total: new Prisma.Decimal(orcamento.monthlyLimit),
      somou: false,
      veioDaOrigem: false,
    });
  }

  const aExcluir: string[] = [];

  for (const orcamento of daOrigem) {
    const categoriaFinal = dePara.get(orcamento.categoryId) ?? orcamento.categoryId;
    const alvo = porCategoria.get(categoriaFinal);

    if (alvo) {
      alvo.total = alvo.total.plus(new Prisma.Decimal(orcamento.monthlyLimit));
      alvo.somou = true;
      aExcluir.push(orcamento.id);
      continue;
    }

    // Primeiro teto para esta categoria: a propria linha da origem sobrevive.
    porCategoria.set(categoriaFinal, {
      id: orcamento.id,
      categoriaFinal,
      total: new Prisma.Decimal(orcamento.monthlyLimit),
      somou: false,
      veioDaOrigem: true,
    });
  }

  for (const alvo of porCategoria.values()) {
    if (alvo.veioDaOrigem) {
      await tx.budget.update({
        where: { id: alvo.id },
        data: alvo.somou
          ? { householdId: destinoId, categoryId: alvo.categoriaFinal, monthlyLimit: alvo.total }
          : { householdId: destinoId, categoryId: alvo.categoriaFinal },
      });
      continue;
    }
    // Teto do destino em que ninguem encostou.
    if (!alvo.somou) continue;

    await tx.budget.update({
      where: { id: alvo.id },
      data: { monthlyLimit: alvo.total },
    });
  }

  // Ainda aqui dentro, e nao mais tarde: a categoria absorvida e excluida no
  // passo seguinte, e a cascata de `Budget.category` levaria estas linhas junto
  // — o `delete` explicito entao esbarraria numa linha que ja nao existe.
  for (const id of aExcluir) {
    await tx.budget.delete({ where: { id } });
  }
}
