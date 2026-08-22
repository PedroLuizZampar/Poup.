# Plano de Desenvolvimento — Poup.

App web de finanças pessoais, instalável como PWA, com categorização de despesas e importação de movimentações via Pluggy (Open Finance). Baseado no protótipo original em HTML.

> **Sobre este documento.** Ele descreve o que **existe**. O que foi planejado e
> não foi feito está em "Backlog", no fim — e não marcado como concluído.
> A revisão de 19/08/2026 (`docs/REVISAO-PROJETO.md`) encontrou cinco itens aqui
> marcados como prontos que não tinham código nenhum; a correção foi mover esses
> itens para o backlog, e é para não repetir isso que a regra está escrita.

## Stack

- **Web:** React + TypeScript + Vite + Tailwind CSS (tokens de cor extraídos do protótipo), instalável como PWA
- **Backend:** Node.js + Express + TypeScript + Prisma ORM
- **Banco:** Neon (PostgreSQL serverless)
- **Integração bancária:** Pluggy (Open Finance) — client SDK oficial
- **Auth:** email e senha, JWT de sessão, senha com bcrypt; cadastro aberto com limite de tentativas por IP
- **Deploy:** origem única — em produção o Express serve o build do `apps/web` e monta a API em `/api`; HTTPS é requisito do service worker

## Estrutura do projeto

```
Poup/
├── apps/
│   ├── api/            # Backend Express + Prisma
│   └── web/            # React + Vite (PWA)
├── packages/
│   └── shared/         # Tipos TS compartilhados entre api e web
└── docs/               # Este plano, revisões, notas de design e o histórico
    ├── PLAN.md         # Este arquivo
    ├── historico/      # Planos de fases já concluídas
    └── superpowers/    # Specs e planos de implementação por feature
```

## O que está pronto

### Fundação
1. Monorepo com npm workspaces (`apps/api`, `apps/web`, `packages/shared`)
2. Prisma + conexão com Neon (`DATABASE_URL`), com singleton e `$disconnect` no encerramento
3. Schema: `User`, `Item`, `Account`, `Category`, `Transaction`, `Budget`, `Goal`, `Notification`
4. Credenciais da Pluggy **por usuário**, cifradas no banco (AES-256-GCM); o `.env` guarda só o que é da instalação
5. Categorias padrão criadas no cadastro
6. Autenticação: cadastro e login com email/senha, JWT, bcrypt

### Backend
7. CRUD de categorias
8. CRUD de transações (filtros por mês/conta/categoria/tipo/busca, edição, categorização, marcar como recorrente)
9. Autenticação Pluggy (troca client id/secret por `apiKey`, cache em memória com renovação — o token expira em ~2h)
10. Sync: resolve o `Item` pelo par `(userId, pluggyItemId)`, importa contas e
    transações, deduplica por `pluggyTransactionId`. **Sempre com data inicial**,
    e nunca "o extrato inteiro": conexão nova traz só o mês corrente — o
    histórico anterior não vem, e não vem depois — e conexão já sincronizada
    volta 30 dias antes da transação mais recente, porque lançamento pendente
    vira efetivado dias depois e muda valor e data. O teto existe porque um
    primeiro sync sem tamanho conhecido é o que estoura o limite de tempo de uma
    função serverless. Escrita em lote (`createMany` e `$transaction`, teto de
    500 em `lib/lotes.ts`): antes era um `upsert` por transação, e com ~50ms de
    latência até o Neon isso é mais de um minuto para mil linhas
11. Motor de palpite de categoria (`apps/api/src/lib/categorization/`): histórico
    do próprio usuário, tabela de palavras-chave e categoria da Pluggy, nessa ordem
