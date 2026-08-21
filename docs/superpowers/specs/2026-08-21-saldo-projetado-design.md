# Saldo projetado: um calendário de eventos, e as leituras que saem dele

Data: 2026-08-21 · Branch: `main`

## Problema

O app só sabe do passado. `Account.balance` é o saldo de agora, `/reports/summary`
soma o que já aconteceu, e a única pergunta que o painel responde é "quanto eu
gastei". A pergunta que se faz no dia 12, olhando o extrato, é outra: **"com o
que ainda vai entrar e sair, quanto sobra dia 31?"**

Não existe hoje nenhum conceito de futuro no código. Não há lançamento agendado,
não há data de vencimento de fatura, e `isRecurring` é um checkbox manual que
nenhum consumidor lê.

Este documento descreve o motor que produz esse futuro, e as telas que o mostram.

## O que o sync está jogando fora

O levantamento que abriu este desenho. `syncItem` grava de cada transação apenas
`description`, `amount`, `type`, `date` e `accountId`; de cada conta, apenas
`name`, `type` e `balance`. A Pluggy entrega, e o app descarta:

| Campo | O que é |
|---|---|
| `account.creditData.balanceCloseDate` | Data de **fechamento** da fatura |
| `account.creditData.balanceDueDate` | Data de **vencimento** |
| `account.creditData.creditLimit` / `availableCreditLimit` | Limite e disponível |
| `client.fetchCreditCardBills(accountId)` | Faturas: `dueDate`, `billClosingDate`, `totalAmount`, pagamentos |
| `transaction.creditCardMetadata.installmentNumber` / `totalInstallments` | Parcela **estruturada** |
| `transaction.merchant` | Nome, CNPJ e categoria do comerciante |

A consequência é direta: **a data da fatura e o parcelamento não precisam ser
adivinhados.** O parser de `"PARC 3/12"` na descrição, que num desenho anterior
era o motor, vira o que ele deveria sempre ter sido — fallback para lançamento
manual e para conector que não devolve o metadado.

## Decisões tomadas

Acordadas no brainstorming. O plano de implementação não as reabre.

1. **O sinal de "comprometido" é a categoria, não a transação.** Não há detector
   de recorrência genérico. `Category` ganha um toggle **fixa/variável**, e a
   fila de revisão que já existe é o que alimenta a projeção: o usuário
   categoriza "NETFLIX" numa categoria fixa uma vez, e o motor passa a projetar.
2. **Dentro de uma categoria fixa, o motor projeta por comerciante.** "Moradia"
   não é um número: é aluguel dia 5, condomínio dia 10, e um resíduo. A lista de
   eventos precisa ser legível linha a linha, ou ninguém confia no total.
3. **Caixa e crédito são dois universos que não se misturam.** Compra no cartão
   não é saída de caixa no dia da compra; é fatura no dia do vencimento.
4. **O motor produz um calendário de eventos datados**, e todo o resto é
   derivado dele. Uma fonte de verdade, várias vitrines. A lista **é** a
   explicação do número.
5. **Mediana, não média.** O mês do notebook novo não pode virar custo de vida.
6. **Subestimar despesa é o pior erro possível.** Onde há duas leituras, vale a
   mais pessimista — para despesa, a maior; para receita, a menor.
7. **Sem histórico suficiente, o app diz que não sabe.** Não devolve zero
   disfarçado de resposta. Mesma política da tela de offline: informação falsa é
   pior que ausência.
8. **A soma acontece no banco**, não no navegador — a razão de existir do
   `reports.service.ts` vale igual aqui.
9. **Horizonte de quatro meses**: o corrente e os três seguintes. É até onde
   parcelas e faturas ainda são conhecidas de verdade.

## Escopo

Um plano único, executado em várias sessões, cobrindo o subsistema de projeção
inteiro: o enriquecimento do sync que o destrava, o motor, a fatura de cartão, as
telas, as leituras derivadas e a notificação. O que ficou de fora está na seção
**Backlog**, no fim — registrado, não planejado.

---

# Arquitetura

**Uma fonte de verdade.** O motor produz um calendário de eventos datados e nada
mais. Todo o resto é derivado dele por agrupamento ou acumulação:

