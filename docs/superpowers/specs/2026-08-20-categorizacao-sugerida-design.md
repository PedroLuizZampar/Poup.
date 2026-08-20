# Categorização sugerida, transferências internas e aplicação em massa

Data: 2026-08-20 · Branch: `feat/mobile-pwa`

## Problema

Hoje a auto-categorização acontece escondida dentro do sync: `pluggy.service.ts`
chama `findBestCategoryMatch` e grava a categoria direto na transação, sem
avisar ninguém. Quem palpita errado não é corrigido — é descoberto meses depois
num relatório torto. E quem não tem palpite deixa a transação com `categoryId`
nulo, um estado que cada consumidor (relatório, orçamento, dashboard, filtro)
trata do seu jeito.

Este documento troca isso por três coisas: um palpite que **sugere e espera**,
um estado em que **toda transação tem categoria**, e um caminho para **aplicar
uma decisão a várias transações parecidas de uma vez**.

## Decisões tomadas

Estas foram acordadas no brainstorming e não são reabertas pelo plano:

1. **Categoria aplicada e categoria sugerida são coisas separadas.** Toda
   transação nova nasce numa categoria oculta de sistema. Se o motor tem um
   palpite, ele grava uma *sugestão* pendente — nunca aplica.
2. **Transferência entre contas suas: as duas pontas** vão para a oculta
   `TRANSFER`, que fica fora de relatórios, dashboard e orçamentos. Não gera
   sugestão.
3. **Pareamento conservador:** mesmo valor absoluto, contas diferentes do mesmo
   usuário, janela de 3 dias. Mesmo sinal só é aceito quando uma das contas é
   `SAVINGS`/`INVESTMENT` — o caso da poupança, onde depositar 100 aparece como
   −100 nas duas pontas.
4. **O palpite vem do histórico primeiro**, das regras fixas depois, da
   categoria da Pluggy por último.
5. **Painel de revisão em rota própria**, uma transação por vez, alcançável pela
   notificação e por um botão "Sugestões" com contador.
6. **Botão "Sugestões" no Dashboard e em Transações**, na linha do título, à
   direita, acima dos filtros.
7. **Aplicar em parecidas:** as sem categoria vêm pré-marcadas; as que já têm
   outra categoria aparecem numa seção separada, **desmarcadas**, mostrando a
   categoria atual.
8. **Categorias de sistema são linhas reais** em `Category` (abordagem A), não
   sintéticas.

## Modelo de dados

### `Category` ganha `systemKey`

```prisma
enum SystemCategoryKey {
  TRANSFER
  UNCATEGORIZED_EXPENSE
  UNCATEGORIZED_INCOME
}

model Category {
  // ...campos atuais
  /// Marca as categorias que o app cria e mantém. Não aparecem em seletores,
  /// não podem ser renomeadas nem excluídas, e não aceitam orçamento.
  systemKey SystemCategoryKey?

  @@unique([userId, systemKey])
}
```

Não existe `isSystem`: "é de sistema" é `systemKey != null`. Um campo derivável
do outro é um campo que uma hora discorda do outro.

Nomes e aparência das três, criadas junto com as categorias padrão em
`defaultCategories.ts`:

| `systemKey` | Nome | Ícone | `colorKey` |
|---|---|---|---|
| `TRANSFER` | Transferência entre contas | `repeat` | `5` |
| `UNCATEGORIZED_EXPENSE` | Sem categoria (despesa) | `dots` | `5` |
| `UNCATEGORIZED_INCOME` | Sem categoria (receita) | `dots` | `5` |

### `Transaction` ganha `transferPairId`

```prisma
model Transaction {
  // ...campos atuais
  /// Une as duas pontas de uma transferência interna detectada. Existe para
  /// que o pareamento seja idempotente e para que desfazer numa ponta saiba
  /// qual é a outra.
  transferPairId String?
  suggestion     CategorySuggestion?

  @@index([transferPairId])
}
```