12. Nomes de instituição por tabela COMPE + nome do conector (`apps/api/src/lib/institutions.ts`)
13. Orçamentos: gasto por categoria/mês, status (ok/atenção/estourado)
14. Metas: progresso e ritmo mensal necessário, a partir do saldo da conta vinculada
15. Notificações de orçamento no limite e estourado, geradas no `POST /notifications/check`
16. `GET /reports/summary`: totais do período somados no banco (por tipo, por categoria e série mensal)
17. Erros como classes com status próprio + middleware único de tratamento
18. Categorização sugerida: o sync deixa de aplicar categoria e passa a gravar
    sugestões pendentes (`CategorySuggestion`); toda transação nasce numa das
    **duas** categorias de sistema (`Category.systemKey`) — "Transferência entre
    contas" e "Sem categoria" —, que não aparecem em seletores nem aceitam
    orçamento. "Sem categoria" já foi duas, uma por tipo ("Sem categoria
    (despesa)" e "(receita)"), o que não era decisão de ninguém e vazava o nome
    interno em toda tela que lia `category.name` sem passar por
    `displayCategory`. Marcar "Sem categoria" à mão, ou lançar uma transação
    manual sem escolher categoria, **devolve a transação à fila de revisão**
    (`reopenPendingSuggestion`): entra como `NONE` com `guessRejected`, na página
    de escolha manual, para que a reavaliação do próximo lote não devolva o
    palpite que acabou de ser recusado
19. Transferência entre contas do próprio usuário detectada por valor + data +
    contas (`src/lib/categorization/transfers.ts`), com as duas pontas fora dos
    relatórios; cobre o caso da poupança, em que as duas pontas têm o mesmo sinal
20. Aplicar categoria em transações parecidas, por similaridade de descrição
    (`GET /transactions/:id/similar`, `POST /transactions/bulk-categorize`)

### Frontend
21. App React + Vite: roteamento e layout base
22. Design system: tokens do protótipo → Tailwind config, com tema claro/escuro.
    A paleta de categorias tem **16 cores** na ordem do círculo cromático (1
    vermelho → 13 carmim, depois café, sálvia e grafite). Eram 24, e metade não
    passava no teste que importa — duas categorias vizinhas numa lista: o par
    mais próximo estava a ΔE 8,6 (grafite e ardósia, indistinguíveis). Agora o
    mínimo é 14,4. A migração `20260822120000` traduz as chaves gravadas, que
    são posicionais
23. Onboarding (por usuário, depois do login)
24. Dashboard
25. Transações + modal de detalhe/categorização. Os filtros vivem atrás de um
    botão só nos dois tamanhos: folha no rodapé abaixo de `md`, popover ancorado
    ao ícone acima — os mesmos cinco campos (`filterFields`), e os chips de
    filtros ativos como única indicação inline
26. Planejamento: abas de orçamentos e metas
27. Relatórios: **fixas × variáveis** em cima — uma barra dividida e os dois
    totais, "quanto do mês já estava decidido antes de ele começar" — e a
    distribuição por categoria embaixo, agrupada pelos mesmos dois grupos. O
    corte sai da categoria e é derivado na hora da leitura, então reclassificar
    uma categoria corrige o histórico inteiro sem varrer transação por transação
28. Categorias (criar, editar, excluir, com gasto do mês). Cada uma declara se é
    **fixa ou variável** (`Category.kind`), num par de botões nomeados no modal —
    "variável" é uma escolha tão afirmativa quanto "fixa", e um interruptor
    desligado não diz isso. Toda categoria pode ser marcada, inclusive as de
    receita: não há tipo na categoria, então quem decide é o usuário
29. Perfil: conexões Pluggy, credenciais, foto, senha e aparência (claro/escuro).
    Cada conta vinculada tem um olho que a tira dos cards de saldo do Dashboard
    (`Account.excludedFromBalance`) — preferência de exibição, e só: as
    transações dela continuam valendo em relatórios e orçamentos
30. Skeletons de carregamento, estados vazios, toasts e diálogos de confirmação
31. Painel de notificações, com item clicável quando a notificação leva a uma rota
32. Modo discreto: o olho na topbar (nos dois tamanhos — é na rua que ele serve)
    liga `data-privacy` no `<html>`, e uma regra de CSS borra todo valor em
    dinheiro. A marca é o componente `Money`, por onde passa todo valor visível;
    a preferência persiste em `localStorage`
33. Tela de revisão (`/revisao`), **em lote, uma categoria por página**,
    alcançável pela notificação e pelo botão "Sugestões" com contador no
    Dashboard e em Transações. A fila é **toda transação sem categoria**, e não
    só a que o app adivinhou: quem não recebeu palpite entra como
    `CategorySuggestion` de `source = NONE` e `categoryId` nulo. Sem isso, os
    80% que o motor não adivinha em conta nova sumiam do contador, da
    notificação e da tela. Cada página lista as transações sugeridas para uma
    categoria, **todas pré-marcadas**: você desmarca o que não for e confirma —
    o que estava marcado recebe a categoria, o que foi desmarcado vira palpite
    recusado (`guessRejected`) e cai na última página. A cada lote confirmado o
    servidor **reavalia todas as pendentes** com o histórico recém-aprendido
    (`reevaluatePendingSuggestions`), e as páginas são desenhadas de novo — dez
    "IFOOD" categorizados de uma vez ensinam o motor a responder pelas que
    ninguém tinha adivinhado. "Sem categoria definida" é sempre a última página:
    lá nada vem pré-marcado, você escolhe uma categoria e aplica às marcadas, ou
    dispensa as que não quer decidir

### Mobile
34. Barra de navegação inferior abaixo de 768px, com cinco abas e safe area — sem
    ela nenhuma rota era alcançável no celular a não ser digitando a URL
35. Modais, `Select` e painel de notificações viram folhas ancoradas no rodapé no
    toque, e a tabela de transações vira lista de cards
36. Campos a 16px sob `pointer: coarse` (o limiar do zoom automático do Safari),
    alvos de toque de 44px via `.tap-target`, `dvh` no lugar de `vh`
37. Tema segue `prefers-color-scheme` enquanto não houver escolha salva

### PWA
38. `vite-plugin-pwa` com Workbox: precache da casca (HTML, JS, CSS, fontes,
    ícones) e **`NetworkOnly` para `/api/*`** — saldo servido do cache sem aviso
    é pior que tela vazia
39. Manifest, ícones 192/512, um 512 `maskable` e `apple-touch-icon`, gerados a
    partir do `Logo.tsx`
40. Fontes self-hosted (`@fontsource`), só os subsets latinos: sai o
    render-block do CDN do Google e entra fonte precacheável
41. Botão "Instalar o Poup" em Perfil (`beforeinstallprompt`), com as instruções
    manuais do iOS quando não há prompt; banner de versão nova em vez de recarga
    automática
42. Tela de sem conexão honesta, e sessão preservada quando o servidor não
    responde — falha de rede deixou de ser tratada como sessão expirada

## Backlog (planejado, **não** implementado)

Estes itens já apareceram como concluídos neste documento sem existirem no código:

| Item | Situação |
|---|---|
| Modelo `Subscription` | Não existe no `schema.prisma` |
| Sincronização periódica / polling | O sync é sempre manual, pelo botão do painel |
| Detecção automática de recorrência | `isRecurring` é um checkbox manual na transação |
| Assinaturas: total mensal e próximos vencimentos | Sem código |
| Aba de Assinaturas | `PlanningPage` tem duas abas: orçamentos e metas |
| Notificação de fatura próxima | Só há alertas de orçamento |
| Widget Pluggy Connect | Descartado: a conexão é feita colando o id do item do painel da Pluggy |

Outros pendentes conhecidos:

- **Teste automatizado quase só na lib de categorização.**
  `npm run test --workspace=apps/api` cobre normalização, similaridade,
  pareamento de transferência, o motor de palpite e o formato da linha que volta
  para a fila (`reopenPendingSuggestion`);
  `npm run test --workspace=apps/web` cobre `summarizeAccounts`, inclusive as
  contas fora do saldo. Rotas, pipeline e telas seguem verificados à mão.
- **Dois sistemas de ícone** convivem: `Icons.tsx` (feito à mão) e `lucide-react` (usado por `categoryIcons.tsx`).
- **Dinheiro trafega como `number`** nos DTOs. Os agregados já são somados no banco; o que resta é a exibição.

## Deploy

Em produção há **um processo só**: `apps/api` serve o build do `apps/web`
(`express.static` + fallback de SPA) e monta a API em `/api`. Origem única não é
conveniência — o service worker só controla páginas do próprio escopo, e
`start_url`, `scope` e o fallback de navegação todos assumem o mesmo domínio.

```
npm run build     # shared -> api -> web
npm start         # sobe a API, que serve o app junto
```

- `WEB_DIST` (opcional) aponta para outro diretório de build; o padrão é
  `apps/web/dist`, resolvido a partir do `dist` da API.
- **HTTPS é obrigatório.** Service worker e instalação não funcionam em origem
  insegura fora de `localhost`. Qualquer host com TLS automático (Fly.io,
  Render, Railway) resolve; o Neon continua onde está.
- No iOS o PWA só instala pelo Safari, por "Adicionar à Tela de Início" — não há
  prompt programático.

## Credenciais e segredos

Em `apps/api/.env` (fora do controle de versão):

- `DATABASE_URL` (Neon)
- `JWT_SECRET`
- `APP_ENCRYPTION_KEY` — 32 bytes em base64, cifra o client secret da Pluggy no banco
- `CORS_ORIGINS` (opcional) — origens extras aceitas, além da própria origem e do dev server do Vite
- `PORT` (opcional) — `0` deixa o sistema escolher; hosts em nuvem costumam injetar a porta aqui

As credenciais da Pluggy (client id/secret) **não** ficam no ambiente: pertencem ao usuário e são cadastradas pelo app. A `apiKey` é obtida dinamicamente pelo backend e cacheada em memória.

