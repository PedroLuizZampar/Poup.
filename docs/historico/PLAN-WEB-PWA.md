# Da janela ao bolso — remover o Electron e virar PWA

Plano de trabalho para tirar o Electron do caminho, deixar o app inteiro correto
no celular e só então instalá-lo como PWA. Escrito em 20/08/2026, depois de uma
varredura de `apps/desktop/src` inteiro (84 arquivos, ~7.900 linhas de UI).

A ordem importa e não é arbitrária: **um app que ainda não funciona no celular
não deve ser instalável no celular.** Um PWA promete "isto é um app"; entregar
uma tela sem navegação atrás de um ícone na home screen é pior do que entregar
um site que o usuário sabe que é um site. Por isso o PWA é a última fase, não a
primeira.

> Decisões já tomadas com o dono do projeto: mesma origem (Express serve o build
> e a API), bottom tab bar no mobile, offline só de app shell, e o Electron sai
> por completo — `git init` depois da remoção, antes do trabalho de PWA.

---

## Parte 1 — Auditoria

### Placar

| # | Dimensão | Nota | Achado principal |
|---|----------|:----:|------------------|
| 1 | Acessibilidade | 3 | Alvos de toque de 28–36px em telas inteiras; `prefers-reduced-motion` mata toda transição em vez de encurtá-la |
| 2 | Performance | 3 | Fontes do CDN do Google bloqueiam o primeiro paint; nenhuma rota é code-split |
| 3 | **Responsivo** | **1** | **Não existe navegação abaixo de 768px** — as rotas só são alcançáveis digitando a URL |
| 4 | Tematização | 4 | Sistema de tokens completo, claro/escuro consistente, quase nenhuma cor solta |
| 5 | Integridade de implementação | 4 | Código coerente e específico do produto; o detector achou 3 avisos, todos cosméticos |
| **Total** | | **15/20** | **Bom — a fraqueza está concentrada numa dimensão só** |

### Veredito de integridade — passa

Isto não é uma UI genérica. Os tokens de cor, raio, sombra, tipografia e motion
estão em `index.css` + `tailwind.config.js` e são realmente usados; o anel de
foco é próprio e pensado (o comentário em `index.css:200` explica por que
`outline` e não `box-shadow`); os componentes de `ui/` têm variantes coerentes;
e os comentários do código explicam o *porquê* antes do *o quê*, o que é raro.

A dívida mobile não vem de desleixo — vem de o app ter sido desenhado para uma
janela de 1440×900 com mouse, que é exatamente o que `electron/main.ts:19-23`
declara. Nada aqui precisa ser redesenhado. Precisa ser **adaptado**.

O detector automático apontou:

- `index.css:291` e `index.html:9` — Inter é uma fonte saturada. **Falso
  positivo no contexto:** ela é a fonte de texto, pareada com Manrope no
  display, e a dupla é a identidade herdada do protótipo. Fica.
- `index.css:89` — `--ease-spring: cubic-bezier(.34, 1.4, .64, 1)` é easing
  elástico. **Procede em parte:** o token existe, mas `grep` não acha um único
  uso. É token morto, não uma decisão de motion. Remover.

### Achados por severidade

#### P0 — Bloqueia a tarefa

**1. Não há como navegar no celular.**
`components/layout/AppLayout.tsx:66` — `<nav className="hidden md:flex">`. Abaixo
de 768px a barra desaparece e **nada** a substitui: nem hamburger, nem tabs, nem
drawer. Restam o logo (que leva a `/`) e o avatar (cujo dropdown só oferece
Perfil e Sair). Transações, Categorias, Planejamento e Relatórios ficam
inalcançáveis — só editando o hash na barra de endereço. Este é o defeito que
você notou, e é o único P0 da lista.

#### P1 — Corrigir antes de publicar

