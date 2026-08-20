# Revisão do Poup Desktop — o que melhorar, refatorar e remover

Revisão de leitura do código em 19/08/2026, cobrindo `apps/api`, `apps/desktop`, `packages/shared`, o schema Prisma e os arquivos de raiz. Lista de trabalho, ordenada por consequência.

Cada item traz o arquivo e a linha onde o problema mora, e o porquê antes do o quê.

> **Status — 19/08/2026.** A lista foi implementada. Ficaram de fora, por decisão
> explícita:
>
> - **1.3, parte final:** os agregados passaram a ser somados no banco (item 2.4),
>   mas os DTOs continuam trafegando `number` em vez de centavos. O erro de ponto
>   flutuante que a revisão previa era real e foi medido: a soma do mês no
>   navegador dava `15605.139999999996` onde o banco dá `15605.14`.
> - **3.3, dois sistemas de ícone:** `Icons.tsx` e `lucide-react` continuam
>   convivendo. Unificar é trabalho de design, não de limpeza.
>
> As referências de linha abaixo são as de antes da correção e não valem mais
> para os arquivos que foram reescritos.
>
> O que mudou de rumo em relação ao que a revisão sugeria:
>
> - **1.4:** o cadastro continua aberto, com limite de 10 tentativas por IP a
>   cada 15 minutos (vale também para o login). Nem "só o primeiro usuário" nem
>   código de convite.
> - **3.4:** o processo `main` do Electron sobe a API como processo filho, em
>   porta escolhida pelo sistema, e informa a URL ao renderer pelo preload.

---

## Prioridade 1 — Corrigir (correção ou segurança)

### 1.1 `POST /pluggy/sync` aceita item de qualquer usuário

