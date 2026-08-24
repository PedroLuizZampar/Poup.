# Competência, faturas de cartão e webhooks

Data: 2026-08-23 · Branch: `main`

## Problema

O spec anterior (`2026-08-23-parcelas-e-tipos-de-conta-design.md`) fez o app
enxergar a parcela. Este faz o app **contar** a parcela no lugar certo — e
descobre, no caminho, que ele conta errado hoje.

O Mercado Pago entrega uma compra em 10x como **dez transações de uma vez, todas
com a data da compra**, distinguidas só por `installmentNumber`. E manda
`billForecastDate` igual para todas: mês da compra mais um.

Duas consequências, ambas em produção agora:

1. **Uma compra de R$ 300 em 10x vira R$ 300 de despesa no mês da compra.**
   Relatórios, orçamentos e dashboard somam por `Transaction.date`, e as dez
   parcelas têm a mesma data. O orçamento do mês estoura por uma dívida que só
   vai sair da conta ao longo de dez meses.
2. **`billForecastDate` não distingue parcela.** Tomado ao pé da letra, ele joga
   as dez parcelas na mesma fatura. O campo diz "próximo mês" para todas.

E há um terceiro problema, que não é de parcela: o **pagamento da fatura**.
Quando o débito de R$ 300 sai da conta corrente, o app tem duas despesas de
R$ 300 — a soma das compras no cartão e o pagamento — e duplica o gasto.

## O que a Pluggy entrega e o app ainda joga fora

Levantado nos tipos do `pluggy-sdk@0.90` instalado:

| Campo | O que é | Hoje |
|---|---|---|
| `creditCardMetadata.purchaseDate` | Data original da compra | Descartado |
| `creditCardMetadata.billId` | A fatura a que a transação foi vinculada | Descartado |
| `creditCardMetadata.totalAmount` | Valor da compra inteira | Descartado |
| `creditCardMetadata.cardNumber` | Número mascarado do cartão | Descartado |
| `transaction.status` | `PENDING` \| `POSTED` | Descartado |
| `transaction.merchant` | Nome, razão social e CNPJ do lojista | Descartado |
| `client.fetchCreditCardBills(accountId)` | Faturas: vencimento, fechamento, total e **`payments[]`** | Nunca chamado |

**O que a Pluggy *não* tem:** um endpoint `/bills/:billId/transactions` neste SDK.
A ligação existe, mas do lado da transação — `creditCardMetadata.billId`. E não
há verificação de assinatura de webhook: `createWebhook(event, url, headers)`
aceita headers, e é esse o mecanismo de autenticação previsto.

## Decisões tomadas

Acordadas no brainstorming. O plano de implementação não as reabre.

1. **O vencimento é `billForecastDate + (installmentNumber - 1)` meses**, no dia
   `creditCardDueDay` da conta, limitado ao último dia do mês e **postergado ao
   próximo dia útil**. Vale para o conector que manda todas as parcelas juntas —
   que é o caso observado.
2. **Competência mora numa coluna nova, `competenceDate`**, gravada em toda
   transação. Para a comum é igual a `date`; para parcela de cartão é o **1º dia
   do mês da fatura**. Relatórios, orçamentos e dashboard passam a filtrar por
   ela.
3. **`competenceDate` guarda o primeiro dia do mês, não o vencimento.** Assim ela
   não depende de `creditCardDueDay`, e mudar o dia do cartão continua sem exigir
   backfill: o `dueDate` exibido segue derivado na leitura.
4. **`date` continua sendo a data da compra.** É a verdade, e é a chave do
   agrupamento. Nada a reescreve.
5. **Dia útil é fim de semana mais feriado nacional**, com os móveis calculados
   da Páscoa. Sem tabela para manter.
6. **A lista mensal mostra a parcela daquele mês**, com um dropdown que revela as
   N parcelas ordenadas e um total no fim.
7. **Pagamento de fatura é reconhecido pela API** (`payments[]` da fatura), com
   heurística de descrição como reserva, e categorizado como `TRANSFER` — que os
   relatórios já excluem de todos os totais.
8. **Webhook `transactions/updated` resolve na hora**, pelos ids do payload;
   `transactions/created` só marca pendência na conexão.
9. **Pluggy Payments (ITP) fica fora.** Poup lê; não inicia pagamento.

## Consequência aceita, e ela é grande