**2. Todo campo de formulário provoca zoom no iOS.**
O Safari dá zoom automático ao focar qualquer input com fonte menor que 16px, e
não volta sozinho. Todos os campos do app estão em 12px ou 14px:
`ui/Input.tsx:24-26`, `ui/CurrencyInput.tsx:44-45`, `ui/Textarea.tsx:13`,
`pages/TransactionsPage.tsx:151`, `components/categories/IconPicker.tsx:82`.
Efeito prático: tocar na busca de transações joga o layout para fora da tela.

**3. O toast sai da viewport pela esquerda.**
`ui/Toast.tsx:77` — `fixed bottom-5 right-5 max-w-sm w-full`. Em 360px de
largura o `w-full` dá 360px de caixa deslocada 20px da direita: 20px ficam fora
da tela. Além disso ele vai colidir de frente com a bottom bar da Fase 2.

**4. O painel de notificações também sai da tela.**
`components/notifications/NotificationDrawer.tsx:97` — `absolute top-12 right-0
w-80`, ancorado no sino. Só que o sino não é o último item do header: o avatar
vem depois. Em 360px a borda esquerda do painel cai em ≈ -40px.

**5. A tabela de transações vira rolagem horizontal.**
`pages/TransactionsPage.tsx:315-390` — cinco colunas com `px-6` de cada lado
dentro de um `overflow-x-auto`. Largura mínima real ≈ 700px. No celular o
usuário rola um card lateralmente dentro de uma página que rola verticalmente,
que é a interação que mais confunde no mobile. Tabela financeira no celular deve
virar lista de cards, não tabela espremida.

**6. Alvos de toque abaixo de 44px em telas inteiras.**
`pages/CategoriesPage.tsx:335` e `:348` — botões de editar/excluir de **28px**
(`w-7 h-7`), colados um no outro, dentro de um card que também é clicável.
`ui/Button.tsx:32` — o tamanho `sm` tem 36px e é o tamanho usado em toda a
`ProfilePage` (7 ocorrências) e nas abas de orçamento/metas.
`pages/ProfilePage.tsx:404` — ícone de renomear conta sem área própria.

**7. `100vh` não é confiável em navegador mobile.**
A barra de endereço entra e sai e leva o `vh` junto. `ui/Modal.tsx:132`
(`max-h-[90vh]`) corta o rodapé do modal; `min-h-screen` em `App.tsx:67`,
`AppLayout.tsx:53`, `LoginPage.tsx:36`, `SignupPage.tsx:110`,
`OnboardingPage.tsx:60` gera um salto de layout ao rolar.

**8. Nenhum tratamento de safe area.**
`index.html:5` não tem `viewport-fit=cover`, e não há um único
`env(safe-area-inset-*)` no projeto. Hoje isso só deixa margem branca; com a
bottom bar da Fase 2 vira requisito — sem ela a barra fica embaixo do indicador
de home do iPhone.

**9. Modais centralizados brigam com o teclado virtual.**
`ui/Modal.tsx:116` centraliza com `items-center` e `p-4`. Ao abrir o teclado, o
campo em foco some atrás dele. Os modais deste app são todos formulários
(`CategoryFormModal`, `EditProfileModal`, `PluggyCredentialsModal`,
`TransactionDetailModal`…), então isso atinge quase todo fluxo de escrita.

**10. O `Select` abre sempre para baixo, sem flip.**
`ui/Select.tsx:236` — `absolute mt-1 max-h-64`. Um select no rodapé da tela abre
a lista fora da área visível. No mobile, com listas longas (categorias, contas),
é o caso comum e não a exceção.

#### P2 — Corrigir no mesmo ciclo

**11. Filtros de largura fixa dentro de container que empilha.**
`pages/TransactionsPage.tsx:166,175,188` — `w-52`, `w-44`, `w-56` num pai que
vira `flex-col items-center` no mobile: três caixas de larguras diferentes,
centralizadas, sem alinhamento entre si. Mesmo padrão em `ReportsPage.tsx:92`
(`w-52`) e `CategoriesPage.tsx:250` (`w-48`, ao lado de um texto, sem `wrap`).

