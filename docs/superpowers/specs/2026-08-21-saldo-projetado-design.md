# Saldo projetado: o motor de projeção e suas vitrines

Data: 2026-08-21 · Branch: `main`

## Problema

O app só sabe do passado. `Account.balance` é o saldo de agora, `/reports/summary`
soma o que já aconteceu, e a única pergunta que o painel responde é "quanto eu
gastei". A pergunta que se faz no dia 12, olhando o extrato, é outra: **"com o
que ainda vai entrar e sair, quanto sobra dia 31?"**

Não existe hoje nenhum conceito de futuro no código. Não há `Subscription`, não
há lançamento agendado, não há data de vencimento de fatura, e `isRecurring` é
um checkbox manual que nenhum consumidor lê.

Este documento descreve o motor que produz esse futuro, e as telas que o mostram.

## Decisões tomadas

Acordadas no brainstorming. O plano de implementação não as reabre.

1. **O sinal de "comprometido" é a categoria, não a transação.** Não há detector
   de recorrência. `Category` ganha um toggle **fixa/variável**, e a fila de
   revisão que já existe é o que alimenta a projeção: o usuário categoriza
   "NETFLIX" em uma categoria fixa uma vez, e o motor passa a projetar aquilo.
2. **O número vem em duas faixas.** *Comprometido* (categorias fixas e parcelas
   — explicável linha a linha) e *estimado* (categorias variáveis, pela mediana
   histórica). A UI mostra as duas; nunca um número seco.
3. **O motor produz um calendário de eventos datados**, e todo o resto é
   derivado dele: a linha de saldo diário é o acumulado, o número de fim de mês
   é o último ponto, "quanto posso gastar hoje" é uma conta sobre a mesma lista,
   o fluxo semanal é um agrupamento. Uma fonte de verdade, quatro vitrines. A
   lista **é** a explicação do número.
4. **Mediana, não média.** O mês do notebook novo não pode virar custo de vida.
5. **Run-rate é fallback declarado, não motor.** Para quem tem menos de dois
   meses fechados de histórico, a projeção sai marcada como tal.
6. **Sem histórico suficiente, o app diz que não sabe.** Não inventa número.
   Mesma política da tela de offline: informação falsa é pior que ausência.
7. **A soma acontece no banco**, não no navegador — a razão de existir do
   `reports.service.ts` vale igual aqui.
8. **Fase 1 é derivada só do histórico**, mais parcelamentos. Lançamentos
   agendados e fatura de cartão modelada são fases próprias.
9. **A aba de Assinaturas não vem de graça.** Sem detector de recorrência, ela
   volta a ser trabalho próprio, numa fase adiante.

## O roadmap

| Fase | Entrega | Depende de |
|---|---|---|
| **1** | Motor de projeção + toggle fixa/variável + card "fim do mês" no Dashboard | — |
| **2** | Gráfico de linha do saldo diário, sólido até hoje e pontilhado adiante | 1 |
| **3** | "Quanto posso gastar hoje", dia seguro, custo de vida e runway | 1 |
| **4** | Horizonte de 3-6 meses e fluxo de caixa projetado por semana/mês | 1 |
| **5** | Lançamentos agendados | 1 |
| **6** | Fatura de cartão modelada (ciclo, fechamento, vencimento) | 1 |
| **7** | Waterfall do mês e top comerciantes | — |
| **8** | Fixo vs variável, burn-down de orçamento | 1 |
| **9** | Assinaturas (com detector de recorrência próprio) | — |

Cada fase ganha seu próprio plano de implementação. Este documento detalha a
fase 1 e esboça as demais.

---

# Fase 1 — o motor

## Modelo de dados

### `Category` ganha a natureza

```prisma
enum CategoryNature {
  FIXED
  VARIABLE
}

model Category {
  // ...campos atuais
  /// Fixa: o valor se repete todo mês e entra na projeção como *comprometido*.
  /// Variável: o valor oscila e entra como *estimado*, prorateado pelos dias
  /// que faltam. É o único sinal que o motor tem para separar as duas faixas.
  nature CategoryNature @default(VARIABLE)
}
```

`CategoryNature`, e não `ExpenseNature`: o toggle vale igual para receita — um
salário é receita fixa, e freela é receita variável. Nomear o enum pela despesa
faria a coluna mentir na metade das linhas em que ela é usada.

Padrão `VARIABLE`: subestimar o comprometido faz a projeção parecer folgada, mas
marcar tudo como fixo faria o app afirmar compromissos que não existem — e
categoria fixa errada é mais difícil de perceber que categoria variável errada.

