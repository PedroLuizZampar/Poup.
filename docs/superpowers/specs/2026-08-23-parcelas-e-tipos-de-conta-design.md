# Parcelas, tipos de conta e o sinal que vem do `type`

Data: 2026-08-23 · Branch: `main`

## Problema

Quatro queixas de uso, com uma causa comum: **o sync descarta quase tudo que a
Pluggy manda sobre cartão de crédito, e adivinha o que já vem dado.**

1. **Valor devolvido aparece invertido.** Um estorno de cartão é lançado como
   despesa, e some do lugar onde deveria aparecer como entrada.
2. **Parcelamento não existe no app.** Uma compra em 10x é dez linhas
   indistinguíveis de dez compras avulsas.
3. **Toda conta é uma conta.** Poupança soma no saldo disponível como se fosse
   conta corrente, e não há como dizer que aquela conta é o cartão de débito.
4. **Parcela não tem vencimento.** Não há como saber em que fatura ela cai.

## O que a Pluggy entrega e o app joga fora

Levantado nos tipos do `pluggy-sdk` instalado (`node_modules/pluggy-sdk/dist/types/`):

| Campo | O que é | Hoje |
|---|---|---|
| `transaction.type` | `DEBIT` \| `CREDIT` — a direção do dinheiro | Lido, mas sobrescrito pelo sinal do valor |
| `transaction.creditCardMetadata.installmentNumber` | Número da parcela | Descartado |
| `transaction.creditCardMetadata.totalInstallments` | Total de parcelas | Descartado |
| `transaction.creditCardMetadata.billForecastDate` | Mês da fatura prevista (`YYYY-MM`), só em conectores Open Finance | Descartado |
| `account.creditData.balanceDueDate` | Data de vencimento da fatura atual | Descartado |
| `account.subtype` | `CHECKING_ACCOUNT` \| `SAVINGS_ACCOUNT` \| `CREDIT_CARD` | Lido só para derivar `AccountType` |

**A Pluggy não tem "cartão de débito".** `ACCOUNT_TYPES` é `["BANK", "CREDIT"]` e
`ACCOUNT_SUBTYPES` é `["SAVINGS_ACCOUNT", "CHECKING_ACCOUNT", "CREDIT_CARD"]`.
Um cartão de débito é, para ela, a conta corrente à qual está preso. Este
documento resolve isso com um rótulo manual, não inventando um tipo automático.

## Decisões tomadas

Acordadas no brainstorming. O plano de implementação não as reabre.

1. **O sinal vem de `transaction.type`.** O sinal do valor só decide quando o
   conector não mandou `type`. `amount` é sempre o módulo — isso já valia.
2. **Tipo da Pluggy e rótulo do usuário são duas colunas.** O sync escreve uma e
   nunca toca na outra, exatamente como `name`/`customName` e
   `institutionImageUrl`/`customImageUrl` já fazem.
3. **A data de vencimento da parcela não é gravada — é derivada na leitura**, de
   `billMonth` mais o dia de vencimento da conta. Corrigir o dia do cartão
   conserta todas as parcelas de uma vez, sem backfill.
4. **O dia de vencimento nasce do `balanceDueDate` da Pluggy; sem ele, 10.** Uma
   vez preenchido, o sync nunca reescreve — o usuário é quem corrige conector
   errado.
5. **Poupança nasce fora do saldo.** Só no `create`. O olhinho que já existe na
   Perfil é o que devolve a conta para o total.
6. **O reparo do histórico só reescreve linhas que já existem.** Não importa
   transação nova e não alimenta a fila de revisão.
7. **O reparo roda uma conta por requisição.** O teto de 60s do plano Hobby da
   Vercel é o motivo; a UI itera e mostra progresso.

## Relação com o plano do saldo projetado

`docs/superpowers/specs/2026-08-21-saldo-projetado-design.md` já previa parcelas
estruturadas e ciclo de fatura, e o plano correspondente está **0 de 105 passos
executado** (só o `CategoryKind` fixa/variável saiu, por outro caminho).