**12. Grades de 3 colunas apertadas na faixa 640–768px.**
`ReportsPage.tsx:104,110`, `CategoriesPage.tsx:213`,
`dashboard/MonthSummaryPanel.tsx:99` — `sm:grid-cols-3` coloca três valores em
`text-num-xl` (28px, extrabold) em ≈200px cada, com `p-6` de padding. Valores em
reais com milhar quebram ou encostam nas bordas. `sm:grid-cols-2` até `lg` é o
comportamento certo para número grande.

**13. Respiro lateral fixo em telas estreitas.**
`AppLayout.tsx:177` — `px-6 md:px-12`. Em 360px sobram 312px úteis para cards
que já usam `p-6` internamente: 264px de conteúdo real.

**14. Afordância que só existe no hover.**
`pages/ProfilePage.tsx:316` — trocar a imagem do banco é `opacity-0
group-hover:opacity-100`. Em tela de toque não há hover: o recurso fica
invisível e indescobrível. O mesmo vale, em menor grau, para os 22 arquivos que
usam `title=` como única explicação de um botão de ícone.

**15. Alvo clicável dentro de alvo clicável.**
`pages/CategoriesPage.tsx:311` — o card inteiro tem `onClick`, e dentro dele há
dois botões de 28px com `stopPropagation`. No mouse funciona; no dedo, a chance
de abrir o modal errado é alta.

**16. O tema ignora a preferência do sistema.**
`context/ThemeContext.tsx:15-18` — o padrão é `"light"` fixo, sem consultar
`prefers-color-scheme`. Num app instalado na home screen, abrir sempre em claro
num celular em modo escuro é um desencontro visível. E o controle de tema mora
**só** no header (`AppLayout.tsx:96`) — que é justamente o que encolhe no
mobile. De passagem: o `PLAN.md`, item 26, lista "aparência" como pronto na
página de Perfil. Não existe — `grep -n theme pages/ProfilePage.tsx` volta
vazio. É mais um caso da regra que o próprio `PLAN.md` documenta no topo.

#### P3 — Quando sobrar tempo

**17.** `--ease-spring` (`index.css:89`) definido e nunca usado. Remover.

**18.** `index.css:145-152` mata toda animação com `0.01ms !important` sob
`prefers-reduced-motion`. A intenção é boa, o efeito é grosso: quem pede menos
movimento perde também o feedback de mudança de estado. Encurtar a duração e
trocar translação por fade preserva a informação.

**19.** `index.html:8-12` carrega Manrope e Inter do CDN do Google de forma
render-blocking. Em 4G isso é um flash de texto invisível; num PWA offline, é
fonte que não carrega nunca.

**20.** Dois sistemas de ícone (`Icons.tsx` e `lucide-react`) — já conhecido e
registrado no `PLAN.md`.

### O que está bom e deve ser preservado

- **O sistema de tokens.** `index.css` + `tailwind.config.js` cobrem superfície,
  texto, marca, semântica, 24 pares de categoria, elevação e motion, nos dois
  temas. É a razão de o trabalho abaixo ser barato: quase nada precisa de cor
  nova.
- **O foco de teclado.** Anel próprio, ancorado no raio do elemento, com
  `:focus-visible` para não acender no clique. Melhor que a média larga.
- **ARIA de verdade.** `Select` implementa `combobox`/`listbox` com
  `aria-activedescendant` e type-ahead; `Modal` tem focus trap, restauração de
  foco e `aria-modal`; o gráfico tem `aria-label` descritivo por mês.
- **O renderer não conhece o Electron.** `grep -rn "window.electron\|ipcRenderer"`
  volta vazio. A única ponte é `window.poup?.apiBaseUrl` em `lib/api.ts:66`. É
  por isso que a Fase 0 é uma tarde de trabalho e não uma refatoração.

---

## Parte 2 — O plano

### Fase 0 — Remover o Electron e iniciar o git