As categorias de `defaultCategories.ts` nascem marcadas, para que ninguém
precise configurar nada antes de o número valer:

| Categoria | Natureza |
|---|---|
| Renda | `FIXED` |
| Moradia | `FIXED` |
| Saúde | `FIXED` |
| Serviços | `FIXED` |
| Mercado | `VARIABLE` |
| Transporte | `VARIABLE` |
| Restaurante | `VARIABLE` |
| Lazer | `VARIABLE` |
| Casa | `VARIABLE` |
| Eletrônicos | `VARIABLE` |
| Outros | `VARIABLE` |

As de sistema (`TRANSFER`, `UNCATEGORIZED`) recebem `VARIABLE` e **não
projetam** — `TRANSFER` porque não é gasto, `UNCATEGORIZED` porque projetar o
que o usuário ainda não classificou é dar peso a uma dúvida. A consequência é
honesta e precisa aparecer na UI: **fila de revisão grande = projeção
incompleta.** O card mostra "N transações sem categoria não entraram nesta
conta", com link para `/revisao`.

### `Transaction` ganha a parcela

```prisma
model Transaction {
  // ...campos atuais
  /// Parcela lida da descrição crua ("PARC 3/12"). Nulas quando não é
  /// parcelamento. Vivem aqui, e não são reparseadas a cada projeção, porque a
  /// exclusão delas do cálculo da mediana precisa ser um filtro de SQL.
  installmentIndex Int?
  installmentTotal Int?

  @@index([userId, installmentTotal])
}
```

## O motor

Vive em `apps/api/src/lib/projection/`, espelhando `lib/categorization/`:
funções puras, sem Prisma, testáveis sem banco. Quem fala com o banco é
`modules/projection/projection.service.ts`, que monta os insumos e chama o motor.

```
lib/projection/
  medians.ts       # mediana mensal e dia mediano por categoria
  installments.ts  # parser de "3/12" e projeção das parcelas restantes
  events.ts        # geração do calendário de eventos futuros
  balance.ts       # reconstituição da linha histórica e acumulado da futura
  index.ts
```

### Ponto de partida do saldo

O saldo de hoje é a soma de `Account.balance` das contas `CHECKING` e `SAVINGS`
não excluídas — o mesmo `liquid` que `summarizeAccounts` já calcula no web,
agora também no servidor. `INVESTMENT` é patrimônio, não caixa. `CREDIT` fica de
fora até a fase 6, quando a fatura tiver data.

**Contas `excludedFromBalance` ficam fora dos dois lados.** Isto é uma exceção
deliberada à regra do item 29 do `PLAN.md`, onde a conta excluída sai do card de
saldo mas suas transações continuam valendo em relatórios e orçamentos. Numa
projeção de caixa a assimetria não fecha: se o saldo da conta não entra, as
saídas dela fazem a linha descer de um dinheiro que nunca subiu. Relatório mede
comportamento; projeção mede caixa.

### A linha até hoje

A parte sólida do gráfico (dia 1 até hoje) é reconstituída para trás a partir do
saldo conhecido: o saldo do dia D é `saldoHoje − Σ(transações com data > D e
≤ hoje)`, com `INCOME` somando e `EXPENSE` subtraindo, fora `TRANSFER` e fora as
contas excluídas.

Isso assume `Account.balance` atualizado. Se o `lastSyncedAt` mais antigo entre
as contas for anterior a hoje, **a linha inteira está deslocada** — e o DTO
carrega `balanceAsOf` justamente para a UI poder dizer "saldo de 3 dias atrás"
em vez de fingir precisão. O sync automático (hoje no backlog do `PLAN.md`) é o
que resolve isso de verdade; até lá, o aviso.

### Mediana por categoria

Janela: até **6 meses fechados**, começando no primeiro mês em que o usuário tem
transação. O mês corrente fica fora — está pela metade, e incluí-lo puxaria toda
mediana para baixo. E a janela **não pode ser mais longa que o histórico**: para
quem usa o app há três meses, ela tem três posições, não seis com metade zerada
— senão a mediana de todo mundo novo seria zero, e a projeção diria que ninguém
gasta nada.

Dentro dessa janela, soma por mês **incluindo os meses sem movimento como zero**,
e tira a mediana. Incluir os zeros é o que faz a regra ser uma só: a categoria
esporádica (o IPVA que aparece uma vez em seis meses) cai para mediana zero e não
projeta — que é o comportamento certo num horizonte de um mês. Despesa anual é
limitação conhecida desta fase, resolvida na fase 4.