Este desenho é um recorte antecipado das Tasks 1–3 daquele plano, e **alinha os
nomes de coluna com ele** para que os dois não colidam:

| Coluna | Origem | Observação |
|---|---|---|
| `Transaction.installmentIndex` | Saldo projetado, Task 1 | Mesmo nome, mesmo significado |
| `Transaction.installmentTotal` | Saldo projetado, Task 1 | Mesmo nome, mesmo significado |
| `Transaction.billMonth` | Novo aqui | Não existia lá |
| `Account.creditCardDueDay` | Novo aqui | **Não** é o `statementDueDate` daquele plano: aquele é a data da fatura corrente, vinda da Pluggy a cada sync; este é um dia do mês, editável, que sobrevive ao sync |

Quando o plano do saldo projetado for executado, suas Tasks 2 e 3 já encontrarão
`installmentIndex`/`installmentTotal` preenchidos e devem pular a parte que as
cria. O parser de `"PARC 3/12"` na descrição, previsto lá como fallback, **fica
fora deste recorte** — ver Backlog.

## Escopo

### 1. O sinal vem do `type`

Hoje, em `apps/api/src/modules/pluggy/pluggy.service.ts`:

```ts
type: pTx.type === "DEBIT" || rawAmount < 0 ? TransactionType.EXPENSE : TransactionType.INCOME,
```

Num cartão de crédito a Pluggy manda compra como `DEBIT` com valor positivo e
estorno como `CREDIT` com valor **negativo**. O `|| rawAmount < 0` transforma o
estorno em despesa. A regra passa a ser:

- `type === "CREDIT"` → `INCOME`
- `type === "DEBIT"` → `EXPENSE`
- `type` ausente ou desconhecido → o sinal decide (`< 0` → `EXPENSE`)

`amount` continua `Math.abs(rawAmount)`, agora com guarda contra `NaN`/`Infinity`
(um valor não-finito viraria `Decimal` inválido e derrubaria o lote inteiro).

O mapeamento sai do meio do `syncItem` e vira função pura em
`apps/api/src/lib/pluggyMapping.ts`. Hoje o sync não tem **nenhum** teste de
mapeamento — `sync.test.ts` cobre só `emLotes` e `dataInicialDaBusca`.

### 2. Parcelas

Três colunas novas em `Transaction`, todas nulas fora de cartão:

- `installmentIndex Int?` — de `creditCardMetadata.installmentNumber`
- `installmentTotal Int?` — de `creditCardMetadata.totalInstallments`
- `billMonth String?` — `YYYY-MM`, a fatura em que a linha cai

`billMonth` é resolvido assim, nesta ordem:

1. `creditCardMetadata.billForecastDate`, quando vier — é o mês que o próprio
   banco projetou, e vale para lançamento pendente e futuro também.
2. Senão, **mês da data da transação mais um**. Cada parcela chega como uma
   transação na fatura dela, então o número da parcela não entra na conta.

**Limitação assumida:** a derivação erra em um mês para compra feita depois do
fechamento da fatura. A Pluggy expõe `creditData.balanceCloseDate`, mas modelar
fechamento exige guardar o dia de fechamento, tratar a virada de ano e decidir o
que fazer quando ele muda — e só melhora os conectores que já não mandam
`billForecastDate`. Fica no Backlog.

A **data de vencimento não é coluna.** O DTO da transação a calcula:

```
dueDate = dia `creditCardDueDay` do mês `billMonth`,
          limitado ao último dia daquele mês
```

O limite existe para vencimento 31 em fevereiro: vira 28 (ou 29). Sem ele,
`new Date(Date.UTC(2026, 1, 31))` vira 3 de março silenciosamente.

`TransactionDTO` ganha `installmentIndex`, `installmentTotal` e `dueDate`
(ISO ou `null`). `listTransactions` e `getTransactionById` já fazem
`include: { account: ... }`; passam a selecionar também `creditCardDueDay`.