Sem dependência com o resto. Pode ir sozinha.

1. **Apagar** `apps/desktop/electron/`, `apps/desktop/dist-electron/`,
   `apps/desktop/dist-api/`, `apps/desktop/scripts/build-api.mjs`.
2. **`apps/desktop/package.json`**: remover a chave `main`, o bloco `build`
   inteiro (electron-builder), as devDeps `electron`, `electron-builder` e
   `esbuild`, e os scripts `electron:dev`, `electron:pack`, `build:api`. O
   script `build` vira `tsc -p tsconfig.json && vite build`.
3. **`package.json` da raiz**: remover `dev:electron` e `pack:desktop`; renomear
   `dev:desktop` → `dev:web` e o alvo do workspace.
4. **`src/lib/api.ts`**: apagar o bloco `declare global { Window.poup }`
   (linhas 47-52) e o primeiro ramo de `resolveApiUrl()` (linha 66), junto com
   o comentário que o explica. Sobram dois caminhos: proxy `/api` sob http, e
   `http://localhost:4000` de fallback.
5. **Renomear `apps/desktop` → `apps/web`** e o pacote para `@poup/web`. O
   workspace já é `apps/*`, então nada mais muda. Vale o incômodo: o nome da
   pasta é a primeira coisa que qualquer pessoa lê sobre a arquitetura, e
   "desktop" passou a ser mentira.
6. **`PLAN.md`**: reescrever a linha de stack (sai Electron) e substituir a
   seção "Empacotamento" pela de deploy web. Mover os itens 29 e 30 para fora
   de "O que está pronto" — eles deixaram de existir.
7. **`git init`**, `.gitignore` revisado (`dist/`, `dist-api/`, `release/`,
   `node_modules/`, `.env`), e primeiro commit com o estado limpo.

*Verificação:* `npm run dev` sobe API + Vite; o app abre em
`http://localhost:5173` e faz login. `grep -rn "electron" --include=*.ts
--include=*.tsx --include=*.json apps packages` volta vazio.

### Fase 1 — Fundação mobile

Mudanças em tokens e primitivas. Nenhuma tela é tocada, e todas melhoram junto.
É a fase com melhor relação esforço/resultado do plano.

1. **`index.html`**: `viewport-fit=cover` no viewport; `<meta name="theme-color">`
   em dois pares com `media="(prefers-color-scheme: …)"`, casando com `--bg`.
2. **`index.css`**: variáveis de altura de chrome (`--header-h`, `--nav-h`) e
   uma regra única que resolve o zoom do iOS de uma vez, sem editar oito
   arquivos:
   ```css
   @media (pointer: coarse) {
     input, select, textarea { font-size: 16px; }
   }
   ```
   O tamanho visual dos campos no desktop fica intacto; só o toque muda.
3. **Alvos de toque.** Em `@media (pointer: coarse)`, elevar `h-ctl-sm` para
   44px e criar um utilitário `.tap-target` que expande a área com um `::after`
   de `inset: -8px` — assim os ícones de 28px de `CategoriesPage` continuam com
   28px de desenho e ganham 44px de alvo, sem redesenhar o card.
4. **Unidades de viewport**: `min-h-screen` → `min-h-dvh` (5 arquivos),
   `max-h-[90vh]` → `max-h-[90dvh]` em `Modal.tsx:132`.
5. **Movimento reduzido**: trocar o `0.01ms !important` global por durações de
   `--dur-instant` e supressão apenas de `transform`, preservando `opacity`.
6. **Tema**: `ThemeContext` passa a ler `prefers-color-scheme` quando não há
   nada em `localStorage`, e a sincronizar a meta `theme-color`.

### Fase 2 — A navegação que falta

O coração do trabalho, e a resposta ao P0.