Transações com `installmentTotal != null` **saem do cálculo da mediana**. Elas já
são projetadas uma a uma; contá-las nos dois lugares dobraria o valor.

### Quanto ainda falta gastar

`jaGasto` é a soma da categoria no mês corrente até hoje. O restante depende da
natureza:

**Fixa** — `restante = max(0, mediana − jaGasto)`. Despesa fixa já paga não se
repete no mesmo mês, e despesa fixa não acelera.

**Variável** — o maior entre duas leituras:

- *pela mediana*: `max(0, mediana − jaGasto)` — o mês fecha no de sempre.
- *pelo ritmo*: `jaGasto ÷ diasDecorridos × diasRestantes` — o mês fecha no ritmo
  atual.

Fica o **maior dos dois**. Num app de finanças, subestimar despesa é o pior erro
possível: o número otimista é o que faz alguém gastar dinheiro que não tem. Se
você já estourou a mediana no dia 10, a leitura pela mediana projetaria zero para
o resto do mês, o que é absurdo — o ritmo cobre esse caso; e se você está devagar
no dia 25, a mediana segura o número.

Receita segue a mesma regra, pela mesma razão invertida: receita variável
projetada para cima é a mesma mentira com outro sinal.

### Em que dia cada coisa cai

- **Fixa:** a **mediana do dia do mês** das ocorrências passadas da categoria. Se
  esse dia já passou e o gasto ainda não apareceu, vai para amanhã — atrasado não
  é cancelado.
- **Variável:** o total estimado é **distribuído por igual entre os dias que
  faltam**. É isso que faz a linha descer suave em vez de dar um degrau no fim do
  mês.
- **Parcela:** o mesmo dia do mês da parcela anterior.

### Parcelamentos

O parser lê a descrição **crua**, não a normalizada: `normalizeDescription` já
remove o padrão da parcela (é lixo para casar comerciante, é informação aqui).

Padrão: `(?:parc(?:ela)?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})`, com guardas para não
casar data — rejeita quando vem seguido de outra barra (`03/08/2026`), quando o
total passa de 48, quando o índice é maior que o total, e quando o total é 1. Os
falsos positivos que sobram (`12/26` querendo dizer dezembro de 2026) são o
motivo de o parser ter arquivo e teste próprios.

Preenchido no pipeline pós-importação (`processNewTransactions`) e em
`createTransaction`. As já existentes entram por um script de backfill, rodado
uma vez, escopado por `userId`.

Projeção: agrupa por `(merchantKey, installmentTotal, valor)`, pega a maior
parcela já vista, e projeta as restantes — uma por mês, mesmo valor, mesmo dia.
Cada uma vira um evento `installment`, que conta como comprometido.

### Quando o motor não sabe

`basis` no DTO diz de que o número foi feito:

- `median` — pelo menos 2 meses fechados de histórico. O caminho normal.
- `run-rate` — menos de 2 meses fechados, mas 14 dias ou mais de transações. Só a
  leitura pelo ritmo, sem mediana, e a UI rotula.
- `insufficient` — menos que isso. O motor **não devolve número**: devolve
  `projectedBalance: null`, e a UI mostra o estado vazio com "ainda não há
  histórico para projetar", não um zero disfarçado de resposta.

## API

```
GET /api/projection?horizon=month
```

`horizon` aceita `month` na fase 1; `3m` e `6m` chegam na fase 4 pelo mesmo
parâmetro — o motor já nasce parametrizado, só a tela é que espera.

```ts
export type ProjectionBasis = "median" | "run-rate" | "insufficient";
export type ProjectionNature = "committed" | "estimated" | "installment";

export interface ProjectionEventDTO {
  date: string;
  categoryId: string | null;
  categoryName: string;
  categoryIcon: string | null;
  categoryColorKey: string | null;
  type: TransactionType;
  amount: number;
  nature: ProjectionNature;
  /** "Aluguel (fixa, mediana de 6 meses)", "Parcela 4/12 — Magalu". */
  label: string;
}

export interface ProjectionDailyPointDTO {
  date: string;
  /** true até hoje: reconstituído do saldo real, não projetado. */
  actual: boolean;
  /** Só o comprometido. É o teto da banda de incerteza. */
  balanceCommitted: number;
  /** Comprometido + estimado. É a linha que se desenha, e o piso da banda. */
  balanceExpected: number;
}

export interface ProjectionDTO {
  basis: ProjectionBasis;
  generatedAt: string;
  /** Saldo de quando? O `lastSyncedAt` mais antigo entre as contas do caixa. */
  balanceAsOf: string | null;
  horizonEnd: string;
  startingBalance: number;
  committed: number;
  estimated: number;
  /** Null quando `basis` é `insufficient`. */
  projectedBalance: number | null;
  /** O pior ponto da linha no horizonte — onde o mês aperta. */
  lowPoint: { date: string; balance: number } | null;
  /** Quantas transações ficaram de fora por estarem sem categoria. */
  uncategorizedCount: number;
  events: ProjectionEventDTO[];
  daily: ProjectionDailyPointDTO[];
}
```