**Na tela:**
- Lista de transações (mobile e desktop): selo compacto `3/10` ao lado da
  descrição, só quando `installmentTotal` existe.
- `TransactionDetailModal`: linha "Parcela 3 de 10 · vence em 10/09/2026". Sem
  `dueDate`, só "Parcela 3 de 10".

### 3. Classificação das contas

O enum `AccountType` ganha `DEBIT_CARD`:

```prisma
enum AccountType {
  CHECKING
  SAVINGS
  CREDIT
  DEBIT_CARD
  INVESTMENT
}
```

`DEBIT_CARD` é **inalcançável pelo sync** — só o usuário o escolhe.
`mapAccountType` não muda.

`Account` ganha `customType AccountType?`. O tipo efetivo é `customType ?? type`,
resolvido por `resolveAccountType()` em `accounts.service.ts`, ao lado do
`resolveAccountName()` que já existe e resolve o mesmo dilema para o nome.

`AccountDTO` passa a espelhar o padrão do nome:

| Campo | Significado |
|---|---|
| `type` | O **efetivo** — `customType ?? type`. Consumidores existentes seguem funcionando |
| `originalType` | O que a Pluggy derivou |
| `customType` | A escolha do usuário, ou `null` |

Os rótulos em português vivem num só lugar no web (`apps/web/src/lib/accounts.ts`):
Conta corrente, Poupança, Cartão de crédito, Cartão de débito, Investimento.

`summarizeAccounts` passa a tratar `DEBIT_CARD` como líquido (é a conta corrente
com outro nome). `CREDIT` e `INVESTMENT` seguem como estão.

### 4. Poupança fora do saldo

No `upsert` de conta do sync, **só no ramo `create`**:

```ts
excludedFromBalance: mapAccountType(pAccount) === AccountType.SAVINGS
```

O ramo `update` não menciona o campo — a escolha do olhinho é do usuário e o sync
não a desfaz, mesmo padrão de `customName`.

A migração faz o mesmo com o que já está no banco:

```sql
UPDATE "Account" SET "excludedFromBalance" = true WHERE "type" = 'SAVINGS';
```

**Consequência aceita:** o saldo do Dashboard de quem hoje tem poupança somando
cai na primeira abertura depois do deploy. É o comportamento pedido, e o olhinho
da Perfil reverte conta a conta.

Nenhuma outra tela muda: `excludedFromBalance` já sai só dos cards de saldo, e
transações, relatórios e orçamentos continuam contando a poupança.

### 5. Dia de vencimento do cartão

`Account.creditCardDueDay Int?`, com domínio 1–31.

- **`create` do sync**, quando o tipo é `CREDIT`:
  `creditData.balanceDueDate?.getUTCDate() ?? 10`.
- **`update` do sync**: só preenche se estiver nulo. Já preenchido, não toca.
- **Migração**: `UPDATE "Account" SET "creditCardDueDay" = 10 WHERE "type" = 'CREDIT'`.
  O `balanceDueDate` das contas existentes não está no banco — e como o `update`
  do sync não sobrescreve valor já preenchido, o 10 fica até alguém editar. É o
  preço de não ter guardado o campo antes.

`RenameAccountModal` vira `EditAccountModal`, com três campos: nome (como hoje),
tipo (select dos cinco) e, **quando o tipo efetivo é cartão de crédito**, dia de
vencimento — um número de 1 a 31, preenchido com 10 quando vazio.

A obrigatoriedade é validada nos dois lados. A regra:

```
Se o tipo efetivo depois do PATCH for CREDIT, creditCardDueDay tem de ser
inteiro entre 1 e 31. Nulo, ou ausente com o campo ainda vazio no banco,
é 422.
```

O tipo efetivo depende de `customType` e do `type` gravado, então a validação
acontece no service, depois de ler a conta — o zod sozinho não tem esse contexto.
O zod valida forma (`int`, `1..31`, `nullable`); o service valida a regra.