**Meses passados vão se redesenhar na primeira abertura depois do deploy.** Uma
compra em 10x que hoje aparece inteira em agosto passa a aparecer como dez
pedaços entre setembro e junho. Relatórios, gráficos e o consumo de orçamento de
todo mês que tenha parcela mudam de valor.

É o comportamento pedido, e é o correto — mas não é sutil, e quem abrir o app vai
notar. Não há caminho de volta conta a conta como havia no olhinho da poupança.

## Escopo

### 1. Vencimento e dia útil

`apps/api/src/lib/pluggyMapping.ts` ganha a regra nova e um módulo vizinho,
`apps/api/src/lib/diasUteis.ts`, com o calendário.

```
mesDaFatura(billForecastDate, installmentNumber)
  = billForecastDate + (installmentNumber - 1) meses
```

Sem `billForecastDate`, cai na derivação de hoje (mês da transação mais um) e
soma `(n-1)` do mesmo jeito. Sem `installmentNumber`, `(n-1)` é zero — compra à
vista não desloca.

```
vencimentoDaFatura(competenceMonth, dueDay)
  = dia min(dueDay, últimoDiaDoMês) do mês competenceMonth
  → se cair em sábado, domingo ou feriado nacional, anda para o próximo dia útil
```

O calendário é função pura. Os fixos são nove datas; os móveis — Carnaval
(terça, 47 dias antes da Páscoa), Sexta-Feira Santa (2 dias antes) e Corpus
Christi (60 dias depois) — saem do algoritmo de Meeus para a Páscoa, então não há
tabela por ano que alguém precise lembrar de atualizar.

**Limitação assumida:** postergar para o próximo dia útil é a convenção dos
emissores, mas nem todo emissor a segue, e nenhum informa a sua. Se um cartão
antecipar em vez de postergar, o app erra por um a três dias na exibição — e não
erra nada na competência, que é mensal.

### 2. Competência

Coluna nova em `Transaction`:

- `competenceDate DateTime` — o mês em que a transação conta. Igual a `date` para
  quase tudo; 1º dia do mês da fatura para parcela de cartão.

Não é nula: nulo obrigaria todo consumidor a decidir o que fazer com a ausência,
que é exatamente o problema que `SystemCategoryKey` resolveu para `categoryId`.

A migração preenche `competenceDate = date` para tudo que existe, e o reparo do
histórico recalcula as linhas de cartão.

**Quem passa a filtrar por `competenceDate`:**

| Arquivo | O que muda |
|---|---|
| `reports.service.ts` | `dateFilter` e os `groupBy` de mês e de categoria |
| `budgets.service.ts` | A janela do mês que apura o consumo |
| `transactions.service.ts` | O filtro `month` da lista |

**Quem continua na `date` real, de propósito:**

| Arquivo | Por quê |
|---|---|
| `categorization.service.ts` | O pareamento de transferência casa por proximidade de data real — competência não tem nada a ver com quando o dinheiro andou |
| `similar.service.ts` | A janela de "transações parecidas" é sobre hábito, e hábito é data real |
| `pluggy.service.ts` | `dataInicialDaBusca` fala com a Pluggy, que só conhece `date` |

### 3. Agrupamento das parcelas

Três colunas novas em `Transaction`, todas nulas fora de cartão:

- `purchaseDate DateTime?` — de `creditCardMetadata.purchaseDate`
- `purchaseKey String?` — a chave que junta as parcelas de uma compra
- `pluggyBillId String?` — de `creditCardMetadata.billId`

`purchaseKey` é derivada, não vinda pronta:

```
purchaseKey = sha1(accountId | purchaseDate ?? date | merchant.cnpj ?? descrição normalizada | totalInstallments)
```

O CNPJ entra antes da descrição porque descrição de cartão varia ("LOJA X 01/10",
"LOJA X 02/10"): a normalização já existe em `lib/categorization/normalize.ts` e
é reusada, mas CNPJ, quando vem, é estável e não precisa de normalização nenhuma.

`totalInstallments` entra na chave para que duas compras diferentes no mesmo
lojista, no mesmo dia, com números de parcelas diferentes, não colidam. Duas
compras idênticas no mesmo lojista, no mesmo dia, com o mesmo parcelamento,
**colidem de propósito** — são indistinguíveis nos dados, e tratá-las como uma
compra só é menos errado que inventar uma diferença.