| Leitura | Como sai do calendário |
|---|---|
| Saldo de fim de mês | último ponto do acumulado |
| Linha de saldo diário | o acumulado, dia a dia |
| Dia do aperto | o mínimo do acumulado |
| Disponível diário | saldo − comprometido restante − reserva, ÷ dias |
| Runway | saldo ÷ custo de vida |
| "De onde vem esse número" | a lista, agrupada por data |

O motor vive em `apps/api/src/lib/projection/` — funções puras, sem Prisma,
testáveis sem banco, espelhando `lib/categorization/`:

```
lib/projection/
  medians.ts       # mediana mensal e dia mediano, por categoria e por comerciante
  installments.ts  # metadado da Pluggy, parser de "3/12" como fallback, parcelas restantes
  bills.ts         # ciclo do cartão: fatura fechada, ciclo aberto, ciclos futuros
  events.ts        # geração do calendário
  balance.ts       # reconstituição da linha histórica e acumulado da futura
  derived.ts       # runway, custo de vida, dia do aperto, disponível diário
  index.ts
```

Quem fala com o banco é `modules/projection/projection.service.ts`: monta os
insumos com `groupBy` e chama o motor.

---

# Modelo de dados

## Passo 0 — o sync para de descartar

```prisma
model Account {
  creditLimit          Decimal?  @db.Decimal(14, 2)
  availableCreditLimit Decimal?  @db.Decimal(14, 2)
  /// creditData.balanceCloseDate — fechamento do ciclo em aberto.
  statementClosingDate DateTime?
  /// creditData.balanceDueDate — vencimento da fatura em aberto.
  statementDueDate     DateTime?
}

model Transaction {
  /// creditCardMetadata da Pluggy quando vem. O parser da descrição é fallback.
  installmentIndex Int?
  installmentTotal Int?
  /// merchant.name da Pluggy. Null quando o conector não devolve.
  merchantName     String?
  /// merchantKey(description), materializado. Hoje é recalculado em memória a
  /// cada consulta — e agrupar por comerciante precisa ser GROUP BY, não reduce.
  merchantKey      String?

  @@index([userId, merchantKey])
  @@index([userId, installmentTotal])
}

/// Fatura de cartão vinda de client.fetchCreditCardBills(). Fatura fechada e não
/// paga é a saída de caixa mais certa que existe: valor exato, data exata.
model CreditCardBill {
  id           String    @id @default(uuid())
  userId       String
  accountId    String
  pluggyBillId String?   @unique
  dueDate      DateTime
  closingDate  DateTime?
  totalAmount  Decimal   @db.Decimal(14, 2)
  paidAmount   Decimal   @default(0) @db.Decimal(14, 2)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([userId, dueDate])
}
```

As transações já existentes recebem `merchantKey`, `installmentIndex` e
`installmentTotal` por um script de backfill, rodado uma vez, **escopado por
`userId`** — o banco tem mais de uma conta real.

O backfill tem um limite que é preciso declarar: `creditCardMetadata` não foi
guardado, e a Pluggy só devolve transação de uma janela recente. Então **as
linhas antigas só podem ser preenchidas pelo parser da descrição** — o metadado
estruturado vale da próxima sincronização em diante. Na prática a projeção fica
mais precisa com o tempo, e não há como acelerar isso sem reimportar.

## A natureza da categoria

```prisma
enum CategoryNature {
  FIXED
  VARIABLE
}

model Category {
  /// Fixa: o valor se repete todo mês e entra na projeção como *comprometido*.
  /// Variável: o valor oscila e entra como *estimado*, prorateado pelos dias que
  /// faltam. É o único sinal que o motor tem para separar as duas faixas.
  nature CategoryNature @default(VARIABLE)
}
```

`CategoryNature`, e não `ExpenseNature`: o toggle vale igual para receita — um
salário é receita fixa, e freela é receita variável. Nomear o enum pela despesa
faria a coluna mentir na metade das linhas em que ela é usada.

Padrão `VARIABLE`: marcar tudo como fixo faria o app afirmar compromissos que não
existem, e categoria fixa errada é mais difícil de perceber que variável errada.

