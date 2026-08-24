# Compensação de estorno de compra parcelada

Status: aprovado, aguardando plano de implementação.

## Problema

Uma compra de R$ 272 no cartão, parcelada em 8x, foi estornada quatro dias
depois. O app ficou com nove linhas que, juntas, descrevem algo que não
aconteceu:

```
17/08  EXPENSE   34,00 × 8   MERCADOLIVRE*MERCADOLIVRE   parcelas 1..8/8
21/08  INCOME   272,00       MERCADOLIVRE*MERCADOLIVRE   o estorno
```

Setembro ganha R$ 272 de receita que nunca existiu — contaminando receita do
mês, saldo, taxa de poupança e a série mensal. Os sete meses seguintes carregam
R$ 34 cada de uma despesa que nunca será paga. A soma dos nove meses dá zero, e
é por isso que o erro é fácil de não notar e chato de conviver.

## O que a Pluggy entrega, e o que ela não entrega

Duas transações independentes. Não há `reversalOf`, id compartilhado, nem
qualquer campo que diga que uma desfaz a outra. O vínculo é inteiramente
circunstancial: mesma conta, mesma descrição, o crédito bate com a soma do
grupo, quatro dias de distância.

Investigando a conta real, três fatos delimitaram o escopo:

1. **O emissor não cancelou o parcelamento.** Três dias depois do estorno, a
   API ainda devolvia as oito parcelas `PENDING`. Elas vão cair, uma por fatura,
   de setembro a abril.
2. **O estorno virou saldo credor.** O Mercado Pago lançou os R$ 272 como
   `OTHER_PAYMENT` na fatura de agosto, já fechada. É crédito na conta do
   cartão, não um lançamento que anula parcela.
3. **A descrição não identifica nada.** Uma compra de R$ 25,99 no dia seguinte
   tem a string idêntica — `MERCADOLIVRE*MERCADOLIVRE`. Marketplace usa o mesmo
   descritor para tudo.

## Por que nada do que já existe alcança o caso

| Mecanismo | Por que não serve |
|---|---|
| `detectTransferPairs` | Exige `accountId` **diferente** e valor 1:1. Aqui é a mesma conta e é 1:8. |
| `casarPagamentos` | Casa fatura contra débito em outra conta. Forma errada. |
| `purchaseKey` | Agrupa as 8 parcelas entre si — mas o estorno não tem metadata de parcela e calcula chave diferente. |

O `purchaseKey` é, ainda assim, o que torna a feature viável. Sem ele, achar "o
subconjunto de transações que soma exatamente 272" seria um problema de
subset-sum sobre a lista inteira. Com ele, a busca é contra grupos de compra
fechados, e isso é tratável.

## Decisões tomadas

**Manual, não automático.** Este seria o terceiro caminho do sistema a gravar
sem perguntar, e o mais arriscado dos três: errar aqui apaga uma despesa real do
relatório em silêncio, e a pessoa descobre meses depois conferindo à mão. O
custo de pedir um toque é baixo; o de errar sozinho, não.

**Parte do estorno.** A ação nasce na linha do crédito e escolhe a compra, e não
o contrário. É a ordem em que a pessoa encontra o problema: o crédito aparece na
lista, e a pergunta seguinte é de onde ele veio.

**Só compra parcelada.** Compra à vista estornada já se resolve sozinha — a
despesa e o crédito caem na mesma fatura e no mesmo mês, e o total do mês fica
certo sem ninguém fazer nada. É o parcelamento que espalha a despesa por meses
que o crédito não alcança. Restringir a feature ao caso que ela existe para
resolver é o que a mantém pequena.

**Só compensação total.** O crédito precisa bater exatamente com a soma do
grupo. Compensado passa a significar sempre "soma zero", que é uma invariante
que dá para verificar e explicar. Estorno parcial fica no backlog.

