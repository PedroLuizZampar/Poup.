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
├── docs/               # Revisões e notas de design
└── PLAN.md
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
10. Sync: resolve o `Item` pelo par `(userId, pluggyItemId)`, importa contas e transações, deduplica por `pluggyTransactionId`
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
    três categorias de sistema (`Category.systemKey`), que não aparecem em
    seletores nem aceitam orçamento
19. Transferência entre contas do próprio usuário detectada por valor + data +
    contas (`src/lib/categorization/transfers.ts`), com as duas pontas fora dos
    relatórios; cobre o caso da poupança, em que as duas pontas têm o mesmo sinal
20. Aplicar categoria em transações parecidas, por similaridade de descrição
    (`GET /transactions/:id/similar`, `POST /transactions/bulk-categorize`)

### Frontend
21. App React + Vite: roteamento e layout base
22. Design system: tokens do protótipo → Tailwind config, com tema claro/escuro
23. Onboarding (por usuário, depois do login)
24. Dashboard
25. Transações + modal de detalhe/categorização
26. Planejamento: abas de orçamentos e metas
27. Relatórios (distribuição por categoria, por período)
28. Categorias (criar, editar, excluir, com gasto do mês)
29. Perfil: conexões Pluggy, credenciais, foto, senha e aparência (claro/escuro)
30. Skeletons de carregamento, estados vazios, toasts e diálogos de confirmação
31. Painel de notificações, com item clicável quando a notificação leva a uma rota
32. Tela de revisão (`/revisao`), uma sugestão por vez, alcançável pela
    notificação e pelo botão "Sugestões" com contador no Dashboard e em
    Transações

### Mobile
33. Barra de navegação inferior abaixo de 768px, com cinco abas e safe area — sem
    ela nenhuma rota era alcançável no celular a não ser digitando a URL
34. Modais, `Select` e painel de notificações viram folhas ancoradas no rodapé no
    toque, e a tabela de transações vira lista de cards
35. Campos a 16px sob `pointer: coarse` (o limiar do zoom automático do Safari),
    alvos de toque de 44px via `.tap-target`, `dvh` no lugar de `vh`
36. Tema segue `prefers-color-scheme` enquanto não houver escolha salva

### PWA
37. `vite-plugin-pwa` com Workbox: precache da casca (HTML, JS, CSS, fontes,
    ícones) e **`NetworkOnly` para `/api/*`** — saldo servido do cache sem aviso
    é pior que tela vazia
38. Manifest, ícones 192/512, um 512 `maskable` e `apple-touch-icon`, gerados a
    partir do `Logo.tsx`
39. Fontes self-hosted (`@fontsource`), só os subsets latinos: sai o
    render-block do CDN do Google e entra fonte precacheável
40. Botão "Instalar o Poup" em Perfil (`beforeinstallprompt`), com as instruções
    manuais do iOS quando não há prompt; banner de versão nova em vez de recarga
    automática
41. Tela de sem conexão honesta, e sessão preservada quando o servidor não
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

- **Teste automatizado só na lib de categorização.** `npm run test --workspace=apps/api`
  cobre normalização, similaridade, pareamento de transferência e o motor de
  palpite. Rotas, pipeline e telas seguem verificados à mão.
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