As de `defaultCategories.ts` nascem marcadas, para que ninguém precise configurar
nada antes de o número valer:

| `FIXED` | `VARIABLE` |
|---|---|
| Renda, Moradia, Saúde, Serviços | Mercado, Transporte, Restaurante, Lazer, Casa, Eletrônicos, Outros |

As de sistema (`TRANSFER`, `UNCATEGORIZED`) recebem `VARIABLE` e **não projetam**
— `TRANSFER` porque não é gasto, `UNCATEGORIZED` porque projetar o que o usuário
ainda não classificou é dar peso a uma dúvida. A consequência é honesta e precisa
aparecer na UI: **fila de revisão grande = projeção incompleta.** O card mostra
"N transações sem categoria não entraram nesta conta", com link para `/revisao`.

## A reserva

```prisma
model User {
  /// Colchão que o "disponível diário" desconta antes de dividir pelos dias.
  safetyReserve Decimal @default(0) @db.Decimal(14, 2)
}
```

---

# O cálculo

## Dois universos

Se a mediana de "Restaurante" for calculada sobre todas as transações **e** a
fatura do cartão também for projetada, o jantar pago no cartão é contado duas
vezes. Por isso:

- Contas de **caixa** (`CHECKING`, `SAVINGS`) — suas transações alimentam as
  medianas por categoria e viram eventos de caixa datados.
- Contas de **crédito** — suas transações **nunca** viram evento de caixa.
  Alimentam só a projeção da fatura, que vira um evento no dia do vencimento.
- `INVESTMENT` é patrimônio, não caixa: fora dos dois.

Contas `excludedFromBalance` ficam fora dos **dois lados**. Isto é uma exceção
deliberada ao item 29 do `PLAN.md`, onde a conta excluída sai do card de saldo mas
suas transações continuam valendo em relatórios e orçamentos. Numa projeção de
caixa a assimetria não fecha: se o saldo da conta não entra, as saídas dela fazem
a linha descer de um dinheiro que nunca subiu. Relatório mede comportamento;
projeção mede caixa.

## Ponto de partida e a linha até hoje

O saldo de hoje é a soma de `Account.balance` das contas de caixa não excluídas —
o mesmo `liquid` que `summarizeAccounts` calcula no web, agora também no servidor.

A parte sólida do gráfico é reconstituída para trás: o saldo do dia D é
`saldoHoje − Σ(transações de caixa com data > D e ≤ hoje)`, com `INCOME` somando e
`EXPENSE` subtraindo, fora `TRANSFER`.

Isso assume `Account.balance` atualizado. Se o `lastSyncedAt` mais antigo entre as
contas de caixa for anterior a hoje, **a linha inteira está deslocada** — e o DTO
carrega `balanceAsOf` justamente para a UI poder dizer "saldo de 3 dias atrás" em
vez de fingir precisão. O sync automático (hoje no backlog do `PLAN.md`) é o que
resolve isso de verdade; até lá, o aviso.

## Medianas

Janela: até **6 meses fechados**, começando no primeiro mês em que o usuário tem
transação. O mês corrente fica fora — está pela metade, e incluí-lo puxaria toda
mediana para baixo. E a janela **não pode ser mais longa que o histórico**: para
quem usa o app há três meses ela tem três posições, não seis com metade zerada —
senão a mediana de todo mundo novo seria zero, e a projeção diria que ninguém
gasta nada.

Dentro dessa janela, soma por mês **incluindo os meses sem movimento como zero**, e
tira a mediana. Incluir os zeros é o que faz a regra ser uma só: a categoria
esporádica cai para mediana zero e não projeta — o comportamento certo num
horizonte curto.

Transações com `installmentTotal != null` **saem do cálculo da mediana**. Elas já
são projetadas uma a uma; contá-las nos dois lugares dobraria o valor.

## Categoria fixa: por comerciante

Dentro de uma categoria `FIXED`, agrupa por `merchantKey`. Um comerciante é
**recorrente** quando aparece em pelo menos 2 meses distintos da janela.