**Campo próprio, não categoria.** `compensationId` em `Transaction`, espelhando
o `transferPairId`. As alternativas foram descartadas: reusar
`TRANSFER` faria a tela de Relatórios listar uma compra estornada como
transferência entre contas, o que é mentira; uma categoria de sistema nova
apagaria a categoria original da compra e obrigaria o desfazer a jogar tudo em
"Sem categoria". Com campo próprio, a categoria original sobrevive e desfazer é
limpar uma coluna.

**O sync não congela a linha.** Uma parcela compensada continua recebendo mês,
valor e vencimento da Pluggy, exatamente como uma parcela que não foi
compensada. Só o vínculo é intocável — e é de graça, porque `compensationId` não
está em `camposDaTransacao`.

## Consequência aceita

Compensar diz que aquele dinheiro não foi gasto, e tira as nove linhas dos
totais de todos os meses. Não é o que o extrato do cartão mostra: lá, o crédito
entrou agora e as parcelas seguem pesando até abril, abatidas do valor a pagar
de cada fatura.

Aceitamos a divergência porque o modelo do app já se comprometeu com ela.
`competenceDate` significa "onde a despesa pesa", e para cartão isso é o mês da
fatura. Se a fatura vai ser abatida pelo crédito, a despesa nunca pesa. Tirar as
duas pontas não é simplificação — é o que o modelo já afirma.

O que o app **não** vai saber representar é saldo credor de cartão. Se o crédito
sobrar (estorno maior que a fatura), isso não aparece em lugar nenhum. Está no
backlog.

## Escopo

### 1. Schema

```prisma
model Transaction {
  // ...
  /// Une o estorno de uma compra parcelada às parcelas que ele cancela.
  /// Mesmo desenho do `transferPairId`: um uuid compartilhado por todas as
  /// pontas, que torna o vínculo idempotente e o desfazer atômico.
  ///
  /// Fora de `camposDaTransacao` de propósito: é o que garante que sync,
  /// reparo e webhook não tenham como sobrescrever o que a pessoa resolveu.
  compensationId String?

  @@index([compensationId])
}
```

Um grupo compensado é uma linha `INCOME` mais as N parcelas `EXPENSE`, todas com
o mesmo `compensationId`. Migração aditiva, sem backfill.

### 2. As regras, no servidor

A UI propõe; o servidor confere. Nenhuma das validações abaixo pode viver só no
cliente:

- as duas pontas pertencem ao mesmo `userId` e à **mesma conta**;
- a ponta crédito é `INCOME` e tem `compensationId` nulo;
- o alvo é um grupo de `purchaseKey` cujas linhas são todas `EXPENSE` **e todas
  com `installmentTotal` preenchido**;
- a soma do grupo bate exatamente com o valor do crédito, comparada em centavos
  sobre `Decimal` — nunca em float;
- nenhuma linha do grupo já está compensada;
- ou o grupo inteiro entra, ou nada entra.

A soma exata cobre de graça um caso que pareceria precisar de regra própria: uma
compra antiga da qual o app só importou parte das parcelas — a janela de busca
do sync corta histórico — não fecha a soma e simplesmente não aparece como
candidata.

### 3. Onde as linhas saem dos totais

São cinco consultas:

| Lugar | O que soma |
|---|---|
| `reports.service.ts:107` → `totalsByType` | receita e despesa do período |
| `reports.service.ts:139` → `expensesByCategory` | a rosca de despesa por categoria |
| `reports.service.ts:242` → `monthlySeries` | a série mensal (SQL cru) |
| `budgets.service.ts:38` → `listBudgets` | o gasto de cada orçamento na tela |
| `budgets.service.ts:126` → `upsertBudget` | o gasto devolvido ao salvar um orçamento |

As três de relatório já recebem `transferId` e ganham a cláusula de
`compensationId` do mesmo jeito.

As duas de orçamento merecem atenção porque **hoje não excluem nada**. Filtram
por `categoryId`, e como categoria de sistema nunca tem orçamento, transferência
fica de fora por acidente. Compensação não fica — a compra mantém a categoria
"Outros". Esquecer uma delas faz a compra compensada continuar consumindo o
orçamento, sem nada na tela explicando por quê.