**Na tela:** a lista do mês mostra a parcela daquele mês. Quando a transação tem
`purchaseKey`, um botão discreto expande abaixo dela as N parcelas — ordenadas
por `installmentIndex`, cada uma com seu mês e vencimento, a do mês corrente
destacada, e **uma linha de total no fim** com o valor da compra inteira.

Um endpoint novo serve o dropdown, em vez de mandar as N parcelas em toda listagem:

```
GET /api/transactions/:id/installments → { installments: TransactionDTO[], total: number }
```

### 4. Faturas e o pagamento

Model novo:

```prisma
model CreditCardBill {
  id              String   @id @default(uuid())
  userId          String
  accountId       String
  pluggyBillId    String   @unique
  dueDate         DateTime
  closingDate     DateTime?
  totalAmount     Decimal  @db.Decimal(14, 2)
  /// Data e valor do pagamento que a propria instituicao reporta. E o que
  /// permite reconhecer o debito na conta corrente sem adivinhar pela
  /// descricao.
  paidAt          DateTime?
  paidAmount      Decimal? @db.Decimal(14, 2)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  account Account @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([userId, dueDate])
  @@index([accountId])
}
```

O sync, para conta `CREDIT`, chama `fetchCreditCardBills(accountId)` e faz upsert
por `pluggyBillId`. Transações ganham `pluggyBillId` de `creditCardMetadata`.

**O reconhecimento do pagamento**, em ordem:

1. Para cada fatura com `paidAt`, procura na conta corrente do mesmo usuário um
   `EXPENSE` de valor igual a `paidAmount` numa janela de ±3 dias de `paidAt` —
   a mesma janela que `TRANSFER_WINDOW_DAYS` já usa.
2. Sem fatura com pagamento reportado, cai na descrição: `PAGTO FATURA`,
   `PAGAMENTO FATURA`, `PAGTO CARTAO`, `PAGAMENTO DE FATURA`, normalizadas por
   `lib/categorization/normalize.ts`, sobre um `EXPENSE` em conta não-crédito.

Achado, o débito recebe a categoria `TRANSFER` e a fatura recebe o vínculo. A
outra ponta — o crédito "PAGAMENTO RECEBIDO" no próprio cartão, quando o conector
o manda — entra no mesmo `transferPairId` que já existe, pelo mecanismo que já
existe.

**Por que isso não duplica:** `reports.service.ts` já exclui `TRANSFER` de todos
os totais desde o spec de categorização. A despesa fica onde é verdade — nas
compras, no mês da fatura de cada uma — e o pagamento só mexe no saldo da conta.
Nada de novo precisa ser construído para a não-duplicação; o que faltava era
reconhecer o pagamento.

**Descontos e estornos não duplicam pela mesma razão.** Um estorno é `INCOME` no
cartão (o spec anterior consertou o sinal) e reduz `totalAmount` da fatura. Como
o pagamento é neutro, o desconto aparece uma vez só: no cartão, no mês da fatura
dele. O que **não** se faz é somar `totalAmount` da fatura ao lado das
transações — a fatura é um agregado de leitura, nunca uma linha de despesa.

### 5. Webhooks

Rota nova, **sem `requireAuth`** — quem chama é a Pluggy, não o navegador:

```
POST /api/pluggy/webhook
```

A autenticação é um header secreto, registrado junto com o webhook e conferido em
tempo constante. Sem ele, 401 e nada acontece.

Registro: quando o usuário salva as credenciais Pluggy, o app chama
`createWebhook` na aplicação **dele**, para `transactions/created` e
`transactions/updated`, apontando para a URL pública com o header. O `itemId` do
payload identifica de quem é o evento, via `Item.pluggyItemId`.

| Evento | O que faz |
|---|---|
| `transactions/updated` | Busca **só** os `transactionIds` do payload (`fetchTransactions` com filtro `ids`, teto de 500) e reescreve `billId`, `status`, parcela e competência. Barato e limitado. |
| `transactions/created` | Marca `Item.hasPendingSync`. O link de transações criadas não tem tamanho conhecido, e o sync normal resolve. |
| Qualquer outro | 200 e ignora. Um webhook que responde erro é um webhook que a Pluggy desativa. |

`Item.hasPendingSync Boolean @default(false)` é a coluna nova; a tela de Perfil
mostra um ponto na conexão que tem novidade, e o sync a limpa.