- Cada recorrente vira um evento **comprometido**: valor = mediana das ocorrências,
  dia = **mediana do dia do mês** em que caiu.
- O que sobra da categoria vira um único evento **estimado**, "Outros de
  Moradia": `max(0, medianaDaCategoria − Σ medianas dos recorrentes)`. Sem esse
  resíduo o motor subestimaria a categoria; somando a categoria inteira **mais**
  os comerciantes, contaria duas vezes. A subtração é o que fecha os dois lados.
- **Fixa já paga não reprojeta.** Se o comerciante já apareceu no mês corrente, o
  evento dele não é gerado — despesa fixa não acelera.
- **Dia que já passou e não apareceu vai para amanhã.** Atrasado não é cancelado.

## Categoria variável

`jaGasto` é a soma da categoria no mês corrente até hoje, só no universo caixa. O
restante do mês é o **mais pessimista** entre duas leituras:

- *pela mediana*: `mediana − jaGasto` — o mês fecha no de sempre.
- *pelo ritmo*: `jaGasto ÷ diasDecorridos × diasRestantes` — o mês fecha no ritmo
  atual.

Para **despesa**, fica o maior dos dois: se você já estourou a mediana no dia 10, a
leitura pela mediana projetaria zero para o resto do mês, o que é absurdo — o
ritmo cobre esse caso; e se você está devagar no dia 25, a mediana segura o
número. Para **receita**, fica o menor, pela razão invertida: receita variável
projetada para cima é a mesma mentira com outro sinal.

O total estimado é **distribuído por igual entre os dias que faltam**. É isso que
faz a linha descer suave em vez de dar um degrau no fim do mês.

Nos meses futuros do horizonte não há `jaGasto`: o mês inteiro é a mediana,
distribuída pelos dias.

## Parcelas

Fonte primária: `installmentIndex` / `installmentTotal`, gravados pelo sync a
partir do `creditCardMetadata`.

Fallback, para conector que não devolve e para lançamento manual: parser sobre a
descrição **crua**, não a normalizada — `normalizeDescription` já remove o padrão
da parcela (é lixo para casar comerciante, é informação aqui). Padrão
`(?:parc(?:ela)?\s*)?(\d{1,2})\s*\/\s*(\d{1,2})`, com guardas para não casar data:
rejeita quando vem seguido de outra barra (`03/08/2026`), quando o total passa de
48, quando o índice é maior que o total, e quando o total é 1. Os falsos positivos
que sobram (`12/26` querendo dizer dezembro de 2026) são o motivo de o parser ter
arquivo e teste próprios.

Projeção: agrupa por `(merchantKey, installmentTotal, valor)`, pega a maior parcela
já vista, e projeta as restantes — uma por mês, mesmo valor, mesmo dia.

**Onde a parcela cai depende da conta.** Parcela de cartão entra na *fatura* do mês
correspondente; parcela em conta corrente (crediário, consórcio) vira evento de
caixa direto. Sem essa separação, a parcela do cartão apareceria duas vezes.

**Data de liberdade**: a maior data final entre os parcelamentos ativos, e a soma
mensal que ela libera. "Suas parcelas acabam em março/2027, liberando R$ 890 por
mês" — sai de graça do mesmo calendário.

## A fatura do cartão

Três camadas, da mais certa para a mais estimada:

1. **Fatura fechada e não paga** (`CreditCardBill` com `dueDate >= hoje` e
   `paidAmount < totalAmount`): evento **comprometido** de `totalAmount − paidAmount`
   no `dueDate`. Valor exato, data exata — a saída mais certa que a projeção tem.
2. **Ciclo aberto**: soma das transações do cartão desde o último `closingDate`,
   mais a projeção do resto do ciclo (medianas das categorias no universo cartão,
   prorateadas pelos dias que faltam até `statementClosingDate`). Vira um evento
   no `statementDueDate`. Marcado como **estimado**.
3. **Ciclos futuros** (meses 2 a 4 do horizonte): mediana das faturas anteriores,
   mais as parcelas conhecidas que caem naquele ciclo. Estimado.