1. **`components/layout/BottomNav.tsx`** — novo. `fixed inset-x-0 bottom-0
   md:hidden`, altura 56px + `padding-bottom: env(safe-area-inset-bottom)`,
   fundo `bg-surface` com borda superior e `backdrop-blur` leve. Cinco abas com
   ícone (24px) e rótulo (11px), alvo de 56×56 no mínimo, estado ativo em
   `--primary` com o mesmo indicador de barrinha que o header usa hoje — a
   continuidade visual entre desktop e mobile sai de graça.

   | Aba | Rota | Ícone |
   |---|---|---|
   | Início | `/` | casa |
   | Transações | `/transacoes` | setas |
   | Planejamento | `/planejamento` | alvo |
   | Relatórios | `/relatorios` | gráfico |
   | Perfil | `/perfil` | avatar do usuário |

2. **Categorias sai da barra** e vira uma entrada dentro de Perfil, mantendo a
   rota `/categorias` intacta. Justificativa: categorizar uma transação já
   acontece dentro do `TransactionDetailModal`; a página de Categorias é
   manutenção de configuração, não tarefa diária. Cinco abas é o teto antes de
   os rótulos começarem a truncar em 360px.

3. **`AppLayout.tsx`** — header encolhe para 56px abaixo de `md` e fica só com
   logo, sino e avatar; o `<nav className="hidden md:flex">` continua exatamente
   como está para o desktop. O `<main>` ganha
   `pb-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1rem)] md:pb-8` para o
   conteúdo não terminar embaixo da barra. Padding lateral vira
   `px-4 sm:px-6 md:px-12`.

4. **Tema e sair no mobile.** Com o dropdown do avatar fora de alcance, a página
   de Perfil ganha uma seção "Aparência" com o toggle claro/escuro — fechando
   também o achado 16 e a promessa não cumprida do `PLAN.md`.

### Fase 3 — As telas, uma a uma

Com a fundação e a navegação de pé, cada tela vira um ajuste pequeno.

- **Transações** — abaixo de `md`, a tabela vira lista de cards (descrição +
  chip de categoria em cima, data · conta + valor embaixo), com o card inteiro
  como alvo. A tabela permanece intocada em `md+`. Os três selects de largura
  fixa viram uma linha de chips de filtro que abre um bottom sheet único de
  filtros; a busca fica em largura total no topo. Resolve 5, 11 e parte de 1.
- **Modal** — abaixo de `md`, `items-end`, `rounded-t-modal`, `max-h-[85dvh]`,
  handle de arraste visual e `pb-[env(safe-area-inset-bottom)]`. Um único
  arquivo conserta os nove modais do app. Resolve 9.
- **Select** — a mesma folha de bottom sheet quando `pointer: coarse`; no
  desktop segue popover, com detecção de espaço para abrir para cima quando
  faltar. Resolve 10.
- **Toast** — `inset-x-4 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom)+1rem)]`
  no mobile, `bottom-5 right-5` a partir de `sm`. Resolve 3.
- **NotificationDrawer** — bottom sheet no mobile, popover ancorado no sino a
  partir de `sm`. Resolve 4.
- **Dashboard** — header do mês empilha e o nome do mês trunca; o grid de
  métricas do `MonthSummaryPanel` vira
  `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`. Resolve 12.
- **Relatórios e Categorias** — mesmo ajuste de grade; a barra de ordenação da
  `CategoriesPage` ganha `flex-wrap` e select de largura total no mobile.
- **Categorias** — botões de ação do card passam a `.tap-target`, e o card
  deixa de ser clicável no mobile em favor de um alvo explícito, eliminando o
  aninhamento. Resolve 6 e 15.
- **Perfil** — as linhas de conexão empilham abaixo de `sm`; a troca de imagem
  do banco ganha ícone permanente sob `pointer: coarse`. Resolve 14.
- **Login, Cadastro e Onboarding** — `dvh`, respiro lateral e o painel visual do
  onboarding (hoje `hidden lg:flex`) trocado por uma faixa curta no topo, para
  o mobile não ficar só com texto.

### Fase 4 — O PWA

Só depois que as fases 1–3 estiverem verificadas em celular de verdade.