`UpdateAccountRequest` ganha `customType?: AccountType | null` e
`creditCardDueDay?: number | null`.

### 6. Reparo do histórico

Uma rota nova:

```
POST /api/pluggy/accounts/:accountId/repair
```

Resolve a conta pelo par `(userId, accountId)` — o mesmo cuidado que
`getUserItem` já toma, porque id sozinho não prova posse. Depois:

1. Busca na Pluggy o extrato **sem `dateFrom`** — o histórico inteiro daquela
   conta.
2. Para cada transação retornada, procura a linha local por `pluggyTransactionId`.
3. **Se não existe, ignora.** Não insere.
4. Se existe, recalcula `description`, `amount`, `type`, `date`,
   `installmentIndex`, `installmentTotal`, `billMonth` e grava **só se algo
   mudou** — a mesma comparação campo a campo que o sync já faz para não
   reescrever linha idêntica.
5. Não chama `processNewTransactions`. Nenhuma sugestão nasce, nenhuma
   notificação é criada.

Devolve `{ examined, updated }` para a UI somar.

**Por que não importa o que falta:** o primeiro sync de uma conexão traz
deliberadamente só o mês corrente, para caber nos 60s. Um reparo que inserisse
tudo que a Pluggy conhece encheria a fila de revisão com centenas de transações
antigas que o usuário nunca pediu — transformaria "consertar o que está errado"
em "importar cinco anos de extrato".

**Por que uma conta por requisição:** o teto do plano Hobby é 60s e o custo de um
extrato completo não tem tamanho conhecido. Uma conta por chamada mantém cada
requisição num tamanho previsível e dá progresso visível.

**Na tela:** um botão "Reparar histórico" por conexão, na Perfil, ao lado de
"Sincronizar". Ele itera as contas daquela conexão no cliente, uma chamada por
vez, mostrando "conta 2 de 4". Ao fim, um toast com o total corrigido, e a lista
de transações recarrega.

## Arquitetura e arquivos

**API**

| Arquivo | Mudança |
|---|---|
| `apps/api/prisma/schema.prisma` | `DEBIT_CARD` no enum; `Account.customType`, `Account.creditCardDueDay`; `Transaction.installmentIndex`, `installmentTotal`, `billMonth` |
| `apps/api/prisma/migrations/<ts>_parcelas_e_tipos_de_conta/migration.sql` | **Novo** — colunas mais os dois `UPDATE` de backfill |
| `apps/api/src/lib/pluggyMapping.ts` | **Novo.** Funções puras: sinal, valor, parcela, `billMonth`, `dueDate`, semente do dia de vencimento |
| `apps/api/src/lib/pluggyMapping.test.ts` | **Novo** |
| `apps/api/src/modules/pluggy/pluggy.service.ts` | Usa o módulo novo; semeia poupança e dia de vencimento no `create`; grava parcela; ganha `repairAccount` |
| `apps/api/src/modules/pluggy/pluggy.routes.ts` | Rota de reparo |
| `apps/api/src/modules/accounts/accounts.service.ts` | `resolveAccountType`; novos campos no DTO; `updateAccount` aceita tipo e dia, e valida a regra do cartão |
| `apps/api/src/modules/accounts/accounts.routes.ts` | zod dos campos novos |
| `apps/api/src/modules/transactions/transactions.service.ts` | `formatTransactionDTO` com parcela e `dueDate`; `include` da conta traz `creditCardDueDay` |

**Compartilhado**

| Arquivo | Mudança |
|---|---|
| `packages/shared/src/index.ts` | `AccountType` como union; `AccountDTO` (`originalType`, `customType`); `TransactionDTO` (`installmentIndex`, `installmentTotal`, `dueDate`); `UpdateAccountRequest` |

**Web**