Cartão sem `creditData` (conector que não devolve): cai para uma regra declarada —
fatura projetada no mesmo dia do mês da última fatura conhecida; e se não houver
nenhuma, o cartão fica fora e a UI diz que ficou.

**Limite**: com `creditLimit` e `availableCreditLimit`, o motor calcula o dia em que
o acumulado do ciclo aberto cruza o limite, no ritmo atual. "No seu ritmo você bate
o limite dia 22."

## Quando o motor não sabe

`basis` no DTO diz de que o número foi feito:

- `median` — pelo menos 2 meses fechados de histórico. O caminho normal.
- `run-rate` — menos de 2 meses fechados, mas 14 dias ou mais de transações. Só a
  leitura pelo ritmo, sem mediana, e a UI rotula.
- `insufficient` — menos que isso. O motor **não devolve número**: devolve
  `projectedBalance: null`, e a UI mostra o estado vazio com "ainda não há
  histórico para projetar".

## Leituras derivadas

Todas em `derived.ts`, todas sobre o mesmo calendário:

| Leitura | Cálculo |
|---|---|
| Custo de vida | mediana das despesas mensais de caixa, 6 meses |
| Runway | saldo líquido ÷ custo de vida |
| Dia do aperto | o mínimo de `balanceExpected` no horizonte |
| Dia do cruzamento | primeiro dia em que `balanceExpected` fica negativo, ou null |
| Disponível diário | `(saldo − comprometido restante no mês − safetyReserve) ÷ dias que faltam` |
| Comprometimento da renda | `(fixas + parcelas + fatura) ÷ receita mediana mensal` |

---

# API

```
GET /api/projection?horizon=month|4m
```

`month` é só o mês corrente; `4m` é o corrente mais os três seguintes. O motor
nasce parametrizado pelo horizonte — quem só quer o card do Dashboard pede
`month` e não paga pelo cálculo dos ciclos futuros de cartão.

```ts
export type ProjectionBasis = "median" | "run-rate" | "insufficient";
export type ProjectionNature = "committed" | "estimated";
export type ProjectionSource =
  | "merchant"
  | "category-residual"
  | "variable"
  | "installment"
  | "bill";

export interface ProjectionEventDTO {
  date: string;
  categoryId: string | null;
  categoryName: string;
  categoryIcon: string | null;
  categoryColorKey: string | null;
  type: TransactionType;
  amount: number;
  nature: ProjectionNature;
  source: ProjectionSource;
  /** "Aluguel — fixa, mediana de 6 meses", "Fatura Nubank — vence dia 10". */
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

export interface ProjectionCardDTO {
  accountId: string;
  accountName: string;
  /** Fatura fechada e ainda não paga, se houver. */
  closedAmount: number | null;
  closedDueDate: string | null;
  /** Ciclo aberto: o que já entrou, e o que deve fechar. */
  openSoFar: number;
  openProjected: number;
  openClosingDate: string | null;
  openDueDate: string | null;
  creditLimit: number | null;
  /** Dia em que o ciclo aberto cruza o limite no ritmo atual. Null se não cruza. */
  limitBreachDate: string | null;
  /**
   * Quando o conector não devolve `creditData` nem fatura alguma, o cartão fica
   * fora do cálculo — e a UI precisa poder dizer isso em vez de omitir em
   * silêncio. Null quando o cartão entrou normalmente.
   */
  excludedReason: "no-credit-data" | null;
}

export interface ProjectionDerivedDTO {
  monthlyCostOfLiving: number | null;
  /** Em meses. Null quando o custo de vida é zero ou desconhecido. */
  runwayMonths: number | null;
  lowPoint: { date: string; balance: number } | null;
  /** Primeiro dia em que a linha cruza zero. Null quando não cruza. */
  zeroCrossingDate: string | null;
  dailyAllowance: number | null;
  safetyReserve: number;
  /** 0..1 — quanto da renda já tem dono. */
  committedIncomeRatio: number | null;
  /** Última parcela ativa, e o quanto ela libera por mês. */
  installmentFreedom: { date: string; monthlyAmount: number } | null;
}

export interface ProjectionDTO {
  basis: ProjectionBasis;
  generatedAt: string;
  /** Saldo de quando? O `lastSyncedAt` mais antigo entre as contas de caixa. */
  balanceAsOf: string | null;
  horizonEnd: string;
  startingBalance: number;
  committed: number;
  estimated: number;
  /** Null quando `basis` é `insufficient`. */
  projectedBalance: number | null;
  /** Quantas transações ficaram de fora por estarem sem categoria. */
  uncategorizedCount: number;
  derived: ProjectionDerivedDTO;
  cards: ProjectionCardDTO[];
  events: ProjectionEventDTO[];
  daily: ProjectionDailyPointDTO[];
}
```