A de `listBudgets` é a mais fácil de perder de vista, e por dois motivos: é ela
que alimenta a tela (a de `upsertBudget` só roda no instante em que se salva um
orçamento), e ela não usa `aggregate` nem `groupBy` — faz um `findMany` e soma
em JavaScript. Procurar por funções de agregação não a encontra.

**E as que não podem mudar:** a listagem de transações
(`transactions.service.ts:184`) e o dropdown de parcelas
(`transactions.service.ts:371`). Linha compensada continua visível — é por ela
que se desfaz. Filtrar ali esconderia a compensação de quem quer revertê-la.

### 4. API

```
GET    /transactions/:id/compensation/candidates
POST   /transactions/:id/compensation      { purchaseKey }
DELETE /transactions/:id/compensation
```

`GET` devolve os grupos elegíveis daquela conta — descrição, total, número de
parcelas, data da compra, `purchaseKey` — com marcação de qual bate no valor.

`DELETE` funciona das duas pontas: dado o crédito ou qualquer parcela, limpa o
`compensationId` do grupo inteiro.

`compensationId` entra no `TransactionDTO`, para a lista poder desenhar o selo.

### 5. A tela

O `TransactionDetailModal` já abre modais filhos (`CategorySelectModal`,
`SimilarTransactionsModal`), e a compensação segue o mesmo padrão em arquivo
próprio — `TransactionsPage.tsx` já tem 859 linhas e não deve crescer aqui.

- Tocar no crédito abre o modal de detalhe, que ganha a ação **"Compensar compra
  parcelada"**, visível só em `INCOME` ainda não compensada.
- A ação abre a lista de candidatas, **com a que bate no valor já selecionada**.
- Confirmar vincula as nove linhas; elas continuam visíveis na lista, com selo
  "compensado".
- O mesmo modal, em qualquer ponta, desfaz.

A ação vive no modal e não como botão solto na linha: um botão em toda linha de
receita polui a lista inteira por uma ação usada poucas vezes por ano.

O selo tem uma sutileza que vem de `lib/agruparCompras.ts`: quando mais de uma
parcela da compra passa pelos filtros, a lista já as reúne numa linha só. Então
a compra compensada aparece como **uma** linha com o selo `8x`, e não como oito.
O selo "compensado" precisa valer para a linha agrupada — o que quer dizer lê-lo
de `LinhaDaLista`, e não de uma `TransactionDTO` solta. Nos lugares que filtram
por mês (painel e tela de categorias) cai uma parcela por compra, e ali o selo é
por parcela mesmo.

### 6. Sync

Nada a fazer, e é esse o ponto. As três escritas que o sync tem — `syncItem`,
`repairAccount` e `sincronizarPorIds` — passam todas por `camposDaTransacao`, e
`compensationId` não está lá. O requisito se cumpre por construção.

Vale um teste que falhe se alguém adicionar o campo ali por engano: é a única
proteção contra a regressão silenciosa.

## Arquitetura e arquivos

| Arquivo | Mudança |
|---|---|
| `apps/api/prisma/schema.prisma` | coluna e índice |
| `apps/api/src/lib/compensacao.ts` | **novo** — a decisão, pura |
| `apps/api/src/lib/compensacao.test.ts` | **novo** |
| `apps/api/src/modules/transactions/transactions.service.ts` | candidatas, compensar, desfazer |
| `apps/api/src/modules/transactions/transactions.routes.ts` | as três rotas |
| `apps/api/src/modules/reports/reports.service.ts` | três exclusões |
| `apps/api/src/modules/budgets/budgets.service.ts` | uma exclusão |
| `packages/shared/src/index.ts` | `compensationId` no DTO, tipos das rotas |
| `apps/web/src/components/transactions/CompensationModal.tsx` | **novo** |
| `apps/web/src/components/transactions/TransactionDetailModal.tsx` | a ação |
| `apps/web/src/lib/api.ts` | as três chamadas |