`categoryId` **continua nullable no banco**. Torná-lo obrigatório quebraria o
`onDelete: SetNull` da relação com `Category`. A invariante "nenhuma transação
fica sem categoria" passa a ser mantida pela camada de serviço (ver
[Excluir categoria](#excluir-categoria)), e o DTO tem um fallback caso ela
escape.

### `CategorySuggestion`

```prisma
enum SuggestionSource { HISTORY RULE PLUGGY }
enum SuggestionStatus { PENDING ACCEPTED CHANGED DISMISSED }

model CategorySuggestion {
  id                 String           @id @default(uuid())
  userId             String
  transactionId      String           @unique
  categoryId         String
  source             SuggestionSource
  /// 0..1. Para HISTORY é a fração do histórico daquele comerciante que caiu
  /// nessa categoria; para RULE e PLUGGY é um valor fixo.
  confidence         Float
  status             SuggestionStatus @default(PENDING)
  /// A categoria que o usuário de fato escolheu, quando trocou a sugerida.
  resolvedCategoryId String?
  resolvedAt         DateTime?
  createdAt          DateTime         @default(now())

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  transaction Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  category    Category    @relation("SuggestedCategory", fields: [categoryId], references: [id], onDelete: Cascade)

  @@index([userId, status])
}
```

As relações inversas exigidas pelo Prisma: `User.categorySuggestions
CategorySuggestion[]` e `Category.suggestions CategorySuggestion[]
@relation("SuggestedCategory")`.

Uma sugestão por transação (`transactionId @unique`). As resolvidas ficam: são o
registro de quando o palpite acertou, e o dia que houver ajuste de heurística é
por elas que se mede.

O `@unique` também dá a idempotência de graça: uma transação que você **pulou**
(`DISMISSED`) já tem linha, então o pipeline de um sync seguinte não volta a
sugerir para ela. Pular é definitivo até você abrir a transação e categorizar à
mão.

### `Notification` ganha `link`

```prisma
model Notification {
  // ...campos atuais
  /// Rota do app para onde o item leva quando tocado. Null = item informativo.
  link String?
}
```

### Migração

Uma migração `20260820120000_categorizacao_sugerida`, nesta ordem:

1. Cria os enums, as colunas novas e a tabela `CategorySuggestion`.
2. Para cada usuário, garante as três categorias de sistema. **Colisão de
   nome:** se o usuário já tem uma categoria chamada "Transferência entre
   contas", o `@@unique([userId, name])` impediria o insert — a migração então
   **adota** a linha existente, marcando o `systemKey` nela em vez de criar
   outra. Ninguém perde histórico.
3. Backfill: `Transaction` com `categoryId IS NULL` recebe
   `UNCATEGORIZED_EXPENSE` ou `UNCATEGORIZED_INCOME` conforme o `type`.
4. Nenhuma sugestão é gerada retroativamente. A fila começa vazia e enche no
   próximo sync — o painel não pode nascer com 800 itens.

## Detecção de transferência interna

`apps/api/src/lib/categorization/transfers.ts`, função pura sobre os dados já
carregados, sem acesso ao banco.

```
pareia(candidata, universo):
  descarta se candidata.transferPairId != null
  contrapartes = universo onde:
    id != candidata.id
    accountId != candidata.accountId
    transferPairId == null
    abs(amount) == abs(candidata.amount)        // igualdade decimal exata
    |dias entre as datas| <= 3
    e a regra de sinal:
      tipos opostos (EXPENSE + INCOME) -> sempre vale
      tipos iguais -> só se account.type de alguma das duas
                      for SAVINGS ou INVESTMENT
  0 contrapartes -> não é transferência
  1 contraparte  -> pareia
  N contrapartes -> a de menor distância de data; empate -> não pareia
```

O empate não pareia de propósito: duas candidatas equidistantes significa que a
informação disponível não decide, e marcar errado aqui é o único caminho do
sistema que muda uma categoria sem passar por você.

O universo consultado são as transações do usuário na janela de datas relevante
— não só as recém-importadas, porque a outra ponta pode ter entrado num sync
anterior. O índice `@@index([userId, date])` já existente serve a consulta.

**Desfazer.** Uma transação em `TRANSFER` não é imutável: a *categoria* é que
não pode ser renomeada ou excluída. Se você recategorizar uma das pontas pela
tela de detalhe, o `transferPairId` é limpo nas duas, e a outra ponta volta para
a fila como "sem categoria" com sugestão recalculada.

## Motor de sugestão

Três arquivos novos em `apps/api/src/lib/categorization/`, todos puros e
testáveis sem banco. `rules.ts` continua como está.

### `normalize.ts`

- `normalizeDescription(s)`: minúsculas, remove acentos (NFD + faixa
  diacrítica), remove parcelamento (`parc 03/12`), datas embutidas, sequências
  de 3+ dígitos, `*`, `#`, hifens soltos, e uma stoplist curta (`compra`,
  `cartao`, `debito`, `credito`, `pagamento`); colapsa espaços.
- `merchantKey(s)`: os até 3 primeiros tokens da forma normalizada, unidos por
  espaço. Chave vazia ou com menos de 3 caracteres é descartada — é ruído, não
  comerciante.

### `similarity.ts`

- `similarityScore(a, b)`: coeficiente de Dice sobre os conjuntos de tokens
  normalizados. `merchantKey` idêntico devolve `1`.
- `SIMILARITY_THRESHOLD = 0.6`.

### `engine.ts`

- `buildHistoryIndex(transactions)`: das transações já categorizadas em
  categoria **não** de sistema, monta `merchantKey -> Map<categoryId, contagem>`.
- `suggestCategory(tx, ctx)`, nesta ordem:
  1. **HISTORY** — `merchantKey` da descrição bate no índice. Categoria = a mais
     frequente; `confidence` = frequência dela sobre o total daquela chave.
  2. **RULE** — tabela de `rules.ts`, casando `targetName` com uma categoria não
     de sistema do usuário. `confidence` fixa `0.5`.
  3. **PLUGGY** — nome da categoria vinda da Pluggy contra os nomes das
     categorias do usuário. `confidence` fixa `0.35`.
  4. `null`.

Custo: o índice é construído **uma vez por execução do pipeline**, não por
transação. Para o caminho de sync, só a busca por `merchantKey` exato é usada —
é O(1) por transação. A varredura completa por Dice fica reservada ao endpoint
de "parecidas", que roda para uma transação de cada vez.

## Pipeline pós-importação

Módulo novo `apps/api/src/modules/categorization/`:

```
processNewTransactions(userId, transactionIds)
  1. carrega as transações e as contas envolvidas
  2. detecta pares -> as duas pontas recebem TRANSFER + transferPairId
  3. as demais recebem UNCATEGORIZED_EXPENSE / UNCATEGORIZED_INCOME
  4. constrói o índice de histórico e gera sugestões PENDING para as demais
  5. devolve { transferencias, sugeridas, semPalpite }
```

`pluggy.service.ts` muda em dois pontos: antes do laço de upsert, consulta quais
`pluggyTransactionId` já existem, para saber quais linhas são de fato novas; e
o `create` deixa de chamar `findBestCategoryMatch` — a categoria passa a ser
responsabilidade do pipeline, chamado uma vez no fim do sync com os ids novos.

Transação criada à mão sem categoria também passa pelo pipeline: recebe a
oculta correspondente e ganha sugestão, entrando na mesma fila.

## Notificação

Ao fim do sync, se o pipeline gerou sugestões, uma notificação:

- título `N transações para revisar`
- corpo com quantas vieram com palpite e quantas ficaram sem
- `severity: INFO`, `link: "/revisao"`

**Uma por lote, não uma por transação** — uma importação de 200 lançamentos não
pode gerar 200 linhas no sininho. Se já existe uma notificação não lida com
`link = "/revisao"`, ela é **atualizada** (novo total, `createdAt` renovado) em
vez de duplicada.

O `NotificationDrawer` passa a renderizar itens com `link` como clicáveis:
tocar marca como lida, fecha o painel e navega.

## API

Rotas novas em `/api/suggestions` (`suggestions.routes.ts`, atrás de
`requireAuth` como as demais):

| Método | Rota | Corpo | Devolve |
|---|---|---|---|
| `GET` | `/suggestions` | — | `{ suggestions: SuggestionDTO[], count }` |
| `GET` | `/suggestions/count` | — | `{ count }` |
| `POST` | `/suggestions/:id/accept` | `{ categoryId? }` | `{ transaction, remaining }` |
| `POST` | `/suggestions/:id/dismiss` | — | `{ remaining }` |

`accept` sem `categoryId` aplica a sugerida e marca `ACCEPTED`; com `categoryId`
aplica a escolhida e marca `CHANGED`, gravando `resolvedCategoryId`. `dismiss`
marca `DISMISSED` e deixa a transação na oculta.

Em `/api/transactions`:

| Método | Rota | Corpo | Devolve |
|---|---|---|---|
| `GET` | `/transactions/:id/similar?categoryId=` | — | `{ uncategorized: [], differentCategory: [] }` |
| `POST` | `/transactions/bulk-categorize` | `{ transactionIds, categoryId }` | `{ updated }` |

`similar` exclui transações em `TRANSFER`, exclui a própria, e ordena por score
decrescente. `differentCategory` traz o nome da categoria atual de cada item.
O universo varrido é limitado — **24 meses** de histórico e teto de **500**
candidatas por chamada — porque este é o único caminho que faz comparação
par a par em vez de consulta por chave; sem teto ele degrada junto com o
tamanho do histórico. Cada seção devolve no máximo 50 itens.
`bulk-categorize` valida que todos os ids são do usuário e que a categoria não é
de sistema; resolve as sugestões pendentes das transações afetadas como
`ACCEPTED`/`CHANGED`.

### DTOs (`packages/shared/src/index.ts`)

```ts
export type SystemCategoryKey =
  | "TRANSFER" | "UNCATEGORIZED_EXPENSE" | "UNCATEGORIZED_INCOME";

export interface CategoryDTO {
  // ...campos atuais
  systemKey: SystemCategoryKey | null;
}

export interface SuggestionDTO {
  id: string;
  transaction: TransactionDTO;
  suggestedCategoryId: string;
  suggestedCategoryName: string;
  source: "HISTORY" | "RULE" | "PLUGGY";
  confidence: number;
}

export interface SimilarTransactionDTO extends TransactionDTO {
  score: number;
  /** Preenchido só na seção de categoria divergente. */
  currentCategoryName?: string | null;
}

export interface NotificationDTO {
  // ...campos atuais
  link: string | null;
}
```

## Frontend

### Tela de revisão — `/revisao`

`apps/web/src/pages/ReviewPage.tsx`, rota nova dentro do `AppLayout`.

Um card por vez, contador "3 de 8". O card mostra descrição, valor, conta e data
da transação, e a categoria sugerida em destaque com a origem em texto miúdo
("porque você categorizou 4 transações parecidas assim"). Três ações:

- **Aprovar** — aplica a sugerida e avança.
- **Trocar categoria** — abre o `CategorySelectModal` já existente (sem as de
  sistema), aplica a escolhida e avança.
- **Pular** — `dismiss`, avança.

Ao trocar de categoria, o card seguinte ganha uma faixa discreta no topo:
"Aplicar *Restaurante* a outras 4 parecidas?", que abre o modal de parecidas sob
demanda. É a única forma do fluxo de parecidas aparecer dentro da fila —
abri-lo a cada aprovação transformaria oito toques em dezesseis.

Fila vazia: estado vazio com `EmptyState`, sem card.

### Botão "Sugestões"

`apps/web/src/components/suggestions/SuggestionsButton.tsx` — botão com rótulo e
bolinha de contagem, navegando para `/revisao`. Colocado na linha do título, à
direita, no `DashboardPage` e no `TransactionsPage` (acima do bloco de filtros).
Não renderiza nada quando a contagem é zero.

A contagem vem de `useSuggestionsCount()`
(`apps/web/src/hooks/useSuggestionsCount.ts`), que busca `/suggestions/count` na
montagem e expõe `refresh()` para depois de um sync ou de uma aprovação.

A contagem é de **sugestões pendentes**, não de transações sem categoria. Uma
transação que o motor não soube palpitar fica na oculta e aparece no filtro
"sem categoria" da tela de Transações, mas não entra na fila — a fila é de
decisões que o app propôs, e um card em branco não é uma proposta.

### Modal de parecidas

`apps/web/src/components/transactions/SimilarTransactionsModal.tsx`. Abre depois
que você categoriza uma transação à mão pelo `TransactionDetailModal` — a
categoria daquela transação **já foi salva** quando o modal aparece; ele trata
apenas das outras.

Duas seções, ambas com checkbox por linha:

1. **Sem categoria** — todas pré-marcadas.
2. **Já categorizadas de outro jeito** — todas desmarcadas, cada linha mostrando
   "hoje em *Lazer*".

Rodapé com "Aplicar em N" e "Agora não". Se as duas listas voltarem vazias, o
modal não chega a abrir.

### Categorias de sistema na interface

- `useCategories` passa a devolver `categories` **sem** as de sistema (é o que
  todo seletor quer) e mantém `categoryMap` **com** todas — a lista de
  transações precisa saber desenhar o chip "Transferência entre contas".
- `CategoriesPage` não lista as de sistema; `CategoryFormModal` não as edita.
- O seletor de categoria do orçamento também as omite.

## Impacto no que já existe

### Relatórios

`expensesByCategory` e `totalsByType` passam a excluir as transações cuja
categoria tem `systemKey = TRANSFER`. Sem isso, cada transferência interna
apareceria como despesa e como receita do mesmo mês.

As duas ocultas de "sem categoria" **continuam** aparecendo na distribuição por
categoria: ver quanto do mês está sem classificar é informação, não ruído.

`uncategorizedCount` deixa de contar `categoryId: null` e passa a contar as duas
ocultas de "sem categoria".

### Orçamentos

`upsertBudget` recusa categoria com `systemKey` (`400`). Nenhuma outra mudança:
como transferência nunca está numa categoria com orçamento, o cálculo de gasto
já fica correto por consequência.

### Filtros de transação

`filters.uncategorized` deixa de significar `categoryId IS NULL` e passa a
significar "está numa das duas ocultas de sem categoria". A query string da web
não muda.

### Excluir categoria

`deleteCategory` passa a rodar em transação: primeiro reatribui as transações
daquela categoria para a oculta correspondente ao `type` de cada uma, depois
apaga. Sem isso o `onDelete: SetNull` reintroduziria justamente o estado nulo
que este trabalho elimina. Excluir uma categoria de sistema é `400`.

## Testes

O repositório não tem teste automatizado nenhum — este trabalho traz o primeiro,
porque a parte que mais dói errar aqui é justamente a que é fácil de testar:
função pura, sem banco, sem rede.

`vitest` em `apps/api`, cobrindo só `src/lib/categorization/**`:

- `normalize`: acento, parcelamento, dígitos, stoplist, `merchantKey` curto demais.
- `similarity`: idênticas, disjuntas, `merchantKey` igual com sufixos diferentes.
- `transfers`: par de sinais opostos; par de mesmo sinal com poupança (o caso
  −100/−100); mesmo sinal **sem** poupança não pareia; fora da janela de 3 dias
  não pareia; duas contrapartes equidistantes não pareiam; já pareada é ignorada.
- `engine`: histórico vence regra, regra vence Pluggy, `confidence` do histórico,
  categoria de sistema nunca é sugerida.

O resto (rotas, pipeline, telas) segue verificado à mão, como o resto do
projeto.

## Fora de escopo

- Regras de categorização editáveis pelo usuário — cabe depois, sem refazer nada.
- Transferência em que só uma das contas está conectada.
- Reprocessar o histórico existente para gerar sugestões retroativas.
- Detecção de recorrência (continua no backlog do `PLAN.md`).
- Aprender a cada categorização isolada: o índice de histórico é reconstruído a
  cada execução do pipeline, o que basta.