A banda de incerteza não precisa de estatística: **o intervalo entre "só o
comprometido" e "comprometido mais o habitual" já é a incerteza**, e os dois
extremos são explicáveis em uma frase cada.

`GET /categories` passa a devolver `nature`, e `PATCH /categories/:id` a aceitá-lo.
As de sistema recusam a alteração, como já recusam orçamento.
`PATCH /auth/me` (que já existe, com `updateProfileSchema`) passa a aceitar
`safetyReserve`.

---

# Frontend

**Toggle na categoria.** Dois botões em `CategoryFormModal.tsx` — "Fixa" e
"Variável" — com uma linha de ajuda dizendo o que muda ("fixa entra no seu
comprometido do mês"). `CategoriesPage` ganha o rótulo na lista, para dar para
revisar tudo de uma vez sem abrir cada uma.

**Card no Dashboard**, abaixo dos cards de saldo:

> **No fim de agosto** — R$ 1.240
> Comprometido R$ 2.180 · Estimado R$ 640
> Aperta dia 8 · R$ 43 por dia até lá
> [ de onde vem esse número ]

Só aparece no mês corrente (`month.isCurrentMonth`) — projetar num mês que já
fechou não quer dizer nada, e o Dashboard navega por mês.

**Gráfico de linha** (`ProjectionChart.tsx`): sólido até hoje, pontilhado adiante,
banda sombreada entre `balanceCommitted` e `balanceExpected`, marca no ponto de
aperto. Segue o padrão de acesso de `MonthlyFlowChart.tsx`: balão no hover **e no
foco**, e `aria-label` descritivo por ponto.

**Folha "de onde vem esse número".** `events` agrupada por data, com a natureza de
cada linha marcada. É a tela que responde quando o usuário discorda do número — e
ela existe de graça porque o motor já produz a lista.

**Card do cartão**: fatura fechada a pagar, ciclo aberto ("R$ 2.140 até agora,
deve fechar em R$ 3.050"), e o alerta de limite quando houver `limitBreachDate`.

**Runway e comprometimento** ficam na aba de Planejamento, junto de orçamentos e
metas — é lá que se olha para o mês inteiro, não no Dashboard.

**Reserva de segurança**: um campo em Perfil, com `CurrencyInput`.

**Estados.** `insufficient` vira `EmptyState` com o texto honesto; `run-rate` vira
um selo discreto no card; `uncategorizedCount > 0` vira a linha com link para
`/revisao`.

Todo valor passa por `<Money>`, como o resto do app — sem isso o modo discreto
vaza justamente nas telas novas.

**Notificação.** Em `generateAutomaticAlerts`, quando `projectedBalance < 0` ou
`zeroCrossingDate` cai dentro do mês corrente. Uma por mês, **atualizada em vez de
duplicada** — o mesmo padrão de `createReviewNotification`. Severidade `WARNING`,
`link` para o Dashboard.

---

# Testes

Puros, sem banco, no padrão de `lib/categorization/`:

- `medians.test.ts` — mediana com zeros; categoria esporádica caindo para zero;
  dia mediano; exclusão das parcelas; janela menor que o histórico.
- `installments.test.ts` — metadado da Pluggy tem precedência sobre o parser; e o
  parser: `PARC 3/12`, `3/12`, `(03/12)`; e os que **não** podem casar:
  `03/08/2026`, `12/2026`, `1/1`, `5/60`.
- `bills.test.ts` — fatura fechada não paga vira comprometido; ciclo aberto
  projetado; cartão sem `creditData` cai no fallback declarado; parcela de cartão
  não vira evento de caixa.
- `events.test.ts` — fixa já paga não reprojeta; fixa atrasada vai para amanhã;
  resíduo da categoria fecha com a mediana; variável estourada segue pelo ritmo;
  variável devagar segura na mediana; receita fica com a leitura menor;
  distribuição uniforme do estimado.
- `balance.test.ts` — reconstituição para trás bate com o saldo de hoje;
  transferências e contas excluídas fora dos dois lados.
- `derived.test.ts` — runway com custo de vida zero devolve null; dia do aperto;
  disponível diário com reserva.
- `projection.service.test.ts` — os três `basis` e as fronteiras entre eles.

---

# Backlog

Levantado no brainstorming, registrado e **não** planejado.

**Pré-requisitos que o roadmap vai cobrar:**

- **Sync automático** (já no backlog do `PLAN.md`). Projeção calculada sobre saldo
  de dez dias atrás é projeção errada. Vira pré-requisito real assim que a linha
  diária existir.
- **Snapshot mensal de saldo.** Torna a reconstituição da linha histórica exata em
  vez de derivada, **e** destrava o gráfico de patrimônio líquido ao longo do tempo.
- **`isRecurring` está órfão.** Nenhum consumidor lê. Ou vira o override por
  transação ("esta é comprometida, independente da categoria"), ou sai. Campo sem
  leitor é dívida.
- **Split de transação** em várias categorias. Hoje uma compra de R$ 800 no mercado
  que era metade presente distorce a mediana de Mercado para sempre.

**Que a projeção destrava:**

- **Simulador "posso parcelar isso?"** — R$ 3.000 em 10x, respondido olhando a
  projeção dos dez meses em vez do saldo de hoje.
- **Modo "e se"** — "e se eu cortar 30% de Restaurante?".
- **Backtest da projeção** — guardar a projeção do dia 1 e mostrar o erro no dia 30.
  Custa uma tabela pequena, calibra o motor, e é o que faz o usuário confiar no
  número.
- **Orçamento sugerido pela mediana** — "você gasta R$ 780 em Mercado; quer virar
  orçamento?". Fecha o laço com a aba de Planejamento, que já existe.
- **Meta alimentada pela sobra projetada** — conecta com o `monthlyPaceNeeded` de
  `goals.service.ts`.
- **Assinaturas detectadas** — mesmo `merchantKey`, valor estável, cadência mensal.
  Destrava a aba de Assinaturas do backlog, o alerta de assinatura que subiu de
  preço, e a cobrança duplicada.
- **Despesas anuais.** IPVA, IPTU, seguro, 13º. A janela de 6 meses não os enxerga;
  precisa de janela de 12 e de um caminho próprio para evento anual. Limitação
  conhecida e declarada desta entrega.
- **Lançamentos agendados.** O trabalho difícil não é o cadastro: é casar o agendado
  com o real que chega da Pluggy depois, sem contar duas vezes.

**Leituras avulsas:**

- Waterfall do mês (saldo inicial → receitas → cada categoria → saldo final).
- Top comerciantes via `merchantKey` — "iFood R$ 640 em 19 pedidos" é acionável;
  "Alimentação R$ 1.200" não é.
- Burn-down de orçamento: "no ritmo atual você estoura dia 22".
- Anomalia por comerciante (transação muito acima do normal *para aquele lugar*).
- Heatmap por dia do mês e da semana; sazonalidade de 12 meses.
- Comparação com o mesmo mês do ano anterior; fechamento do mês com as 3 maiores
  variações.
- Reserva de emergência como meta especial, alimentada pelo custo de vida.
- Exportar CSV e relatório mensal.
- Contas compartilhadas (casal). Grande; muda auth, escopo e permissão.

**Descartadas:**

- **Sankey receita → categorias.** Bonito, caro, e diz menos que o waterfall.
- **Projeção calculada no navegador.** Contradiz a decisão que originou o
  `reports.service.ts`.
- **Projeção materializada em tabela.** Otimização sem problema medido.
- **Alternador "caixa vs regime de gasto".** Duas respostas para a mesma pergunta é
  como se perde a confiança no número.