A parte que decide fica isolada em `lib/compensacao.ts`, testável sem banco,
como `casarPagamentos` e `mesDaFatura`: dados um crédito e os grupos da conta,
quais são elegíveis e qual vem pré-selecionado.

## Testes

**Puros** (`compensacao.test.ts`): grupo que bate no valor é elegível e vem
pré-selecionado; valor diferente por um centavo não é elegível; grupo à vista
(sem `installmentTotal`) não é elegível; grupo já compensado não é elegível;
grupo de outra conta não é elegível; nenhuma candidata é resultado válido.

**De serviço**: compensar vincula todas as pontas com o mesmo id; recusa valor
diferente; recusa crédito já compensado; recusa transação de outro usuário;
desfazer limpa o grupo inteiro a partir de qualquer ponta.

**De regressão**: uma linha compensada sobrevive a `syncItem`, a `repairAccount`
e a `sincronizarPorIds`.

**De exclusão**: as quatro consultas ignoram linha compensada — a do orçamento
inclusive.

## Riscos

**Esquecer uma consulta de agregação.** É o risco central, e o único que produz
erro silencioso. Ele já se materializou uma vez: a primeira versão deste spec
dizia "quatro consultas, e nenhuma a mais", e a revisão do plano encontrou a
quinta — `listBudgets`, justamente a que alimenta a tela. Mitigação: teste
automatizado cobrindo as cinco nominalmente, e não uma busca por nome de função.

**A pessoa compensar a compra errada.** Duas compras de mesmo total na mesma
conta existem. A pré-seleção por valor não desempata sozinha, então a lista
precisa mostrar data e número de parcelas — e a compensação precisa ser
desfazível sem perda, que é o que o campo próprio garante.

**O banco reverter o estorno.** O crédito sumiria da Pluggy e as parcelas
voltariam a ser devidas, mas o vínculo local continuaria de pé. O sync hoje
nunca remove transação — a lacuna está no backlog, e enquanto ela existir esse
caso exige desfazer à mão.

## Backlog (registrado, não planejado)

- **Estorno parcial**: crédito que cobre parte do grupo, com escolha de quais
  parcelas ele cancela.
- **Saldo credor de cartão**: representar crédito que sobra depois de abater a
  fatura.
- **Sync que remove**: hoje o sync só cria e atualiza; transação que a Pluggy
  deixa de devolver fica no banco para sempre.
- **Sugerir a compensação**: com a máquina manual de pé e algum uso real, uma
  sugestão na fila de revisão (`CategorySuggestion`) passa a ser barata — e sem
  o risco de gravar sozinha, porque a fila pede confirmação.

## Contexto: dois bugs corrigidos antes deste trabalho

Ambos foram encontrados investigando este caso, e ambos já estão no working tree
com teste.

**O pagamento de fatura escolhido pela ordem cronológica.** `sincronizarFaturas`
pegava o último pagamento por data. Com o estorno entrando como `OTHER_PAYMENT`
onze dias depois da quitação real, a fatura de agosto de R$ 94,62 ficou gravada
como paga por R$ 272. `pagamentoQueQuita` descarta `OTHER_PAYMENT` e mantém
`FULL_PAYMENT` e `INSTALLMENT_PAYMENT`.

**O escorregão do mês da parcela postada.** `mesDaFatura` somava
`installmentNumber - 1` sobre o `billForecastDate` sempre. A premissa — o
forecast é a fatura da *primeira* parcela — só vale enquanto a parcela está
pendente; postada, o forecast já é o mês dela. Uma parcela 3/8 na fatura de
agosto era gravada em outubro, e cada fechamento reempurrava as que faltavam.
O `creditCardMetadata.billId` é o que separa os dois mundos.

O segundo importa diretamente para esta feature: conferir totais de grupos de
parcelas em cima de meses errados daria trabalho à toa.