**Limitação assumida:** o app não guarda os eventos recebidos. Um evento perdido
é um vínculo que só chega no próximo sync — que é exatamente o estado de hoje, e
não uma regressão.

## Arquitetura e arquivos

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/api/src/lib/diasUteis.ts` | Feriados nacionais e o próximo dia útil. Puro |
| `apps/api/src/lib/diasUteis.test.ts` | Testes das acima |
| `apps/api/src/lib/purchaseKey.ts` | A chave que junta as parcelas de uma compra. Puro |
| `apps/api/src/lib/purchaseKey.test.ts` | Testes das acima |
| `apps/api/src/modules/bills/bills.service.ts` | Upsert de fatura e reconhecimento do pagamento |
| `apps/api/src/modules/pluggy/webhook.routes.ts` | A rota pública e a conferência do header |
| `apps/web/src/components/transactions/InstallmentGroup.tsx` | O dropdown das parcelas, com o total |

**Modificados** — `schema.prisma` (as colunas de `Transaction`, o model
`CreditCardBill` e `Item.hasPendingSync`) e a migração; `pluggyMapping.ts` (a regra nova
do mês e do vencimento); `pluggy.service.ts` (faturas, competência, chave de
compra, e o reparo recalculando tudo isso); `reports.service.ts`,
`budgets.service.ts` e `transactions.service.ts` (competência); `packages/shared`
e as telas de transação.

## Testes

Tudo que é regra vira função pura, como `lib/categorization/`.

**`diasUteis.test.ts`** — sábado anda para segunda; domingo idem; 1º de janeiro
anda; Carnaval de 2027 cai na terça certa; Corpus Christi idem; um dia útil comum
não anda; a virada de ano no fim de dezembro.

**`pluggyMapping.test.ts`** (casos novos) — parcela 1/10 não desloca; 3/10
desloca dois meses; 10/10 desloca nove e vira o ano; sem `installmentNumber` não
desloca; vencimento 31 em fevereiro continua virando 28, e se o 28 for domingo,
anda para segunda.

**`purchaseKey.test.ts`** — duas parcelas da mesma compra dão a mesma chave;
descrições que só diferem no "01/10" vs "02/10" dão a mesma chave; CNPJ diferente
dá chave diferente; `totalInstallments` diferente dá chave diferente; sem
`purchaseDate` cai na `date`.

**`bills` (reconhecimento)** — a função que casa fatura com débito é pura sobre
listas e é testada sem banco: casa por valor e janela; não casa fora da janela;
não casa valor diferente; a heurística de descrição pega `PAGTO FATURA` e não
pega `PAGAMENTO ALUGUEL`.

Rotas, telas e o webhook continuam verificados à mão — é o padrão do projeto.

## Riscos

| Risco | Mitigação |
|---|---|
| Meses passados mudam de valor e assustam | Documentado acima como consequência aceita. É o comportamento pedido |
| Um conector manda parcela mês a mês, e `+(n-1)` adianta tudo | A regra vale para o conector observado. Se aparecer um que difira, o sinal é `date` variando entre parcelas do mesmo `purchaseKey` — dá para detectar, e está no Backlog |
| `purchaseKey` colide em duas compras idênticas no mesmo dia | Aceito e documentado: são indistinguíveis nos dados |
| Webhook público vira porta de entrada | Header secreto conferido em tempo constante, e nenhum efeito antes da conferência |
| O reconhecimento marca `TRANSFER` numa despesa real | Só age sobre valor **e** janela, ou sobre descrição explícita de fatura. E `TRANSFER` é reversível na tela, como já é hoje |
| A chamada de faturas estoura o tempo do sync | Uma chamada por conta de crédito, e só para elas. Se pesar, vai para o reparo |

## Backlog (registrado, não planejado)

- **Detectar o conector que manda parcela mês a mês** e desligar o `+(n-1)` para ele.
- **Dia de fechamento da fatura** (`creditData.balanceCloseDate`), para a compra
  feita depois do fechamento.
- **Parser de `"PARC 3/12"` na descrição**, para conector sem `creditCardMetadata`.
- **Parcela em lançamento manual.**
- **Guardar os eventos de webhook recebidos**, para reprocessar o que se perdeu.
- **Pluggy Payments (ITP)** — Payment Request, Payment Intent, conciliação por
  webhook. Deixaria Poup iniciar pagamento, e não só ler.