[pluggy.routes.ts:77](apps/api/src/modules/pluggy/pluggy.routes.ts#L77) chama `syncItem(req.userId, pluggyItemId)` com o id vindo direto do corpo da requisição, sem conferir se aquele item pertence a quem pediu. Dentro de [syncItem](apps/api/src/modules/pluggy/pluggy.service.ts#L268) o `prisma.item.upsert` usa `where: { pluggyItemId }` — chave única **global** — e as contas são regravadas com o `userId` de quem chamou.

Enquanto o app tinha um usuário só, isso era inofensivo. Agora que qualquer pessoa pode criar conta pela tela de cadastro, um usuário que descubra (ou chute) o item id de outro puxa as contas e o histórico dele para dentro da própria conta. O `addItemById` já faz essa checagem de dono; a rota de sync não.

**Correção:** resolver o item pelo par `(userId, pluggyItemId)` antes de sincronizar, e devolver 404 quando não for do usuário. Vale mudar a assinatura de `syncItem` para receber o `Item` já resolvido, para que nenhum caminho futuro esqueça a checagem.

### 1.2 Saldo total soma fatura de cartão como se fosse dinheiro

[DashboardPage.tsx:147](apps/desktop/src/pages/DashboardPage.tsx#L147) faz `accounts.reduce((sum, a) => sum + a.balance, 0)` sobre **todas** as contas. O sync grava o `balance` cru da Pluggy ([pluggy.service.ts:333](apps/api/src/modules/pluggy/pluggy.service.ts#L333)), e para conta de crédito esse número é o valor da fatura — uma dívida.

Hoje o cartão está zerado e o erro não aparece; com fatura aberta, o "saldo total" fica inflado exatamente pelo valor que você deve.

**Correção:** subtrair contas `CREDIT` do total (ou exibi-las numa linha própria, "Faturas em aberto"). Decidir também o que investimento faz no total — hoje entra junto, o que mistura liquidez com patrimônio.

### 1.3 Dinheiro trafega como `number`

Todo DTO converte `Prisma.Decimal` para `Number` (`accounts.service.ts`, `transactions.service.ts`, `budgets.service.ts`, `goals.service.ts`) e os totais são somados em ponto flutuante no cliente. O banco guarda `Decimal(14,2)` corretamente; a imprecisão nasce só na exibição e nos agregados.

Com poucas centenas de transações o erro fica abaixo do centavo, então isto não é urgente — mas é a origem de "o total não bate com a soma" quando o volume cresce.

**Correção possível:** trafegar centavos (inteiro) no DTO e formatar no cliente, ou somar no banco (`groupBy` + `_sum`) em vez de no navegador. As duas coisas se resolvem juntas com o item 2.4.

### 1.4 CORS aberto e cadastro sem limite

[app.ts:14](apps/api/src/app.ts#L14) usa `cors()` sem opções — qualquer origem. E `POST /auth/register` não tem limite de tentativas nem qualquer barreira.

Numa API que escuta em `localhost` o risco é baixo, mas o app hoje é distribuído como executável: basta a porta 4000 estar aberta na rede para qualquer um criar conta. **Correção:** restringir `origin` ao renderer, e considerar exigir que o registro só funcione quando ainda não há nenhum usuário (ou atrás de um código de convite), já que este é um app de uso pessoal.

### 1.5 Efeito colateral num GET

[notifications.routes.ts:18](apps/api/src/modules/notifications/notifications.routes.ts#L18) roda `generateAutomaticAlerts` — que **escreve** notificações — dentro do `GET /notifications`. Abrir o sininho grava no banco. Já existe o `POST /notifications/check` para isso.

**Correção:** deixar a geração no POST e chamá-lo depois do sync (que é quando os dados realmente mudam).

---

## Prioridade 2 — Refatorar

### 2.1 `pluggy.service.ts` faz coisas demais (496 linhas)

O arquivo mistura quatro responsabilidades: acesso à API da Pluggy, heurística de nomes de banco, auto-categorização e persistência. Três blocos pedem casa própria:

- **`detectAccountInstitution` / `detectItemInstitution` / `formatAccountName`** ([linhas 183–264](apps/api/src/modules/pluggy/pluggy.service.ts#L183)): uma tabela de bancos brasileiros escrita em `if`s encadeados (Inter, Caixa, Nubank, Itaú, Bradesco, Santander, C6, XP), com listas de exceção do tipo `["GOLD","PLATINUM","BLACK"]`. Isso reimplementa o que o conector da Pluggy já informa. Extrair para `lib/institutions.ts` no backend, virar dado (mapa código COMPE → nome) e usar o nome do conector como fonte primária.
- **`findBestCategoryMatch`** ([linha 144](apps/api/src/modules/pluggy/pluggy.service.ts#L144)): ~60 palavras-chave fixas no código. Como o usuário cria as próprias categorias, essas regras envelhecem sozinhas e não são editáveis. Virar um módulo `categorization/rules.ts` — e, se um dia valer, uma tabela `CategoryRule` que a UI edite.
- **Mapeamento de `Item` para `ItemDTO`** aparece três vezes ([24](apps/api/src/modules/pluggy/pluggy.service.ts#L24), [63](apps/api/src/modules/pluggy/pluggy.service.ts#L63), [412](apps/api/src/modules/pluggy/pluggy.service.ts#L412)) com os mesmos nove campos. Um `toItemDTO(item)` elimina as três.

### 2.2 `any` na fronteira com a Pluggy

`detectAccountInstitution(pAccount: any)`, `detectItemInstitution(accounts: any[])`, `formatAccountName(pAccount: any)`. O SDK exporta os tipos (`Account`, `Item`, `Transaction`) — usá-los faz o compilador avisar quando a Pluggy mudar um campo, que é justamente onde este projeto quebra em silêncio.

### 2.3 Repetição no renderer

- **`categoryMap`**: o mesmo `useMemo` que indexa categorias por id existe em cinco arquivos ([DashboardPage:122](apps/desktop/src/pages/DashboardPage.tsx#L122), [ReportsPage:38](apps/desktop/src/pages/ReportsPage.tsx#L38), [TransactionsPage:80](apps/desktop/src/pages/TransactionsPage.tsx#L80), [BudgetsTab:38](apps/desktop/src/components/budgets/BudgetsTab.tsx#L38), [TransactionDetailModal:41](apps/desktop/src/components/transactions/TransactionDetailModal.tsx#L41)). Vira um `useCategories()`.
- **Somas de receita/despesa**: [DashboardPage:132–180](apps/desktop/src/pages/DashboardPage.tsx#L132) tem seis `useMemo` quase idênticos (income/expense × mês atual/anterior/retrasado). Uma função `summarize(transactions)` reduz os seis a três chamadas.
- **Estado de mês**: `getCurrentMonthStr` + offset é remontado em três páginas. Um `useMonthNavigation()` centraliza a navegação e o formato.

### 2.4 O cliente busca demais e calcula demais

- O dashboard faz **oito** requisições em paralelo e baixa três meses inteiros de transações só para somar quatro números.
- [ReportsPage:24](apps/desktop/src/pages/ReportsPage.tsx#L24) chama `fetchTransactions()` **sem filtro** — o histórico inteiro — e filtra por período no navegador. Cresce sem teto.

O backend já tem os índices (`@@index([userId, date])`) para responder isso com `groupBy`. Um endpoint `GET /reports/summary?month=` devolvendo totais por tipo e por categoria substitui as duas coisas e resolve o 1.3 de quebra.

### 2.5 Erros e tratamento repetidos na API

Cada `*.routes.ts` repete o mesmo bloco `if (err instanceof XNotFoundError) return res.status(404)`. Um middleware de erro que mapeie classes para status (as classes já existem e são bem nomeadas) apaga esse boilerplate de sete arquivos. O handler global em [app.ts:31](apps/api/src/app.ts#L31) hoje devolve 500 genérico para tudo que escapa.

Além disso, cada serviço declara sua própria `AccountNotFoundError` / `CategoryNotFoundError` — o mesmo erro definido em três lugares.

### 2.6 Prisma sem `datasourceUrl` nem shutdown

[prisma.ts](apps/api/src/prisma.ts) instancia o client num módulo sem `beforeExit`/`$disconnect` e sem o padrão de singleton para o `tsx watch` — cada recarga do dev server abre um pool novo contra o Neon. Vale o guard `globalThis.prisma`.

### 2.7 Onboarding é global, não do usuário

[App.tsx:22](apps/desktop/src/App.tsx#L22) guarda `poup:onboarding_completed` no `localStorage` e mostra o onboarding **antes** do login. Com cadastro de contas novas, o segundo usuário na mesma máquina nunca vê a apresentação, e quem entra pela primeira vez vê os slides antes de saber o que é o app. Amarrar a flag ao usuário (ou movê-la para depois do login).

---

## Prioridade 3 — Remover

### 3.1 O que o app promete e não existe

[PLAN.md](PLAN.md) marca como **concluídas** funcionalidades que não estão no código:

| Prometido no PLAN.md | Realidade |
|---|---|
| Modelo `Subscription` (fase 1, item 3) | Não existe no `schema.prisma` |
| Sincronização periódica / polling (item 12) | Não existe; sync é sempre manual |
| Detecção automática de recorrência (item 13) | `isRecurring` é só um checkbox manual |
| Assinaturas: total mensal e vencimentos (item 16) | Nenhum código |
| Aba de Assinaturas (item 23) | `PlanningPage` tem duas abas: orçamentos e metas |

Ou o plano é corrigido para refletir o que existe, ou os itens viram backlog explícito. Do jeito que está, o documento mente sobre o próprio projeto — e foi ele que me fez procurar código que não existe.

### 3.2 Peso morto no diretório

- **`apps/desktop/release/` — 274 MB** de saída do `electron-builder` (`win-unpacked` inteiro, com Chromium). Regenerável por `npm run pack:desktop`. É ignorado pelo `.gitignore`, mas ocupa o disco e polui toda busca em arquivos.
- **`DESIGN-CORRECTIONS.MD` — 76 KB** na raiz. Se é histórico, vai para `docs/`; se já foi aplicado, sai.
- **`Protótipo/` — 3 MB.** Já serviu: as telas estão implementadas. Vale manter só se for referência ativa de design.
- `apps/desktop/dist`, `dist-electron` e `packages/shared/dist`: saída de build no meio do código-fonte.

### 3.3 Código morto

- **`preload.ts`** expõe `window.poup.version` — nada no renderer lê. Ou o preload some, ou passa a servir para algo real (ver 3.4).
- **`institutionColor`**: depois da correção das logos, a coluna continua sendo gravada pelo sync e devolvida em `AccountDTO`/`ItemDTO`, mas nenhum componente usa. Remover do DTO (a coluna pode ficar).
- **`ConnectTokenResponse` / `createConnectToken`**: o endpoint existe no backend, o método existe no cliente, e nenhuma tela chama — sobra da ideia do widget Pluggy Connect, que foi descartada em favor do item id manual. Ou some, ou vira o item 3.4.
- **`lucide-react`**: dependência inteira usada só por [categoryIcons.tsx](apps/desktop/src/lib/categoryIcons.tsx) — legítimo, mas note que o projeto tem dois sistemas de ícone (esse e o `Icons.tsx` feito à mão). Vale escolher um.

### 3.4 O executável empacotado não funciona sozinho

`electron-builder` empacota só `dist/**` e `dist-electron/**` ([package.json](apps/desktop/package.json)), e o renderer aponta para `http://localhost:4000` ([api.ts:47](apps/desktop/src/lib/api.ts#L47)). Nada sobe a API. Quem instalar o `.exe` abre uma tela de login que não consegue falar com servidor nenhum.

Isto não é um item de limpeza — é a diferença entre "app desktop" e "front-end que precisa de um terminal aberto ao lado". As saídas razoáveis: o processo `main` do Electron sobe a API como processo filho, ou a API vai para um servidor e o app só aponta para ela. Escolher uma antes de empacotar de novo.

---

## Coisas que não precisam mudar

Vale dizer o que está bem resolvido, para não virar alvo numa próxima varredura:

- **Separação em módulos na API** (`routes` fino, `service` com a regra, erros como classes) — consistente nos oito módulos.
- **Tipos compartilhados** em `packages/shared`: o renderer e a API não divergem de contrato.
- **Design tokens** em `tailwind.config.js` com variáveis CSS por tema — o dark/light sai de graça em componente novo.
- **Precedência de dados do usuário sobre os do sync** (`customName`, `customImageUrl` em colunas próprias): decisão certa, e comentada no schema.
- **`requireAuth` + escopo por `userId`** em todas as queries — com a exceção do 1.1.

---

## Ordem sugerida

1. **1.1** (vazamento entre contas) — é o único item com consequência para terceiros.
2. **3.1** (corrigir o PLAN.md) — barato, e evita decisões erradas baseadas em promessa falsa.
3. **1.2** e **1.5** — erros visíveis para quem usa.
4. **3.4** (empacotamento) — decide a arquitetura antes de qualquer distribuição.
5. **2.1**, **2.3**, **2.4** — a refatoração que reduz o tamanho do código; melhor depois que o resto estabilizou.
6. **1.3**, **2.5**, **2.6**, **2.7**, **3.2**, **3.3** — quando der.

## O que esta revisão não cobriu

Leitura de código apenas: nada foi executado, medido ou testado. Não avaliei acessibilidade tela a tela, comportamento offline, nem o que acontece com a sincronização quando a Pluggy devolve `LOGIN_ERROR` no meio da importação. Também não há teste automatizado nenhum no projeto — o que significa que toda refatoração da lista acima vai ser verificada à mão.