1. **Mesma origem.** Em produção, `apps/api` passa a servir o build do
   `apps/web`: `express.static(dist)` + fallback SPA para `index.html`, com a
   API montada em `/api`. Com isso o CORS de `app.ts:36-46` deixa de ter
   qualquer papel em produção (fica valendo só para o dev server do Vite), e o
   service worker cobre app e dados sob um domínio só.
2. **`HashRouter` → `BrowserRouter`** (`App.tsx:3`). O hash existia porque o
   Electron carregava de `file://`. Ele atrapalha `start_url`, `scope` e
   `navigateFallback` do service worker. Com o fallback SPA do passo 1, a troca
   é segura.
3. **`vite-plugin-pwa`** com Workbox: `registerType: 'autoUpdate'`, precache do
   shell (HTML/JS/CSS/fontes/ícones), `navigateFallback: '/index.html'` e
   **`NetworkOnly` para `/api/*`** — num app de dinheiro, saldo servido do cache
   sem aviso é pior do que tela vazia, que foi exatamente a decisão de escopo
   offline tomada aqui.
4. **Manifest**: `name: "Poup. — Finanças pessoais"`, `short_name: "Poup."`,
   `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `lang: "pt-BR"`,
   `orientation: "portrait"`, `background_color` e `theme_color` casando com
   `--bg` do tema claro.
5. **Ícones** gerados a partir do `Logo.tsx` (SVG de path único, escala sem
   perda): 192px, 512px, um 512 `maskable` com 10% de folga na safe zone, e
   `apple-touch-icon` de 180px. Cria-se `apps/web/public/`, que ainda não
   existe.
6. **Fontes self-hosted** via `@fontsource/manrope` e `@fontsource/inter`,
   substituindo o `<link>` do Google. Mata o render-block do achado 19 e é
   pré-requisito real de offline — fonte de CDN não entra no precache.
7. **Instalação e atualização**: capturar `beforeinstallprompt` e oferecer um
   botão "Instalar o Poup" em Perfil; um banner discreto quando o service worker
   detectar versão nova.
8. **Tela de sem conexão** honesta, reaproveitando `EmptyState`, em vez do erro
   cru de fetch que `api.ts:105` produz hoje.
9. **iOS**: `apple-mobile-web-app-capable`,
   `apple-mobile-web-app-status-bar-style` e `apple-mobile-web-app-title`. Vale
   registrar que no iOS o PWA só instala pelo Safari, via "Adicionar à Tela de
   Início" — não há prompt programático.
10. **HTTPS é obrigatório.** Service worker e instalação não funcionam em origem
    insegura fora de `localhost`. Qualquer host com TLS automático (Fly.io,
    Render, Railway) resolve; o Neon continua onde está.

---

## Verificação

Ao fim das fases 1–3, e de novo ao fim da 4:

- **Larguras**: 360×640 (Android pequeno), 390×844 (iPhone 14), 414×896, 768,
  1024 e 1440. As três primeiras são as que hoje quebram.
- **Sem vazamento horizontal** em nenhuma rota — no console, por rota:
  `document.documentElement.scrollWidth <= window.innerWidth`.
- **Teclado virtual aberto** em cada formulário: login, cadastro, nova
  categoria, credenciais da Pluggy, detalhe de transação.
- **Rotação** para paisagem em cada rota — a bottom bar não pode comer metade da
  tela.
- **Toque, não mouse**: percorrer os seis destinos pela bottom bar sem tocar no
  teclado, e conferir que nenhuma ação depende de hover.
- **Aparelho real, não emulador.** Um iPhone e um Android baratos revelam o que
  o DevTools esconde: fonte, latência e a barra de endereço que se move.
- **Lighthouse** nas trilhas PWA e Acessibilidade, com a meta de instalação
  passando.
- **Instalar de verdade** no celular e abrir sem rede: deve aparecer o shell e a
  tela de sem conexão, nunca uma página em branco.