| Arquivo | Mudança |
|---|---|
| `apps/web/src/lib/accounts.ts` | `DEBIT_CARD` no líquido; rótulos em português dos cinco tipos |
| `apps/web/src/lib/accounts.test.ts` | Casos novos |
| `apps/web/src/lib/api.ts` | `repairAccount` |
| `apps/web/src/components/profile/EditAccountModal.tsx` | Era `RenameAccountModal`: ganha tipo e dia de vencimento |
| `apps/web/src/pages/ProfilePage.tsx` | Selo de tipo na conta; botão "Reparar histórico" com progresso |
| `apps/web/src/pages/TransactionsPage.tsx` | Selo `3/10` nas duas listas |
| `apps/web/src/components/transactions/TransactionDetailModal.tsx` | Linha de parcela e vencimento |

## Testes

Tudo que é regra vira função pura e é testado sem banco, seguindo
`lib/categorization/`.

**`pluggyMapping.test.ts`**

- `DEBIT` com valor positivo → `EXPENSE`
- `DEBIT` com valor negativo → `EXPENSE` (o `type` manda)
- `CREDIT` com valor negativo → `INCOME` — **o caso do estorno, que é o bug**
- `CREDIT` com valor positivo → `INCOME`
- `type` ausente com valor negativo → `EXPENSE`; positivo → `INCOME`
- `amount` é sempre o módulo, e `NaN`/`Infinity` viram zero
- `billForecastDate` presente vence a derivação
- Sem `billForecastDate`: transação em dezembro → `billMonth` de janeiro do ano
  seguinte (a virada de ano)
- `creditCardMetadata` nulo → os três campos nulos
- `installmentNumber` sem `totalInstallments` (e vice-versa) → nada de parcela;
  meia parcela não é parcela
- `dueDate`: dia 10 em mês normal; dia 31 em fevereiro vira 28; em ano bissexto,
  29; `creditCardDueDay` nulo → `dueDate` nulo
- Semente do dia: `balanceDueDate` presente → o dia dela; ausente → 10

**`accounts.test.ts` (web)**

- `DEBIT_CARD` entra em `liquid` e conta em `liquidCount`
- Poupança com `excludedFromBalance` fica fora dos três totais
- Os casos que já existem seguem passando

Rotas, telas e o reparo continuam verificados à mão — é o padrão do projeto,
registrado no `PLAN.md`.

## Riscos

| Risco | Mitigação |
|---|---|
| O reparo estoura os 60s numa conta com histórico muito longo | Uma conta por requisição; se ainda assim estourar, o usuário repete — o reparo é idempotente |
| `billMonth` derivado erra o mês em compra pós-fechamento | Aceito e documentado. `billForecastDate` acerta nos conectores Open Finance; o resto está no Backlog |
| A poupança sumindo do saldo assusta | O olhinho já existe e é o caminho de volta; a mudança é a pedida |
| `DEBIT_CARD` vazar para o sync num refactor futuro | `mapAccountType` nunca o retorna, e há teste dos quatro tipos que ela devolve |
| Backfill afetar outras contas do banco compartilhado | Os dois `UPDATE` são por `type`, não por usuário, e valem para todos — é intencional: são padrões novos do app, não dados de um usuário |

## Backlog (registrado, não planejado)

- **Dia de fechamento da fatura**, de `creditData.balanceCloseDate`, para acertar
  o `billMonth` de compra feita depois do fechamento.
- **Parser de `"PARC 3/12"` na descrição**, fallback para conector que não manda
  `creditCardMetadata` e para lançamento manual. Previsto na Task 2 do plano do
  saldo projetado.
- **Parcela em lançamento manual.** Hoje só o sync preenche os campos.
- **`creditLimit` / `availableCreditLimit`** e o model `CreditCardBill` — Tasks 1
  e 8 do plano do saldo projetado.
- **Agrupar as parcelas de uma mesma compra** numa visão só ("Notebook — 3 de 10
  pagas, faltam R$ 2.100"). Precisa de uma chave de compra que a Pluggy não dá
  pronta.