A banda de incerteza não precisa de estatística: **o intervalo entre "só o
comprometido" e "comprometido mais o habitual" já é a incerteza**, e os dois
extremos são explicáveis em uma frase cada.

`GET /categories` passa a devolver `nature`, e `PATCH /categories/:id` a
aceitá-lo. As de sistema recusam a alteração, como já recusam orçamento.

## Frontend

**Toggle na categoria.** Dois botões em `CategoryFormModal.tsx` — "Fixa" e
"Variável" — com uma linha de ajuda dizendo o que muda ("fixa entra no seu
comprometido do mês"). `CategoriesPage` ganha o rótulo na lista, para dar para
revisar tudo de uma vez sem abrir cada uma.

**Card no Dashboard.** Abaixo dos cards de saldo:

> **No fim de agosto** — R$ 1.240
> Comprometido R$ 2.180 · Estimado R$ 640
> [ de onde vem esse número ]

O card **só aparece no mês corrente** (`month.isCurrentMonth`). Projetar num mês
que já fechou não quer dizer nada, e o Dashboard navega por mês.

Todo valor passa por `<Money>`, como o resto do app — sem isso o modo discreto
vaza justamente na tela nova.

**Folha "de onde vem esse número".** A lista de `events` agrupada por data, com a
natureza de cada linha marcada. É a tela que responde quando o usuário discorda
do número — e ela existe de graça porque o motor já produz a lista.

**Estados.** `insufficient` vira `EmptyState` com o texto honesto; `run-rate`
vira um selo discreto no card; `uncategorizedCount > 0` vira a linha com link
para `/revisao`.

## Testes

Puros, sem banco, no padrão de `lib/categorization/`:

- `medians.test.ts` — mediana com zeros; categoria esporádica caindo para zero;
  dia mediano; exclusão das parcelas.
- `installments.test.ts` — `PARC 3/12`, `3/12`, `(03/12)`; e os que **não** podem
  casar: `03/08/2026`, `12/2026`, `1/1`, `5/60`.
- `events.test.ts` — fixa já paga não reprojeta; variável estourada segue pelo
  ritmo; variável devagar segura na mediana; receita idem; distribuição uniforme
  do estimado.
- `balance.test.ts` — reconstituição para trás bate com o saldo de hoje;
  transferências e contas excluídas fora dos dois lados.
- `projection.service.test.ts` — os três `basis` e as fronteiras entre eles.

## Fora do escopo da fase 1

Lançamentos agendados, fatura de cartão com data, despesas anuais, detecção de
recorrência, reserva de segurança configurável, e qualquer horizonte além do mês
corrente.

---

# Fases seguintes

## Fase 2 — a linha de saldo diário

Barata: `daily` já vem pronto da fase 1. O que falta é o componente — hoje só
existe gráfico de barras (`MonthlyFlowChart.tsx`), e este é de linha, com traço
sólido até hoje, pontilhado adiante, banda sombreada entre `balanceCommitted` e
`balanceExpected`, e uma marca no `lowPoint`. Segue o mesmo padrão de acesso do
gráfico atual: balão no hover **e no foco**, e `aria-label` descritivo por ponto.

## Fase 3 — quanto posso gastar hoje

Três números novos, todos derivados do que a fase 1 já calcula:

- **Custo de vida** — mediana das despesas mensais de 6 meses.
- **Runway** — saldo líquido ÷ custo de vida. "3,4 meses de folga" é
  provavelmente o número mais valioso do app inteiro, e sai quase de graça.
- **Dia seguro** — o dia em que `balanceExpected` cruza zero, ou o fim do
  horizonte.

E o **disponível diário**: `(saldo − comprometido restante − reserva) ÷ dias que
faltam`, com a reserva de segurança configurável entrando aqui.

## Fase 4 — horizonte longo

`horizon=3m|6m` no mesmo endpoint, e o fluxo projetado em barras por semana ou
por mês. Duas coisas novas de verdade:

- **Despesas anuais.** Janela de 12 meses e um caminho para eventos que acontecem
  uma vez por ano — a mediana de 6 meses não os enxerga, e num horizonte de 6
  meses o IPVA importa.
- **Erro acumulado.** Quanto mais longe, mais a banda abre. A UI precisa mostrar
  isso, ou o mês 6 é lido com a mesma confiança do mês 1.

## Fase 5 — lançamentos agendados

Transação com data futura, lançada à mão, entrando como comprometido com data
exata. O trabalho difícil não é o cadastro: é **casar o agendado com o real** que
chega da Pluggy depois, sem contar duas vezes e sem exigir que o usuário faça a
conciliação na mão. Vale reusar a similaridade de descrição que já existe.

## Fase 6 — fatura de cartão

A Pluggy expõe `creditData` (fechamento, vencimento, limite). Modelar isso muda o
número de verdade: hoje o cartão é uma conta cujo `balance` é a dívida, e a
projeção não sabe *quando* aquilo vira saída de caixa. É o item de maior impacto
e de maior custo do roadmap.

## Fase 7 — waterfall e top comerciantes

Duas leituras que não dependem de projeção nenhuma:

- **Waterfall do mês** — saldo inicial → receitas → cada categoria → saldo final.
  Mostra o que comeu o mês, não só quanto.
- **Top comerciantes** — via `merchantKey`, que já existe. "Alimentação R$ 1.200"
  não é acionável; "iFood R$ 640 em 19 pedidos" é.

## Fase 8 — fixo vs variável, e burn-down

Quanto da renda já está comprometido antes de você acordar; e a linha ideal vs
real dentro do mês por categoria, que diz "no ritmo atual você estoura dia 22" —
coisa que a barra de progresso do orçamento não diz.

## Fase 9 — assinaturas

Aqui, sim, um detector de recorrência próprio: mesmo `merchantKey`, valor
estável, cadência mensal. Destrava a aba de Assinaturas do backlog, o alerta de
assinatura que subiu de preço, e a cobrança duplicada.

---

# Ideias registradas, ainda sem fase

Levantadas no brainstorming ou saídas do desenho acima. Não estão priorizadas.

**Pré-requisitos que o roadmap vai cobrar:**

- **Sync automático** (já no backlog do `PLAN.md`). Projeção calculada sobre
  saldo de dez dias atrás é projeção errada. Vira pré-requisito real a partir da
  fase 2.
- **Snapshot mensal de saldo** (`BalanceSnapshot`, gravado no sync). Torna a
  reconstituição da linha histórica exata em vez de derivada, **e** destrava o
  gráfico de patrimônio líquido ao longo do tempo.
- **`isRecurring` está órfão.** Nenhum consumidor lê. Ou vira o override por
  transação ("esta é comprometida, independente da categoria"), ou sai. Campo sem
  leitor é dívida.
- **Split de transação** em várias categorias. Hoje uma compra de R$ 800 no
  mercado que era metade presente distorce a mediana de Mercado para sempre.

**Coisas que a projeção destrava:**

- **Notificação "sua projeção virou negativa"**, no dia em que cruza. É o que
  transforma o número de tela em produto.
- **Orçamento sugerido pela mediana** — "você gasta R$ 780 em Mercado; quer virar
  orçamento?". Fecha o laço com a aba de Planejamento, que já existe.
- **Meta alimentada pela sobra projetada** — "sobrando R$ 400/mês, sua meta chega
  em novembro". Conecta com o `monthlyPaceNeeded` de `goals.service.ts`.
- **Backtest da projeção** — guardar a projeção do dia 1 e mostrar o erro no dia
  30. Custa uma tabela pequena, calibra o motor, e é o que faz o usuário confiar
  no número.
- **Modo "e se"** — simulador: "e se eu cortar 30% de Restaurante?".

**Leituras avulsas:**

- Anomalia por comerciante (transação muito acima do normal *para aquele lugar*).
- Heatmap por dia do mês e por dia da semana.
- Sazonalidade 12 meses × categorias.
- Comparação com o mesmo mês do ano anterior.
- Renda irregular: mediana e pior mês em vez da média.
- Fechamento do mês — notificação no dia 1º com as 3 maiores variações.
- Exportar CSV e relatório mensal.
- Reserva de emergência como meta especial, alimentada pelo custo de vida.
- Contas compartilhadas (casal). Grande; muda auth, escopo e permissão.

**Descartadas:**

- **Sankey receita → categorias.** Bonito, caro, e diz menos que o waterfall.
- **Projeção calculada no navegador.** Contradiz a decisão que originou o
  `reports.service.ts`.
- **Projeção materializada em tabela.** Otimização sem problema medido.
