# Poup. — Plano de Correção de Design

Varredura completa de `apps/desktop` contra o protótipo original (`Protótipo/Poup Web.dc.html`), o schema Prisma e as rotas da API.
Escopo: refinamento. A identidade visual do protótipo é preservada e restaurada — nada aqui é redesenho.

---

## Sumário

- [1. Diagnóstico](#1-diagnóstico)
- [2. Decisões travadas](#2-decisões-travadas)
- [3. Modelos por etapa](#3-modelos-por-etapa)
- [4. Fase 0 — Fundação de tokens](#fase-0--fundação-de-tokens)
- [5. Fase 1 — Primitivos compartilhados](#fase-1--primitivos-compartilhados)
- [6. Fase 2 — Remoção da cara de IA](#fase-2--remoção-da-cara-de-ia)
- [7. Fase 3 — Motion](#fase-3--motion)
- [8. Fase 4 — Reformulação de categorias](#fase-4--reformulação-de-categorias)
- [9. Fase 5 — Correções por tela](#fase-5--correções-por-tela)
- [10. Fase 6 — Defeitos funcionais](#fase-6--defeitos-funcionais)
- [11. Fase 7 — Limpeza](#fase-7--limpeza)
- [12. Ordem de execução](#12-ordem-de-execução)
- [13. Checklist de verificação](#13-checklist-de-verificação)
- [Anexo A — Mapa de tokens](#anexo-a--mapa-de-tokens)
- [Anexo B — Inventário de emojis e glifos](#anexo-b--inventário-de-emojis-e-glifos)
- [Anexo C — Biblioteca de ícones de categoria](#anexo-c--biblioteca-de-ícones-de-categoria)
- [Anexo D — Reescrita de copy](#anexo-d--reescrita-de-copy)

---

## 1. Diagnóstico

### 1.1 A perda mais grave: o sistema de cores por categoria foi abandonado

O protótipo constrói toda a leitura visual em cima de **pares de cor por categoria** (`--cb1/--cf1` … `--cb5/--cf5`) aplicados em tiles de 36–38px com ícone SVG dedicado: carrinho para Mercado, casa para Moradia, carro para Transporte, play para Lazer, e assim por diante.

O banco preservou isso — `Category` tem `icon` e `colorKey`, o `CategoryDTO` expõe os dois campos, o seed popula os onze registros com valores corretos. **A UI ignora ambos os campos por completo.** Os tokens `cb1`–`cf5` estão declarados no `tailwind.config.js` e não são usados em lugar nenhum do `src/`.

O que sobrou no lugar:

| Onde | Protótipo | Implementação atual |
|---|---|---|
| Linha de transação | Tile colorido com ícone da categoria | Seta ↑ verde ou ↓ vermelha, idêntica para toda transação do mesmo tipo |
| Card de orçamento | Tile colorido + nome | Só texto |
| Relatórios | Barras nas cores da categoria | `bg-emerald-600`, `bg-teal-600`, `bg-cyan-600`, `bg-lime-600` rotacionando por índice — a cor de uma categoria muda quando outra entra na lista |
| Chip de categoria | Pílula `cb`/`cf` | Retângulo cinza com borda |

Consequência: a tela de transações vira uma lista monocromática onde nada é escaneável, e é exatamente essa uniformidade cinza que dá a "cara de IA". Este é o item de maior retorno visual do plano inteiro.

### 1.2 O modo escuro é verde, não cinza

Tema atual: `#0D1410` / `#141F18` / `#1B2921` / `#25382E`. Todos com dominante verde forte — `#0D1410` tem 7 pontos a mais de verde que de vermelho num valor quase preto, o que a retina lê como tinta esverdeada em superfície grande. O verde da marca (`#1F7A54`) então desaparece dentro do próprio fundo, e o app perde a cor de ação.

Agravante: o protótipo **não tem modo escuro**. A paleta escura foi inventada por extrapolação do tema claro, canal a canal — daí o esverdeado.

### 1.3 O modo escuro está quebrado em duas telas

`dark:` aparece 365 vezes no `src/`, mas a distribuição é o problema:

```
  0  components/notifications/NotificationDrawer.tsx   ← painel branco sobre app escuro
  0  pages/LoginPage.tsx                               ← tela inteira branca
  3  components/common/EmptyState.tsx
  3  components/common/Skeleton.tsx
  6  pages/OnboardingPage.tsx
  7  components/layout/AppLayout.tsx
 78  pages/BudgetsPage.tsx
```

A causa não é descuido pontual: é o padrão `dark:` por classe. Cada cor precisa ser escrita duas vezes em cada elemento, e qualquer omissão é invisível até alguém abrir a tela no tema errado. Com 365 pares para manter à mão, a omissão é estatisticamente inevitável.

**Correção estrutural:** mover a paleta para CSS custom properties comutadas por `.dark` no `:root`. `bg-surface` passa a resolver sozinho nos dois temas, as 365 ocorrências de `dark:` caem para menos de 20 (só casos de opacidade e sombra), e telas novas nascem corretas nos dois temas sem esforço.

### 1.4 Nenhuma animação de entrada funciona

`animate-in fade-in zoom-in-95 duration-200` aparece em **11 lugares**. Essas classes vêm do plugin `tailwindcss-animate`, que **não está instalado** e não está em `plugins: []`. Todas as 11 são classes mortas — os modais aparecem com corte seco, as páginas trocam sem transição.

O que existe de motion real hoje: `transition-colors` (a maioria), `animate-spin` em dois spinners, `animate-pulse` no skeleton e — indevidamente — no badge de notificação e na mensagem de status do modal de conexão.

### 1.5 Inconsistências de escala

Mesmo papel, valores diferentes:

- **Raios:** `rounded-xl` (56×), `rounded-2xl` (36×), `rounded-3xl` (8×), `rounded-lg` (5×), `rounded-md` (2×). Cinco valores para três papéis reais.
- **Alturas de controle:** `h-10`, `h-11`, `h-12`, `h-14`, `min-h-[36px]`, `min-h-[40px]`, `min-h-[42px]`, `min-h-[52px]`. Oito alturas — inclusive `min-h-[42px]` e `min-h-[40px]` lado a lado no mesmo header do Dashboard.
- **Padding de card:** `p-4`, `p-5`, `p-6`, `p-6 md:p-8`, `p-8 md:p-10` sem regra que os distinga.
- **Cores cruas do Tailwind:** 44 ocorrências de `emerald-*`, `red-*`, `amber-*`, `blue-*`, `teal-*`, `cyan-*`, `lime-*` fora do sistema de tokens.
- **Valores monetários sem `tabular-nums`:** em toda a aplicação. Numa tabela financeira as colunas de valor ficam desalinhadas dígito a dígito. É o detalhe que mais separa um app de finanças acabado de um esboço.

### 1.6 Foco de teclado invisível

Inputs têm `focus:ring-2 focus:ring-primary`. **Nenhum `<button>` do app tem estilo de foco.** Como quase toda ação primária é um `<button>` ou `<Link>` sem anel, navegar por teclado é navegar às cegas. Vários controles ainda têm `outline-none` sem substituto.

### 1.7 Vazamento de implementação na copy

Texto visível ao usuário final:

- `"Gerencie suas contas bancárias Open Finance (.env), categorias e aparência do aplicativo."`
- `"Conexões de leitura automáticas gerenciadas via .env (Pluggy)."`
- `"Verifique se as variáveis de ambiente (PLUGGY_ITEM_IDS) estão configuradas no .env."`
- `title="Sincronizar contas do Open Finance (.env)"`
- Badge `"Pluggy Auto"` na tabela de assinaturas
- Card no login exibindo **a senha do seed em texto plano**

### 1.8 Resumo quantitativo

| Métrica | Valor |
|---|---|
| Emojis e glifos decorativos | 12 ocorrências em 6 arquivos |
| `<select>` nativos | 4 |
| `alert()` / `confirm()` nativos | 18 em 4 arquivos |
| Classes `animate-in` mortas | 11 |
| Ocorrências de `dark:` | 365 |
| Cores cruas do Tailwind | 44 |
| Botões com estilo de foco | 0 |
| Arquivos mortos | 2 (`HomePage.tsx`, `ConnectAccountModal.tsx`) |
| Tokens `cb1`–`cf5` usados | 0 de 10 |

---

## 2. Decisões travadas

| # | Decisão | Escolha |
|---|---|---|
| 1 | Base do modo escuro | **Cinza neutro puro** — `#0F0F10` / `#17181A` / `#26282C`. Zero tinta verde no cinza; verde só em ação, link, barra e estado ativo |
| 2 | Cadastro de categorias | **Página dedicada `/categorias`** com seletor de ícone, paleta de cores, edição inline e métricas de uso |
| 3 | Motion | **Camada própria em `index.css`** — keyframes e tokens à mão, sem dependência nova, com `prefers-reduced-motion` |
| 4 | Escopo | **Refatoração permitida** — criação de primitivos compartilhados |

Fora de escopo (confirmado): mudanças de schema, regras de auto-categorização por palavra-chave, troca das fontes Manrope/Inter (são a identidade do protótipo — o detector marca Inter como fonte saturada, e a marcação fica registrada como exceção deliberada).

---

## 3. Modelos por etapa

Cada fase e cada tarefa deste plano carrega uma anotação `Modelo:`. A regra que gerou essas anotações:

| Modelo | ID exato | Custo (entrada/saída por Mtok) | Quando usar aqui |
|---|---|---|---|
| **Claude Opus 5** | `claude-opus-5` | US$ 5 / US$ 25 | Trabalho onde errar é caro ou a solução não está escrita no plano: correção de bugs, componentes com acessibilidade e gerenciamento de foco, decomposição de arquivos grandes, arquitetura da página de categorias |
| **Claude Sonnet 5** | `claude-sonnet-5` | US$ 3 / US$ 15 (promocional US$ 2 / US$ 10 até 31/08/2026) | O grosso da execução: o plano já especifica o resultado e a tarefa é traduzir especificação em código. Qualidade próxima de Opus em código e trabalho agêntico |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | US$ 1 / US$ 5 | Repetição mecânica sem julgamento: substituição de tokens, exclusão de arquivos mortos, 24 ícones SVG a partir de uma especificação fixa |

**Claude Fable 5** (`claude-fable-5`, US$ 10 / US$ 50) não entra em nenhuma etapa. Ele existe para raciocínio de fronteira e execução autônoma de horizonte longo; refinar um app React de 2.300 linhas contra um plano já escrito não é isso, e o custo é o dobro de Opus 5.

**Sobre effort.** Em Opus 5, comece em `xhigh` para as tarefas de código e agênticas e desça a partir daí — `low` e `medium` rendem bem acima do esperado neste modelo. Padrões herdados de modelos anteriores raramente transferem.

**Regra prática de troca.** Se uma tarefa marcada como Sonnet 5 travar duas vezes seguidas — o componente não fica correto, o teste continua falhando —, suba para Opus 5 em vez de insistir. O inverso também vale: tarefas Opus 5 que se revelarem mecânicas na prática podem cair para Sonnet 5 sem prejuízo.

**Distribuição estimada:** Fases 0, 3 e 5 concentram o volume e rodam em Sonnet 5; Fases 1 (parcial), 4 e 6 exigem Opus 5; Fases 2 e 7 e os ícones são Haiku 4.5.

---

## Fase 0 — Fundação de tokens

> Arquivos: `apps/desktop/src/index.css`, `apps/desktop/tailwind.config.js`
> **Modelo: Claude Sonnet 5.** Os valores hexadecimais, a escala de raio e a escala de altura estão todos escritos abaixo — a tarefa é transcrever a especificação e propagar a substituição pelos 20 arquivos, não decidir a paleta.
> **Exceção — Opus 5:** a verificação de contraste do checklist final e qualquer ajuste de cor que ela exigir. Ajustar um token de cor sem quebrar os outros pares é julgamento, não transcrição.

Tudo o mais depende desta fase. Nenhum componente é tocado antes dela.

### 0.1 Paleta em CSS custom properties

Substituir o bloco `colors` do Tailwind por variáveis CSS comutadas por classe. O tema claro é o do protótipo, sem alteração de valor.

```css
:root {
  /* Superfícies — tema claro (valores do protótipo, intocados) */
  --bg:             #F6FAF7;
  --surface:        #FFFFFF;
  --surface-alt:    #EDF3EF;
  --surface-sunken: #E7EFEA;
  --border:         #E1E8E3;
  --border-strong:  #CBD8D0;

  /* Texto */
  --text-primary:   #16211C;
  --text-secondary: #6B7A72;
  --text-disabled:  #A7B3AD;

  /* Marca e ação */
  --primary:        #1F7A54;
  --primary-hover:  #196546;
  --primary-active: #155C3F;
  --primary-soft:   #A8E6C3;
  --primary-ghost:  rgba(31,122,84,.08);
  --on-primary:     #FFFFFF;

  /* Semânticas */
  --income:  #22C55E;
  --expense: #E85D4C;
  --warning: #F5A524;
  --error:   #DC2626;
  --info:    #1E6A80;

  /* Fundo suave das semânticas */
  --income-soft:  rgba(34,197,94,.10);
  --expense-soft: rgba(232,93,76,.10);
  --warning-soft: rgba(245,165,36,.12);
  --error-soft:   rgba(220,38,38,.10);

  /* Categorias — pares fundo/traço do protótipo */
  --cat-1-bg: #CFEBDC;  --cat-1-fg: #1F7A54;
  --cat-2-bg: #C6E7E3;  --cat-2-fg: #14746B;
  --cat-3-bg: #E0EDC6;  --cat-3-fg: #5F8A1E;
  --cat-4-bg: #C9E5EC;  --cat-4-fg: #1E6A80;
  --cat-5-bg: #D8EDCB;  --cat-5-fg: #3F7A2C;

  /* Elevação */
  --sh1: 0 1px 2px rgba(0,0,0,.06);
  --sh2: 0 4px 14px rgba(0,0,0,.07);
  --sh3: 0 16px 40px rgba(0,0,0,.10);
  --ring: 0 0 0 3px rgba(31,122,84,.28);
}
```

```css
.dark {
  /* Cinza neutro puro — nenhum canal desviado para verde */
  --bg:             #0F0F10;
  --surface:        #17181A;
  --surface-alt:    #1E2023;
  --surface-sunken: #121314;
  --border:         #26282C;
  --border-strong:  #34373C;

  --text-primary:   #E9EAEC;
  --text-secondary: #9A9DA3;
  --text-disabled:  #6B6E74;

  /* Verde clareado: #1F7A54 não passa contraste sobre #17181A */
  --primary:        #34A06B;   /* 5.9:1 sobre --surface */
  --primary-hover:  #3EB278;
  --primary-active: #2B8C5C;
  --primary-soft:   rgba(52,160,107,.18);
  --primary-ghost:  rgba(52,160,107,.10);
  --on-primary:     #0F0F10;

  --income:  #3DD37F;
  --expense: #F0796A;
  --warning: #F7B84B;
  --error:   #F87171;   /* #DC2626 é escuro demais sobre fundo escuro */
  --info:    #56AECB;

  --income-soft:  rgba(61,211,127,.14);
  --expense-soft: rgba(240,121,106,.14);
  --warning-soft: rgba(247,184,75,.14);
  --error-soft:   rgba(248,113,113,.14);

  /* Categorias: fundo translúcido + traço clareado */
  --cat-1-bg: rgba(52,160,107,.16);  --cat-1-fg: #6FCF9B;
  --cat-2-bg: rgba(45,168,157,.16);  --cat-2-fg: #5FCFC2;
  --cat-3-bg: rgba(140,190,60,.16);  --cat-3-fg: #B4D468;
  --cat-4-bg: rgba(60,160,190,.16);  --cat-4-fg: #74C4DC;
  --cat-5-bg: rgba(96,170,70,.16);   --cat-5-fg: #94D07A;

  /* Sombra não existe no escuro: elevação vem de superfície + borda */
  --sh1: 0 1px 2px rgba(0,0,0,.40);
  --sh2: 0 4px 14px rgba(0,0,0,.45);
  --sh3: 0 16px 40px rgba(0,0,0,.55);
  --ring: 0 0 0 3px rgba(52,160,107,.35);
}
```

**Regra do verde no escuro.** O verde aparece somente em: botão primário, link, aba/nav ativa, barra de progresso saudável, anel de foco, badge de estado positivo, o ponto do logo. Nunca em fundo de página, fundo de card, borda estrutural, divisória ou texto corrido.

### 0.2 Ligação com o Tailwind

```js
colors: {
  bg:      "var(--bg)",
  surface: { DEFAULT: "var(--surface)", alt: "var(--surface-alt)", sunken: "var(--surface-sunken)" },
  border:  { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
  text:    { primary: "var(--text-primary)", secondary: "var(--text-secondary)", disabled: "var(--text-disabled)" },
  primary: { DEFAULT: "var(--primary)", hover: "var(--primary-hover)", active: "var(--primary-active)",
             soft: "var(--primary-soft)", ghost: "var(--primary-ghost)", fg: "var(--on-primary)" },
  income:  { DEFAULT: "var(--income)",  soft: "var(--income-soft)"  },
  expense: { DEFAULT: "var(--expense)", soft: "var(--expense-soft)" },
  warning: { DEFAULT: "var(--warning)", soft: "var(--warning-soft)" },
  error:   { DEFAULT: "var(--error)",   soft: "var(--error-soft)"   },
  cat: {
    "1-bg": "var(--cat-1-bg)", "1-fg": "var(--cat-1-fg)",
    "2-bg": "var(--cat-2-bg)", "2-fg": "var(--cat-2-fg)",
    "3-bg": "var(--cat-3-bg)", "3-fg": "var(--cat-3-fg)",
    "4-bg": "var(--cat-4-bg)", "4-fg": "var(--cat-4-fg)",
    "5-bg": "var(--cat-5-bg)", "5-fg": "var(--cat-5-fg)",
  },
}
```

Remover do config: `dark-bg`, `dark-surface`, `dark-surface-alt`, `dark-border`, `dark-text-primary`, `dark-text-secondary`, `primary-light`, `primary-dark`, `cb1`–`cf5`. Todos passam a ser resolvidos pelas variáveis.

Safelist necessária para as classes `cat-*` geradas dinamicamente a partir do `colorKey`:

```js
safelist: [{ pattern: /^(bg|text|border)-cat-[1-5]-(bg|fg)$/ }]
```

### 0.3 Escala de raio

Três papéis, três valores. O protótipo usa 10 / 12 / 16 / 20 / 28.

| Token | Valor | Papel |
|---|---|---|
| `rounded-chip` | 8px | badges, pílulas pequenas |
| `rounded-tile` | 10px | tiles de ícone de categoria |
| `rounded-ctl` | 12px | inputs, botões, selects |
| `rounded-card` | 16px | cards internos, linhas de lista |
| `rounded-panel` | 20px | cards principais, painéis |
| `rounded-modal` | 28px | modais e drawers |
| `rounded-full` | 999px | avatares, dots, barras de progresso |

Substituições mecânicas: todo `rounded-3xl` de modal → `rounded-modal`; `rounded-2xl` de card principal → `rounded-panel`; `rounded-xl` de controle → `rounded-ctl`; `rounded-lg`/`rounded-md` de tile → `rounded-tile`.

### 0.4 Escala de altura de controle

Três alturas. Substitui as oito atuais.

| Token | Altura | Uso |
|---|---|---|
| `h-ctl-sm` | 36px | ações secundárias em card, botões de linha de tabela |
| `h-ctl` | 44px | padrão — inputs, selects, botões de formulário e header |
| `h-ctl-lg` | 52px | CTA de onboarding e login |

Alvo de clique mínimo de 36px em qualquer controle interativo. Os `w-7 h-7` e `w-8 h-8` de botão de fechar precisam de área de toque expandida via padding ou pseudo-elemento.

### 0.5 Ritmo de espaçamento

Grade de 4px, com um subconjunto declarado para densidade de card:

| Contexto | Padding | Gap interno |
|---|---|---|
| Painel principal (`rounded-panel`) | `p-6 md:p-8` | `gap-6` |
| Card de widget | `p-6` | `gap-4` |
| Card compacto / linha de lista | `p-4` | `gap-3` |
| Célula de tabela | `py-4 px-6` | `gap-3` |
| Modal | `p-6 md:p-8` | `gap-6` |

Fora dessa tabela, nada de `p-3.5`, `p-5` ou `gap-1.5` avulsos.

### 0.6 Escala tipográfica

| Token | Definição | Uso |
|---|---|---|
| `text-display-xl` | Manrope 800 · 30/1.15 · `-0.02em` | H1 de página |
| `text-display-lg` | Manrope 700 · 20/1.25 · `-0.01em` | H2 de seção |
| `text-display-md` | Manrope 700 · 16/1.3 | Título de card |
| `text-num-xl` | Manrope 800 · 28/1.1 · `tabular-nums` | Saldo consolidado |
| `text-num-lg` | Manrope 700 · 20/1.2 · `tabular-nums` | Valores de destaque |
| `text-num` | Manrope 700 · 14/1.4 · `tabular-nums` | Valores em tabela e lista |
| `text-body` | Inter 400 · 14/1.55 | Corpo |
| `text-body-sm` | Inter 400 · 13/1.5 | Texto secundário |
| `text-label` | Inter 600 · 12/1.4 | Rótulos de campo |
| `text-caption` | Inter 500 · 11/1.4 | Metadados, timestamps |
| `text-overline` | Inter 600 · 11/1.2 · `0.06em` · uppercase | Cabeçalhos de tabela, eyebrows |

**`font-variant-numeric: tabular-nums` é obrigatório em todo valor monetário, percentual e data.** Aplicar via os tokens `text-num*` e via utilitário `.tnum` para casos soltos.

Eliminar todos os tamanhos arbitrários atuais: `text-[14.5px]`, `text-[11px]`, `text-[10px]`, `text-[10.5px]`.

### 0.7 Foco

Utilitário único, aplicado a **todo** elemento interativo:

```css
.focus-ring {
  outline: none;
}
.focus-ring:focus-visible {
  box-shadow: var(--ring);
  border-radius: inherit;
}
```

Nenhum `outline-none` sem `.focus-ring` acompanhando.

---

## Fase 1 — Primitivos compartilhados

> Novo diretório: `apps/desktop/src/components/ui/`
> **Modelo: dividido por componente.** Os primitivos que só encapsulam estilo vão em Sonnet 5; os que carregam gerenciamento de foco, teclado e ARIA vão em Opus 5. A tabela abaixo fecha a divisão.

| Componente | Modelo | Por quê |
|---|---|---|
| `Select.tsx` | **Opus 5** | Sete interações de teclado, `aria-activedescendant`, type-ahead com buffer, clique externo, devolução de foco. É o componente mais fácil de entregar quebrado de um jeito que passa despercebido no mouse |
| `Modal.tsx` | **Opus 5** | Focus trap e devolução de foco ao gatilho. Implementação ingênua deixa o foco escapar para trás do overlay |
| `ConfirmDialog.tsx` + `useConfirm()` | **Opus 5** | API de promessa sobre o `Modal`, com o ciclo de vida do foco herdado |
| `Toast.tsx` + `useToast()` | **Sonnet 5** | Pilha, timers e `role` por severidade — padrão conhecido, sem armadilha de foco |
| `Field` / `Input` / `Textarea` / `CurrencyInput` | **Sonnet 5** | Ligação `htmlFor`/`id` e máscara pt-BR; mecânico |
| `Button` · `Card` · `Badge` · `ProgressBar` | **Sonnet 5** | Variantes de estilo sobre os tokens da Fase 0 |
| `CategoryTile` · `CategoryChip` | **Sonnet 5** | Resolve `colorKey` → classe e `icon` → componente. Depende da biblioteca de ícones (ver Fase 4) |
| `EmptyState` · `Skeleton` (revisão) | **Sonnet 5** | Troca de prop e keyframe de shimmer |

Hoje o mesmo botão primário está reescrito à mão em 9 arquivos, o mesmo shell de modal em 5, o mesmo input em 12. A padronização que você pediu não se sustenta sem estes primitivos.

### 1.1 `Button.tsx`

Variantes: `primary` · `secondary` · `ghost` · `danger`
Tamanhos: `sm` (36) · `md` (44) · `lg` (52)
Props: `loading`, `disabled`, `iconLeft`, `iconRight`, `fullWidth`

Comportamento obrigatório:
- `loading` troca o rótulo por spinner **mantendo a largura** do botão (sem salto de layout)
- `disabled` usa `opacity-50` + `cursor-not-allowed`, nunca só opacidade
- `.focus-ring` em todas as variantes
- `active:scale-[0.98]` com `--dur-fast`
- `transition: background-color, box-shadow, transform` — nunca `transition-all`

### 1.2 `Select.tsx` — o select customizado

Substitui os 4 `<select>` nativos. Esta é a peça mais visível da padronização: o select nativo do Windows renderiza com chrome do SO, ignora a paleta, ignora o raio, e no modo escuro abre um dropdown branco.

**API**

```tsx
<Select
  value={categoryFilter}
  onChange={setCategoryFilter}
  options={[{ value: "ALL", label: "Todas as categorias" }, ...cats]}
  placeholder="Selecione..."
  size="md"
  renderOption={(o) => <CategoryOption {...o} />}   // opcional: tile + cor
/>
```

**Estrutura**

- Trigger: `<button role="combobox" aria-expanded aria-controls aria-haspopup="listbox">` — altura `h-ctl`, `rounded-ctl`, `bg-surface-alt`, borda transparente que vira `border-strong` no hover
- Chevron: `ChevronDownIcon` (já existe em `Icons.tsx`, hoje sem uso), rotação 180° em `--dur-fast`
- Popover: `<ul role="listbox">` posicionado abaixo, `bg-surface`, `rounded-card`, `shadow-sh3`, `border`, `max-h-64 overflow-y-auto`
- Opções: `<li role="option" aria-selected>`, altura 36px, hover `bg-surface-alt`, selecionada com `bg-primary-ghost text-primary` + check à direita

**Teclado (não negociável)**

| Tecla | Ação |
|---|---|
| `Space` / `Enter` / `↓` no trigger fechado | Abre e foca a opção selecionada |
| `↑` / `↓` | Move o destaque, com scroll into view |
| `Home` / `End` | Primeira / última opção |
| `Enter` | Confirma e devolve o foco ao trigger |
| `Esc` | Fecha sem alterar, devolve o foco ao trigger |
| Digitação | Type-ahead por prefixo, buffer de 500ms |

Fechar em clique externo e em scroll do container. `aria-activedescendant` acompanhando o destaque.

**Motion:** popover entra com `fade-in` + `translateY(-4px → 0)` em `--dur-fast`, sai com `fade-out` em 100ms.

### 1.3 `Modal.tsx`

Shell único para os 5 modais atuais (orçamento, meta, assinatura, categoria, detalhe de transação).

- Overlay `bg-black/50 backdrop-blur-sm`, `fade-in` em `--dur-base`
- Painel `rounded-modal`, `shadow-sh3`, entrada `scale-in` (0.97 → 1) + `fade-in`
- **Focus trap** e devolução do foco ao gatilho ao fechar
- Fecha em `Esc` — nenhum dos 5 modais faz isso hoje

> **Revisto depois da implementação.** O plano original também fechava no clique
> no overlay. Na prática todos os modais deste app são formulários, e o clique
> errado ao lado da caixa jogava fora o preenchimento inteiro. `Modal` passou a
> nascer com `closeOnOverlayClick={false}`; a prop continua existindo para quem
> quiser o comportamento antigo. Saída fica pelo X e pelo `Esc`.
- `role="dialog" aria-modal="true" aria-labelledby`
- `overflow: hidden` no `body` enquanto aberto
- Slots `header` / `body` / `footer`; footer com ações alinhadas à direita, primária por último

### 1.4 `Field.tsx` / `Input.tsx` / `Textarea.tsx`

Rótulo + controle + texto de apoio + mensagem de erro, com `htmlFor`/`id` ligados. Hoje **nenhum** dos ~12 inputs do app tem `<label htmlFor>` — os rótulos são `<label>` soltos, sem associação, e leitor de tela não anuncia campo nenhum.

Estados: default, hover, focus (`.focus-ring`), disabled, error (borda `--error` + mensagem com `role="alert"`).

Variante `CurrencyInput`: prefixo `R$`, máscara pt-BR, `tabular-nums`, `inputMode="decimal"`. Substitui os 5 `<input type="number">` que hoje aceitam ponto e vírgula de forma inconsistente e são convertidos com `parseFloat(v.replace(",", "."))` espalhado em 3 handlers.

### 1.5 `CategoryTile.tsx` — o primitivo que restaura o protótipo

```tsx
<CategoryTile icon={cat.icon} colorKey={cat.colorKey} size="md" />
```

Tamanhos: `sm` 28px · `md` 36px · `lg` 46px — os três do protótipo.
Renderiza `rounded-tile` com `bg-cat-{key}-bg text-cat-{key}-fg` e o SVG resolvido pelo mapa do [Anexo C](#anexo-c--biblioteca-de-ícones-de-categoria).

Usado em: linha de transação, chip de categoria, card de orçamento, linha de assinatura, barra de relatório, lista de categorias, opção do `Select` de categoria. Sete pontos de uso — é o componente que devolve a identidade visual ao app.

### 1.6 `CategoryChip.tsx`

Pílula com ponto ou tile pequeno na cor da categoria + nome. Substitui o retângulo cinza atual da tabela de transações.

### 1.7 `Badge.tsx`

Variantes `neutral` · `success` · `warning` · `danger` · `info`, tamanhos `sm`/`md`.
Consolida: status de orçamento (Em dia/Atenção/Estourado), status de assinatura (Ativa/Pausada), origem (Automática/Manual), badge "Sem categoria". Hoje são quatro implementações independentes com raios e paddings diferentes.

### 1.8 `ProgressBar.tsx`

Props `value`, `max`, `status` (`ok` | `warning` | `exceeded`), `size` (`sm` 6px | `md` 8px | `lg` 10px).
Preenchimento anima com `--dur-slow` e `--ease-out` na montagem e na mudança de valor.
Consolida as 4 barras atuais, hoje com alturas 2 / 2.5 / 3 diferentes para o mesmo papel.

### 1.9 `ConfirmDialog.tsx` + `useConfirm()`

Substitui os 6 `confirm()` nativos. O `confirm()` do Electron trava a thread do renderer e abre uma caixa do Windows sem relação visual com o app.

Ação destrutiva usa `Button variant="danger"`, e o nome do item excluído aparece no corpo — `"Excluir a categoria Mercado?"`, não `"Excluir esta categoria?"`.

### 1.10 `Toast.tsx` + `useToast()`

Substitui os 12 `alert()` nativos. Casos: erro de salvamento, erro de sincronização, resultado de sync, categoria duplicada, exclusão concluída.

Pilha no canto inferior direito, `slide-in-from-bottom` + `fade-in`, auto-dismiss em 4s (erro persiste até fechar), `role="status"` / `role="alert"` conforme severidade, botão de fechar, máximo 3 visíveis.

O resultado do sync deixa de ser
`alert("Sincronização concluída!\nContas: 3\nTransações: 128\nAssinaturas: 4")`
e passa a ser um toast de sucesso com as três métricas em linha.

### 1.11 `Card.tsx`

Variantes `panel` (principal, `sh2`) · `widget` (`sh1`) · `flat` (sem sombra, só borda).
Slots opcionais `title` / `action`, aplicando o par `text-display-md` + link `text-primary` que hoje se repete em 8 cabeçalhos de card com marcações levemente diferentes.

### 1.12 `EmptyState.tsx` — revisão

A prop `icon: ReactNode` num container `text-2xl` foi desenhada para receber emoji. Trocar por `icon: ComponentType<SVGProps>` renderizado em tile `rounded-card` de 56px com `bg-surface-alt text-primary`. Ação vira `<Button>`.

### 1.13 `Skeleton.tsx` — revisão

`animate-pulse` (opacidade piscando) → **shimmer**: gradiente varrendo em `translateX` de 1.4s. Menos cansativo e é o padrão de mercado.
Skeleton deve espelhar a geometria real do conteúdo — o `TableRowSkeleton` atual tem 4 blocos numa tabela de 5 colunas, o que produz um salto de layout quando os dados chegam.

---

## Fase 2 — Remoção da cara de IA

> **Modelo: Claude Haiku 4.5** para 2.1 (troca de 12 glifos por componentes de ícone, endereços exatos no Anexo B) e para 2.2 e 2.5 (tabelas antes/depois completas). Nenhuma dessas três exige julgamento: o texto de destino já está escrito.
> **Modelo: Claude Sonnet 5** para 2.3, 2.4, 2.6 e 2.7. Remover subtítulo é decidir o que ocupa o espaço liberado; substituir a frase de marketing é escrever a frase que fica; o gráfico com dados falsos vira busca real de dois meses; a coerência de traço dos ícones é decisão ótica.
> **Modelo: Claude Opus 5** só para 2.6 se a busca dos dois meses anteriores exigir mudar a assinatura de `fetchTransactions` ou a forma do estado do Dashboard.

### 2.1 Emojis — remoção total

12 ocorrências. Nenhuma sobrevive. Detalhe completo no [Anexo B](#anexo-b--inventário-de-emojis-e-glifos).

| Emoji | Onde | Substituto |
|---|---|---|
| `☀️` `🌙` | `AppLayout.tsx:83,85` · `ProfilePage.tsx:266,280` | `SunIcon` / `MoonIcon` (novos, mesma família de traço) |
| `🏦` | `DashboardPage.tsx:347` · `ProfilePage.tsx:189` | `BankIcon` (novo) |
| `🔒` | `ConnectAccountModal.tsx:134` | `ShieldIcon` — é o ícone que o protótipo usa nesse ponto exato |
| `💡` | `LoginPage.tsx:82` | Bloco removido inteiro (ver 2.4) |
| `👋` | `HomePage.tsx:13` | Arquivo deletado |
| `◀` `▶` | `DashboardPage.tsx:109,119` | `ChevronLeftIcon` / `ChevronRightIcon` |
| `×` | `ProfilePage.tsx:315` | `CloseIcon` (já existe) |
| `•` | 3 separadores | `<span aria-hidden>` com `·` (middle dot) e `text-disabled` |

Ponto importante: **o protótipo não tem um único emoji.** Cada um deles foi introduzido na implementação. Removê-los não é preferência estética — é voltar ao original.

### 2.2 Capitalização — padronizar em sentence case

Português brasileiro não usa Title Case em títulos de interface. O app mistura os dois, e a mistura é o tell mais forte de texto gerado.

| Atual | Corrigido |
|---|---|
| `Perfil & Configurações` | `Perfil` |
| `Relatórios & Análise de Gastos` | `Relatórios` |
| `Últimas Transações do Mês` | `Últimas transações` |
| `Distribuição de Gastos por Categoria` | `Gastos por categoria` |
| `Gasto Mensal Recorrente` | `Gasto mensal recorrente` |
| `Tipo de Movimentação` | `Tipo` |
| `Data da Operação` | `Data` |
| `Aparência do Aplicativo` | `Aparência` |
| `Contas Bancárias (Open Finance)` | `Contas conectadas` |
| `Categorias Personalizadas (11)` | `Categorias · 11` |
| `Nova Meta Financeira` | `Nova meta` |
| `Criar Primeiro Orçamento` | `Criar orçamento` |
| `Definir Primeira Meta` | `Criar meta` |
| `Cadastrar Assinatura` | `Cadastrar assinatura` |
| `Salvar Orçamento` / `Salvar Meta` | `Salvar` |
| `Sincronizar Todas as Contas` | `Sincronizar tudo` |
| `Entrar na sua conta` | `Entrar` |
| `Encerrar Sessão` | `Sair` |

Regra: **só a primeira letra e nomes próprios.** Botões preferem verbo único.

O `&` em título é hábito de inglês. `Perfil & Configurações` e `Relatórios & Análise de Gastos` são dois substantivos empilhados para parecer mais completo — em nav de 5 itens onde a aba já se chama "Perfil" e "Relatórios", o segundo substantivo é ruído.

### 2.3 Subtítulos redundantes

Quatro páginas têm um parágrafo sob o H1 que reafirma o que o título já diz:

- Transações — `"Visualize e categorize todas as suas movimentações financeiras bancárias."`
- Planejamento — `"Defina limites de gastos, acompanhe metas de economia e gerencie assinaturas."`
- Relatórios — `"Compreenda a distribuição das suas finanças por categoria e fluxo de caixa."`
- Perfil — `"Gerencie suas contas bancárias Open Finance (.env), categorias e aparência do aplicativo."`

Este é um app de uso pessoal, usado diariamente pela mesma pessoa. Explicar a tela toda vez é ruído permanente. **Remover os quatro.** O espaço vertical liberado sobe o conteúdo real.

Onde faltar contexto, ele vira dado útil no lugar de descrição: em Transações, `"128 transações · 12 sem categoria"` sob o título faz mais trabalho que a frase atual.

### 2.4 Marketing dentro de app operacional

| Atual | Problema | Corrigido |
|---|---|---|
| `alertas inteligentes` (2×) | "Inteligente" é enfeite; o alerta é uma regra de limite | `avisos quando o limite se aproximar` |
| `Conexão 100% segura via Open Finance.` | Alegação de segurança não verificável | `Conexão somente leitura. A Poup. não guarda sua senha e não movimenta seu dinheiro.` (texto do protótipo) |
| `transações sem categoria esperando você` | Antropomorfismo | `12 transações sem categoria` |
| `Receita (Entrada)` / `Despesa (Saída)` | Glossa entre parênteses | `Receita` / `Despesa` |
| `descubra o ritmo ideal para realizar seus sonhos` | Copy de landing page | `calcule quanto guardar por mês` |
| `Detecção automática de cobranças recorrentes para você nunca mais ser pego de surpresa na fatura.` | Promessa em superlativo | `Cobranças recorrentes identificadas automaticamente nas suas faturas.` |
| `receba alertas inteligentes antes de estourar o limite` | Idem | `receba um aviso antes de estourar` |

### 2.5 Vazamento de implementação

| Local | Atual | Corrigido |
|---|---|---|
| `ProfilePage:113` | `...contas bancárias Open Finance (.env), categorias e aparência do aplicativo.` | Subtítulo removido |
| `ProfilePage:148` | `Conexões de leitura automáticas gerenciadas via .env (Pluggy).` | `Conexões somente leitura via Open Finance.` |
| `ProfilePage:171` | `Verifique se as variáveis de ambiente (PLUGGY_ITEM_IDS) estão configuradas no .env.` | `Nenhuma instituição conectada ainda.` + `<Button>Conectar conta</Button>` |
| `DashboardPage:131` | `title="Sincronizar contas do Open Finance (.env)"` | `title="Buscar movimentações novas"` |
| `BudgetsPage:489` | Badge `Pluggy Auto` | Badge `Automática` |
| `LoginPage:80-90` | Card com email e **senha do seed em texto plano** | Bloco removido |
| `LoginPage:8-9` | `useState("pedroluizzampar@gmail.com")` / `useState("123")` | `useState("")` |

O card de credenciais no login é o tell mais direto de app não terminado — e expõe a senha na tela. Sai junto com o preenchimento automático dos campos.

### 2.6 Gráfico com dados falsos

`DashboardPage.tsx:189-207`, seção "Fluxo Mensal (Entradas x Saídas)": as barras rotuladas **"Mês -2"** e **"Mês -1"** têm alturas fixas no código (`h-20`, `h-12`, `h-24`, `h-20`). Só a coluna "Atual" reflete dados reais.

Num app de finanças, apresentar número inventado como histórico é o defeito mais sério do plano inteiro. Não é questão estética.

Correção: buscar os totais reais dos dois meses anteriores (`fetchTransactions` já aceita `month`) e rotular com o nome do mês — `"jun"`, `"jul"`, `"ago"` — em vez de `"Mês -2"`. Sem dado disponível, a coluna aparece vazia com legenda `"sem dados"`, nunca preenchida com valor arbitrário.

O gráfico também ganha: eixo Y com escala real, rótulo de valor no topo de cada barra, e `--dur-slow` de crescimento na montagem.

### 2.7 Ícones — coerência de família

`Icons.tsx` mistura `strokeWidth` 1.8 / 2 / 2.2 entre ícones do mesmo tamanho aparente. O protótipo usa 1.75–1.9 de forma consistente.

Padronizar: **`strokeWidth="1.8"`**, `strokeLinecap="round"`, `strokeLinejoin="round"`, `viewBox="0 0 24 24"`, `fill="none"` em todos. Ícones de seta de transação sobem para 2 (traço curto precisa de mais peso ótico) — exceção declarada.

Tamanhos: 14 (inline em caption) · 16 (padrão em botão) · 18 (tile `sm`/`md`) · 20 (tile `lg`) · 24 (empty state). Sem valores fora dessa lista.

---

## Fase 3 — Motion

> Arquivo: `apps/desktop/src/index.css`
> **Modelo: Claude Sonnet 5.** Curvas, durações e keyframes estão especificados abaixo; a aplicação (3.3) é uma tabela de elemento → movimento. Trabalho de transcrição com verificação visual.
> **Exceção — Opus 5:** o stagger de lista (3.3) se ele precisar de índice calculado em runtime dentro do `.map()` das transações, e a auditoria dos 9 `transition-all` (3.4), que exige ler cada caso e decidir quais propriedades listar.

### 3.1 Tokens

```css
:root {
  --dur-instant: 80ms;
  --dur-fast:    140ms;
  --dur-base:    200ms;
  --dur-slow:    320ms;

  --ease-out:    cubic-bezier(.22, 1, .36, 1);      /* entrada — desacelera */
  --ease-in:     cubic-bezier(.55, 0, 1, .45);      /* saída */
  --ease-spring: cubic-bezier(.34, 1.4, .64, 1);    /* toque de mola, uso raro */
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-instant: 0ms; --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
```

### 3.2 Keyframes

```css
@keyframes fade-in     { from { opacity: 0 } to { opacity: 1 } }
@keyframes fade-up     { from { opacity: 0; transform: translateY(8px) }  to { opacity: 1; transform: none } }
@keyframes fade-down   { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }
@keyframes scale-in    { from { opacity: 0; transform: scale(.97) }       to { opacity: 1; transform: none } }
@keyframes slide-right { from { opacity: 0; transform: translateX(-12px) } to { opacity: 1; transform: none } }
@keyframes shimmer     { from { background-position: -200% 0 } to { background-position: 200% 0 } }
```

Utilitários `.anim-fade-in`, `.anim-fade-up`, `.anim-scale-in`, `.anim-fade-down`, `.anim-slide-right` com `--ease-out` e `backface-visibility: hidden`.

### 3.3 Aplicação

| Elemento | Movimento |
|---|---|
| Troca de rota | `fade-up` · `--dur-base` |
| Overlay de modal | `fade-in` · `--dur-base` |
| Painel de modal | `scale-in` + `fade-in` · `--dur-base` |
| Popover do Select | `fade-down` · `--dur-fast` |
| Drawer de notificações | `fade-down` · `--dur-fast` |
| Toast | `fade-up` na entrada, `fade-out` na saída |
| Linhas de lista/card | `fade-up` com `stagger` de 24ms, **até 8 itens** |
| Barra de progresso | `width` · `--dur-slow` · `--ease-out` |
| Barra do gráfico | `height` · `--dur-slow`, stagger 40ms |
| Hover de card | `translateY(-1px)` + `sh1 → sh2` · `--dur-fast` |
| Hover de linha de tabela | `background-color` · `--dur-instant` |
| Botão pressionado | `scale(.98)` · `--dur-instant` |
| Troca de tema | `background-color`, `color`, `border-color` · `--dur-base` |
| Chevron do Select/accordion | `rotate(180deg)` · `--dur-fast` |
| Skeleton | `shimmer` · 1.4s infinito |

### 3.4 Regras

- **Nunca `transition-all`.** Listar as propriedades. Hoje `transition-all` aparece em 9 lugares e anima `width`/`height` sem necessidade.
- Só `transform` e `opacity` em animação contínua. `width` e `height` apenas em barra de progresso, onde o valor é o significado.
- Stagger limitado a 8 itens — acima disso a lista parece lenta.
- `animate-pulse` sai do badge de notificação e da mensagem de status do modal de conexão. Pulsação infinita em elemento não-carregando é ruído.
- A transição de tema não pode animar `box-shadow` (repaint caro em tela cheia).

---

## Fase 4 — Reformulação de categorias

> Novos arquivos: `pages/CategoriesPage.tsx`, `components/categories/CategoryFormModal.tsx`, `components/categories/IconPicker.tsx`, `components/categories/ColorPicker.tsx`, `lib/categoryIcons.tsx`
> **Modelo: majoritariamente Claude Opus 5.** É a única fase que cria funcionalidade em vez de refinar o que existe — rota nova, tela nova, mudança de backend e propagação para 7 telas.

| Item | Modelo | Por quê |
|---|---|---|
| 4.2 Rota e navegação | **Sonnet 5** | Uma entrada em `App.tsx` e uma no `navItems` do `AppLayout` |
| 4.3 Layout da página | **Opus 5** | Agregar gasto do mês e contagem de transações por categoria a partir de três endpoints, com ordenação e estado vazio. É onde o cálculo pode sair errado sem parecer errado |
| 4.4 Modal criar/editar | **Opus 5** | Preview ao vivo, tri-estado do formulário, validação de duplicata antes do POST, `loading` no submit |
| `IconPicker` / `ColorPicker` | **Opus 5** | `role="radiogroup"` com navegação por seta e `aria-checked`. Mesma classe de problema do `Select` |
| 4.5 Exclusão com consequência | **Opus 5** | Buscar o impacto real (transações + orçamento vinculado) antes de abrir o diálogo, e acertar as duas semânticas de cascata do schema |
| 4.6 Normalizar `colorKey` | **Opus 5** | Toca `categories.service.ts`, os schemas Zod e o helper tolerante a legado no cliente. Errar aqui corrompe dado existente |
| **Os 24 ícones SVG** (`lib/categoryIcons.tsx`) | **Haiku 4.5** | Especificação fixa no Anexo C: `viewBox` 24, traço 1.8, cap e join arredondados. Vinte e quatro repetições da mesma forma. Gere em lote e revise visualmente a 14px |
| Mapa de sinônimos | **Haiku 4.5** | Lista de palavras em português por chave |
| 4.7 Propagação (7 telas) | **Sonnet 5** | Trocar seta genérica por `CategoryTile` em cada ponto de uso. Repetitivo, com o componente já pronto |

### 4.1 Situação atual

Cadastro de categoria = um modal com **um campo de texto**, escondido no fim da página de Perfil, depois de 3 seções longas. Nenhuma edição — só criar e excluir. Nenhum ícone, nenhuma cor, nenhum contexto de uso.

Exclusão sem aviso de consequência: `onDelete: SetNull` no schema, ou seja, apagar uma categoria desassocia silenciosamente todas as transações dela e **apaga em cascata os orçamentos vinculados** (`Budget` usa `onDelete: Cascade`). O `confirm("Excluir esta categoria?")` não menciona nada disso.

### 4.2 Rota e navegação

Nova rota `/categorias`, com item no topbar entre "Orçamentos" e "Relatórios":

```
Início · Transações · Categorias · Orçamentos · Relatórios · Perfil
```

A seção de categorias sai do Perfil e é substituída por uma linha de resumo com link — `"11 categorias · gerenciar"`.

### 4.3 Layout da página

**Cabeçalho** — H1 `Categorias`, contagem como dado (`11 categorias · 3 sem uso`), botão primário `Nova categoria`.

**Faixa de resumo** — três números em `text-num-lg`: total de categorias, categorias com gasto no mês, categoria de maior gasto.

**Lista** — grade responsiva (1 / 2 / 3 colunas). Cada card:

```
┌──────────────────────────────────────────┐
│ [tile 46px]  Mercado                   ⋯ │
│              R$ 1.284,50 este mês        │
│              38 transações · orçamento ✓ │
│ ────────────────────────────────────────  │
│ ████████████████░░░░░░░  64% do orçamento │
└──────────────────────────────────────────┘
```

- Tile `lg` com o ícone e a cor reais da categoria
- Gasto do mês corrente em `tabular-nums`
- Contagem de transações e indicador de orçamento vinculado
- Barra de progresso apenas quando existe orçamento
- Menu `⋯` (`Editar` · `Excluir`) — botão real com `.focus-ring`, não um ícone decorativo
- Clique no card abre a edição; hover eleva `sh1 → sh2`

**Ordenação** — `Select` no cabeçalho: `Maior gasto` (padrão) · `Nome` · `Mais usadas` · `Criação`.

**Estado vazio** — só ocorre se o usuário apagar tudo. `EmptyState` com ação `Restaurar categorias padrão`.

### 4.4 Modal de criar/editar

Mesmo componente para os dois modos; o de edição pré-preenche.

```
┌─────────────────────────────────────────────┐
│  Nova categoria                          ✕  │
├─────────────────────────────────────────────┤
│                                             │
│         ┌────────┐                          │
│         │  ICON  │   Mercado                │  ← preview ao vivo
│         └────────┘   R$ 0,00                │
│                                             │
│  Nome                                       │
│  ┌───────────────────────────────────────┐  │
│  │ Mercado                               │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  Cor                                        │
│  ● ● ● ● ●                                  │  ← 5 pares, o ativo com anel
│                                             │
│  Ícone                                      │
│  ┌───────────────────────────────────────┐  │
│  │ [Buscar ícone...]                     │  │
│  │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢                       │  │
│  │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢                       │  │  ← grade rolável, 24 ícones
│  │ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢                       │  │
│  └───────────────────────────────────────┘  │
│                                             │
├─────────────────────────────────────────────┤
│                      Cancelar     Salvar    │
└─────────────────────────────────────────────┘
```

**Preview ao vivo** no topo: o tile atualiza a cada mudança de nome, cor ou ícone. É o que transforma o formulário de burocracia em escolha — o usuário vê o resultado antes de confirmar.

**ColorPicker** — 5 swatches dos pares `cat-1` a `cat-5`. Cada um é um `<button role="radio">` de 36px mostrando o fundo com o traço dentro. Navegação por seta, `aria-checked`.

**IconPicker** — grade de 24 ícones ([Anexo C](#anexo-c--biblioteca-de-ícones-de-categoria)) com busca por nome e sinônimos em português (`"comida"` acha `utensils`; `"carro"` acha `car`). Grade com `role="radiogroup"`, navegação por setas, 8 colunas.

**Validação**
- Nome obrigatório, 1–24 caracteres
- Duplicata detectada no cliente antes do POST (a API retorna 409 — hoje isso vira um `alert()` cru)
- Erro inline no campo, com `role="alert"`, nunca `alert()`
- Botão `Salvar` em `loading` durante o request

### 4.5 Exclusão com consequência explícita

`ConfirmDialog` que mostra o impacto real, buscado antes de abrir:

> **Excluir a categoria "Mercado"?**
> 38 transações ficarão sem categoria.
> O orçamento de R$ 2.000/mês vinculado a ela será excluído.
> Esta ação não pode ser desfeita.
>
> `Cancelar` · `Excluir categoria` (danger)

Quando não há vínculos, o texto encolhe para uma linha. Nada de aviso genérico onde a consequência é conhecida.

### 4.6 Normalizar `colorKey`

Inconsistência atual: o seed grava `colorKey: "1"`…`"5"`, mas `categories.service.ts:60` usa `colorKey: input.colorKey || "cb1"` como padrão. Duas convenções no mesmo campo.

Padronizar em `"1"`–`"5"`:
- `categories.service.ts` → default `"1"`
- Validação Zod → `z.enum(["1","2","3","4","5"])` em create e update
- Idem para `icon` → `z.enum([...ICON_KEYS])`
- Helper de leitura no cliente tolerante a legado: `"cb1"` e `"1"` resolvem para `1`; valor desconhecido cai em `1`

Sem migração de schema — só normalização de valor.

### 4.7 Propagação: onde as categorias voltam a aparecer

Consequência direta desta fase, aplicada nas telas existentes:

| Tela | Mudança |
|---|---|
| Transações (tabela) | Seta genérica → `CategoryTile sm`. Chip cinza → `CategoryChip` colorido |
| Dashboard (últimas transações) | Idem, tile `sm` |
| Detalhe da transação | Botões de categoria ganham tile + cor; o selecionado usa a cor da própria categoria, não `bg-primary` para todas |
| Orçamentos (cards) | Tile `md` ao lado do nome |
| Assinaturas (tabela) | Coluna de categoria com `CategoryChip` |
| Relatórios (barras) | `bg-emerald-600`/`teal`/`cyan`/`lime` rotativos → cor real de cada categoria, estável entre renders |
| Selects de categoria | `renderOption` com tile + nome |

Este item é o que devolve ao app o visual do protótipo.

---

## Fase 5 — Correções por tela

> **Modelo: Claude Sonnet 5** como padrão em todas as dez telas. A esta altura os tokens, os primitivos e os ícones já existem: cada item vira substituir marcação à mão por componente compartilhado.
> **Exceções — Claude Opus 5**, marcadas em linha abaixo: a extração do `BudgetsPage.tsx` (732 linhas em quatro arquivos), o anel de progresso das metas, o reposicionamento do drawer de notificações, os estados de erro por página (6.6) e a miniatura de tema no Perfil.

| Tela | Modelo | Observação |
|---|---|---|
| 5.1 `AppLayout` | Sonnet 5 | Menu do avatar com `Sair` precisa de fechamento por `Esc` e clique externo — reaproveite o padrão do `Select` em vez de reescrever |
| 5.2 `DashboardPage` | Sonnet 5 | O gráfico com dados reais já foi resolvido em 2.6 |
| 5.3 `TransactionsPage` | Sonnet 5 | Debounce e chips de filtro ativo |
| 5.4 `BudgetsPage` | **Opus 5** | Extrair 732 linhas em 4 arquivos sem perder estado compartilhado entre abas; o anel de progresso com `stroke-dasharray` real |
| 5.5 `ReportsPage` | Sonnet 5 | Agrupar cauda longa a partir da 8ª categoria |
| 5.6 `ProfilePage` | Sonnet 5 · **Opus 5** na miniatura de tema | A miniatura precisa renderizar a paleta oposta à ativa, fora do `.dark` — é o único ponto do app que escapa da comutação por classe |
| 5.7 `LoginPage` | Sonnet 5 | Composição em duas colunas espelhando o onboarding |
| 5.8 `OnboardingPage` | Sonnet 5 | Crossfade entre slides |
| 5.9 `NotificationDrawer` | **Opus 5** | Trocar `top-16 right-10` por posicionamento relativo ao sino, com foco entrando e voltando |
| 5.10 `TransactionDetailModal` | **Opus 5** | Corrigir a violação das Rules of Hooks (6.1) enquanto migra para `<Modal>` |

### 5.1 `AppLayout.tsx`

- Emojis de tema → `SunIcon`/`MoonIcon` com `aria-label` e crossfade em `--dur-fast`
- Nav ativa: além de cor, indicador de 2px sob o item, animado em `--dur-base`
- Item `Categorias` inserido na nav
- Botão `Sair` sai do topbar — ação destrutiva não fica ao lado de navegação. Move para menu do avatar, junto com `Perfil`
- Badge de notificação: `animate-pulse` removido; contagem numérica quando ≥ 1
- `<main>` recebe `key` da rota para disparar o `fade-up` de transição
- Topbar ganha `border-b` que só aparece após scroll (`--dur-fast`)
- `.focus-ring` em todos os botões e `NavLink`

### 5.2 `DashboardPage.tsx`

- **Gráfico com dados reais** (ver 2.6) — prioridade máxima
- Setas `◀ ▶` → `ChevronLeft/RightIcon` em botões de 36px com `aria-label` (`"Mês anterior"`)
- Nome do mês em `text-display-xl`; `capitalize` substituído por formatação explícita (`toLocaleDateString` em pt-BR já entrega minúscula; `capitalize` do CSS falha em `"1º de..."`)
- `🏦` → `BankIcon`
- Card consolidado: `Saldo do Período` → `Saldo`, valores em `text-num-xl` com `tabular-nums`; saldo negativo em `--expense`
- Banner de não-categorizadas: copy corrigida, tile no lugar do círculo com número solto
- Widgets padronizados em `Card variant="widget"` com `p-6` e `gap-4` — hoje variam entre `gap-3`, `gap-4` e `gap-5`
- Botões `min-h-[42px]` e `min-h-[40px]` lado a lado → ambos `h-ctl`
- Skeleton reflete a geometria real dos cards

### 5.3 `TransactionsPage.tsx`

- Os 3 `<select>` → `<Select>`; o de categoria com tile colorido nas opções
- Busca com debounce de 300ms, sem `<form>`; botão de limpar quando há texto; `search` entra nas deps do `useEffect`
- Chip de filtro ativo abaixo da barra, com `×` para remover e ação `Limpar filtros`
- Tabela: `CategoryTile sm` no lugar da seta genérica; `CategoryChip` no lugar do retângulo cinza
- Valores com `tabular-nums`; despesa em `--text-primary`, receita em `--income` (mantém o padrão atual, agora consistente)
- Linha clicável vira `<tr tabIndex={0}>` com `Enter`/`Space` e `.focus-ring` — hoje só responde a mouse
- `<th>` com `scope="col"`
- Contagem e total do filtro no rodapé da tabela
- Estado vazio distingue "sem transações" de "sem resultado para o filtro"

### 5.4 `BudgetsPage.tsx` (732 linhas)

- Extrair as três abas em `BudgetsTab.tsx`, `GoalsTab.tsx`, `SubscriptionsTab.tsx`; os 3 modais viram `<Modal>` + `<Field>`
- Abas com `role="tablist"`/`role="tab"`, navegação por seta, indicador deslizante animado em `--dur-base`
- Os 3 blocos idênticos de botão contextual no header colapsam em um, com rótulo derivado da aba ativa
- Cards de orçamento: `CategoryTile md`; `Badge` no lugar da pílula manual; `ProgressBar`
- `bg-emerald-100` / `bg-red-100` / `bg-amber-100` sem par escuro → tokens `*-soft`
- `bg-emerald-200` no hover do toggle de assinatura (sem variante dark) → `Badge` interativo
- Badge `Pluggy Auto` → `Automática`
- Anel de progresso das metas: hoje é `border-4 border-primary-light border-t-primary` — um spinner estático que **não representa o percentual**. Trocar por SVG com `stroke-dasharray` real, animado em `--dur-slow`
- Os 9 `alert()`/`confirm()` → `useToast()` / `useConfirm()`

### 5.5 `ReportsPage.tsx`

- Barras nas cores reais das categorias (fim da rotação por índice)
- `CategoryTile sm` ao lado de cada nome
- Cards de resumo: `text-num-xl`, `tabular-nums`
- `Taxa de Poupança` → `Taxa de poupança`; negativa em `--expense`
- Filtro de período (`Select`: mês atual / 3 meses / 6 meses / ano / tudo) — hoje a página busca **todas** as transações sem filtro e rotula como `"Baseado em todas as despesas"`
- Ordenação decrescente mantida; agrupar cauda longa em `Outras (n)` expansível a partir da 8ª categoria
- Barras animam na montagem com stagger de 40ms

### 5.6 `ProfilePage.tsx`

- Subtítulo removido
- Seção de categorias → linha de resumo com link para `/categorias`
- `🏦` → `BankIcon`; `☀️`/`🌙` → `SunIcon`/`MoonIcon`
- Seletor de tema: cards com **miniatura real** do app (retângulo com topbar, card e barra na paleta correspondente) em vez de ícone solto. Terceira opção `Sistema`, alinhada com `prefers-color-scheme`
- `item.status` cru (`UPDATED`, `LOGIN_ERROR`) → `Badge` com rótulo em português e severidade correspondente
- Estado vazio com `EmptyState` + ação, sem menção a `.env`
- `"Carregando conexões..."` → `Skeleton`
- Os 7 `alert()`/`confirm()` → toast/dialog

### 5.7 `LoginPage.tsx`

- Suporte a tema escuro (0 → completo, resolvido pelos tokens)
- Card de credenciais do seed **removido**; campos iniciam vazios
- Erro: `bg-red-50` → `--error-soft`, com `AlertIcon` e `role="alert"`
- Botão em `h-ctl-lg`, com `loading`
- Painel de marca à esquerda em telas largas, espelhando o onboarding — hoje o login é um card solto num fundo vazio, enquanto o onboarding tem composição em duas colunas
- `autoComplete="email"` / `"current-password"`

### 5.8 `OnboardingPage.tsx`

- Slides com crossfade `fade-up` na troca — hoje o conteúdo troca instantaneamente
- Dots viram controles reais: `role="tablist"`, `aria-label="Slide 2 de 3"`, `.focus-ring`
- `bg-primary-light dark:bg-emerald-950/60` → `--primary-soft`
- Setas de teclado `←`/`→` navegam
- Copy revisada (2.4)
- Botão `Pular` com peso menor que `Continuar` — hoje competem

### 5.9 `NotificationDrawer.tsx`

- **Modo escuro completo** — 0 ocorrências de `dark:` hoje, painel branco sobre app escuro
- `top-16 right-10` hardcoded → posicionamento relativo ao botão
- `bg-red-50/50` / `bg-amber-50/50` → `--error-soft` / `--warning-soft`
- Ícone por severidade no lugar do ponto colorido
- Timestamp relativo (`"há 2 h"`) com `title` no formato completo
- Entrada `fade-down`; `Esc` fecha; foco entra no painel ao abrir e volta ao sino ao fechar
- `role="dialog" aria-label="Notificações"`
- Estado vazio com `EmptyState`

### 5.10 `TransactionDetailModal.tsx`

- **Corrigir violação das Rules of Hooks** (ver 6.1)
- Migrar para `<Modal>` — ganha `Esc` e focus trap
- Seleção de categoria: botões com tile + cor real; o selecionado usa a cor da própria categoria
- Lista de categorias com `max-h-36 overflow-y-auto` sem indicação de rolagem → máscara de gradiente na borda inferior
- `Tipo de Movimentação` → `Tipo`; `Receita (Entrada)` → `Receita`
- Checkbox de recorrência → `Switch` (é uma preferência, não um item de lista)
- `alert("Erro ao atualizar transação")` → erro inline + toast
- Valor e data em `tabular-nums`

---

## Fase 6 — Defeitos funcionais

Encontrados durante a varredura. Corrigir antes da camada visual.

> **Modelo: Claude Opus 5 na fase inteira.** É a única em que o plano descreve o sintoma sem poder descrever a correção — cada item exige ler o código, confirmar a causa e escolher o conserto. Um bug de fuso corrigido pela metade e um gráfico com dados falsos são exatamente as falhas que passam despercebidas numa revisão rápida.
> **Exceções — Claude Haiku 4.5:** 6.4 (`border-1.5` inválido), 6.5 (variável não usada), 6.7 (apagar `HomePage.tsx`) e 6.8 (remover ícones sem uso). São quatro edições de uma linha com endereço exato.

### 6.1 Hooks depois de early return — crash em produção

`TransactionDetailModal.tsx:19-21`

```tsx
if (!transaction) return null;          // ← retorno antes dos hooks
const [description, setDescription] = useState(transaction.description);
```

`ConnectAccountModal.tsx:21-25` tem o mesmo padrão com `if (!isOpen) return null`.

Viola as Rules of Hooks: a contagem de hooks muda entre renders. Abrir um modal, fechar e abrir outro dispara `"Rendered more hooks than during the previous render"`.

**Correção:** mover o early return para depois de todos os hooks, ou condicionar a montagem no pai (`{selectedTx && <TransactionDetailModal ... />}`).

### 6.2 Navegação de mês com bug de fuso

`DashboardPage.tsx:31-37`

```tsx
const targetDate = new Date();
targetDate.setMonth(targetDate.getMonth() + monthOffset);   // horário local
const currentMonthStr = `${targetDate.getUTCFullYear()}-${...getUTCMonth()+1...}`;  // UTC
```

Mistura leitura local e escrita UTC. Em UTC−3, no dia 1º antes das 03:00 local, `getUTCMonth()` ainda aponta para o mês anterior — o dashboard abre no mês errado.

**Correção:** usar componentes locais consistentemente, ou construir a data com `Date.UTC(y, m, 1)` e ler só em UTC. Extrair para `lib/date.ts` — a mesma formatação está repetida em 4 arquivos.

### 6.3 Classes de animação mortas

11 usos de `animate-in` sem o plugin instalado. Resolvido pela Fase 3.

### 6.4 Classe Tailwind inválida

`ConnectAccountModal.tsx:104` — `border-1.5` não existe no Tailwind; a borda não renderiza. Fica `border` + `border-dashed`.

### 6.5 Variável não usada

`ConnectAccountModal.tsx:41` — `const { accessToken } = await getConnectToken();` e `accessToken` nunca é usado. O modal chama `getConnectToken()` e descarta o resultado, depois chama `syncItem()` — o widget Pluggy Connect nunca é aberto. Componente está morto de qualquer forma (6.7), mas se for reativado, o fluxo precisa ser terminado.

### 6.6 Sem estado de erro em nenhuma página

As 6 páginas fazem `catch (err) { console.error(...) }` e caem num estado vazio indistinguível de "não há dados". Com a API fora do ar, o app diz `"Nenhuma movimentação encontrada neste mês."`

**Correção:** estado `error` em cada página, com `EmptyState` de falha + botão `Tentar novamente`. `Skeleton` durante `loading`, nunca texto `"Carregando..."`.

### 6.7 Arquivos mortos

- `pages/HomePage.tsx` — nenhuma importação; contém `👋` e o texto `"Fase 1 concluída: login funcionando de ponta a ponta."`
- `components/connect/ConnectAccountModal.tsx` — nenhuma importação; 200 linhas com lista de bancos hardcoded

Decisão necessária: `ConnectAccountModal` faz parte do roadmap (é uma tela do protótipo) ou o fluxo de conexão fica só no `.env`? Se for roadmap, entra no plano com o widget Pluggy real; se não, é deletado. **Pendente de sua decisão.** `HomePage.tsx` é deletado nos dois casos.

### 6.8 Ícones não usados

`WalletIcon`, `FilterIcon`, `ChevronDownIcon` — nenhum uso. `ChevronDownIcon` passa a ser usado pelo `Select`; os outros dois saem, a menos que entrem na biblioteca de categorias.

### 6.9 Rótulos sem associação

Nenhum dos ~12 inputs tem `<label htmlFor>` ligado a um `id`. Resolvido pelo `Field`.

### 6.10 Chaves de tradução ausentes em datas

`toLocaleDateString("pt-BR")` repetido em 11 lugares com opções diferentes. Centralizar em `lib/format.ts`: `formatDate`, `formatDateTime`, `formatRelative`, `formatCurrency`, `formatPercent`. `formatCurrency` está redefinido inline em 5 arquivos.

---

## Fase 7 — Limpeza

> **Modelo: Claude Haiku 4.5.** Exclusão de arquivo, remoção de token do config e substituição das 44 cores cruas pelo mapa do Anexo A. Tudo com destino conhecido.
> **Exceção — Sonnet 5:** centralizar `lib/format.ts` e `lib/date.ts` (as 5 definições inline de `formatCurrency` e os 11 usos de `toLocaleDateString` têm opções divergentes que precisam ser conciliadas, não copiadas) e converter os `console.error` de fluxo normal em tratamento de erro real.

- Deletar `pages/HomePage.tsx`
- Deletar ou completar `components/connect/ConnectAccountModal.tsx` (pendente 6.7)
- Remover `WalletIcon` e `FilterIcon` se não entrarem na biblioteca
- Remover do `tailwind.config.js`: `dark-*`, `primary-light`, `primary-dark`, `cb1`–`cf5`
- Eliminar as 44 cores cruas do Tailwind
- Eliminar os 9 `transition-all`
- Eliminar todos os tamanhos de fonte arbitrários (`text-[14.5px]` e similares)
- Centralizar formatação em `lib/format.ts` e `lib/date.ts`
- `console.error` de fluxo normal → tratamento de erro real
- Rodar `tsc --noEmit` e confirmar zero avisos de import não usado

---

## 12. Ordem de execução

Cada etapa deixa o app em estado funcional.

| # | Etapa | Modelo | Depende de | Entrega |
|---|---|---|---|---|
| 1 | **Fase 0** — tokens, tema escuro neutro, escalas | Sonnet 5 (Opus 5 no contraste) | — | App inteiro com paleta cinza correta; as duas telas quebradas no escuro passam a funcionar sozinhas |
| 2 | **Fase 6** — defeitos funcionais | **Opus 5** (Haiku 4.5 em 6.4/6.5/6.7/6.8) | — | Crash de hooks, bug de mês e gráfico falso corrigidos |
| 3 | **Fase 3** — motion | Sonnet 5 | 1 | Transições reais no lugar das 11 classes mortas |
| 4 | **Fase 1** — primitivos (Button, Field, Select, Modal, Badge, ProgressBar, Toast, ConfirmDialog, Card, CategoryTile) | **Opus 5** em Select/Modal/ConfirmDialog · Sonnet 5 no resto | 1, 3 | Selects customizados; fim dos 18 diálogos nativos |
| 5 | **Fase 4** — categorias | **Opus 5** (Haiku 4.5 nos 24 ícones) | 4 | Página `/categorias` com ícone e cor; propagação para 7 telas |
| 6 | **Fase 2** — copy e emojis | Haiku 4.5 · Sonnet 5 em 2.3/2.4/2.6/2.7 | 4 | Zero emoji, capitalização única, sem vazamento de `.env` |
| 7 | **Fase 5** — passada tela a tela | Sonnet 5 (Opus 5 em 5.4/5.9/5.10) | 1–6 | Consistência final |
| 8 | **Fase 7** — limpeza | Haiku 4.5 (Sonnet 5 na centralização de formatação) | 7 | Diff limpo |

Etapas 1 e 2 são independentes e podem ser feitas em paralelo — e usam modelos diferentes, então rodá-las em paralelo não desperdiça nada.

**Uma ressalva sobre paralelizar por modelo.** A tabela sugere separar por custo, mas as fases não são independentes fora do par 1+2: a Fase 4 depende dos primitivos da Fase 1, e a Fase 5 depende de quase tudo. Trocar de modelo no meio de uma sessão longa também descarta o cache de prompt, que é por modelo. Rode cada fase inteira num modelo só e troque nas fronteiras.

---

## 13. Checklist de verificação

Rodar ao fim da etapa 7, nos dois temas, em 1280px e 1600px (o app é desktop; largura mínima suportada 1024px).

> **Modelo: Claude Opus 5.** Verificação é o oposto de execução — o valor está em achar o que passou despercebido, e um bloco que falha silenciosamente (contraste 4.3:1, foco invisível num controle, salto de layout no skeleton) é justamente o que uma passada barata não pega. Os quatro primeiros blocos (Tokens) são grep puro e podem rodar em **Haiku 4.5**; do bloco Tema escuro em diante, use Opus 5.

**Tokens**
- [ ] Zero `dark:` fora de opacidade e sombra
- [ ] Zero cor crua do Tailwind (`emerald-*`, `red-*`, `amber-*`, `blue-*`, `teal-*`, `cyan-*`, `lime-*`)
- [ ] Zero `rounded-3xl` / `rounded-md` / `rounded-lg` fora da escala
- [ ] Zero tamanho de fonte arbitrário
- [ ] Todo valor monetário com `tabular-nums`

**Tema escuro**
- [ ] Nenhuma superfície com dominante verde (checar cada `--surface*` e `--border*`)
- [ ] Verde apenas em ação, link, aba ativa, progresso, foco e badge positivo
- [ ] Login e drawer de notificações corretos no escuro
- [ ] Contraste ≥ 4.5:1 em texto corpo, ≥ 3:1 em texto grande e bordas de controle, nos dois temas
- [ ] Troca de tema sem flash e sem salto de layout

**Motion**
- [ ] As 11 classes `animate-in` substituídas e visíveis
- [ ] Zero `transition-all`
- [ ] `prefers-reduced-motion` desliga tudo (testar com a flag do SO)
- [ ] Nenhuma animação infinita fora de skeleton e spinner

**Componentes**
- [ ] Os 4 `<select>` nativos substituídos; teclado completo em cada um
- [ ] Os 18 `alert()`/`confirm()` substituídos
- [ ] Todo controle interativo com `.focus-ring` visível
- [ ] `Tab` percorre a página inteira sem foco invisível
- [ ] Todo modal fecha com `Esc`, com foco preso e devolvido
- [ ] Nenhum modal fecha em clique no overlay (ver 1.3) — o clique errado ao
      lado de um formulário não pode custar o preenchimento
- [ ] Todo input com `<label htmlFor>`

**Categorias**
- [ ] `/categorias` na nav e funcional
- [ ] Criar, editar e excluir com ícone e cor
- [ ] Exclusão mostra a consequência real (transações + orçamento)
- [ ] Cor e ícone aparecem nas 7 telas listadas em 4.7
- [ ] Barras de relatório com cor estável por categoria

**Cara de IA**
- [ ] Zero emoji no `src/` (rodar o scan do Anexo B)
- [ ] Zero Title Case em português
- [ ] Zero menção a `.env`, `PLUGGY_ITEM_IDS` ou `Pluggy` na copy visível
- [ ] Credenciais do seed removidas do login
- [ ] Os 4 subtítulos redundantes removidos
- [ ] Gráfico do dashboard sem dado inventado

**Estados**
- [ ] Loading, vazio, erro e sucesso em cada uma das 7 telas
- [ ] Estado de erro distinto de estado vazio
- [ ] Skeleton com a geometria do conteúdo real (sem salto)
- [ ] Descrição longa de transação trunca com reticências, sem quebrar a linha

**Código**
- [ ] `tsc --noEmit` limpo
- [ ] Arquivos mortos removidos
- [ ] `formatCurrency` e formatação de data em um único lugar
- [ ] Detector do Impeccable rodado sobre os arquivos alterados; achado de "Inter" registrado como exceção deliberada (fonte do protótipo)

---

## Anexo A — Mapa de tokens

Substituição mecânica, aplicável com busca e substituição.

| Antes | Depois |
|---|---|
| `bg-bg dark:bg-dark-bg` | `bg-bg` |
| `bg-surface dark:bg-dark-surface` | `bg-surface` |
| `bg-surface-alt dark:bg-dark-surface-alt` | `bg-surface-alt` |
| `border-border dark:border-dark-border` | `border-border` |
| `divide-border dark:divide-dark-border` | `divide-border` |
| `text-text-primary dark:text-dark-text-primary` | `text-text-primary` |
| `text-text-secondary dark:text-dark-text-secondary` | `text-text-secondary` |
| `bg-primary-light` | `bg-primary-soft` |
| `text-primary-dark dark:text-primary-light` | `text-primary` |
| `hover:bg-primary-dark` | `hover:bg-primary-hover` |
| `bg-emerald-50 dark:bg-emerald-950/40` | `bg-income-soft` |
| `bg-red-50 dark:bg-red-950/40` | `bg-expense-soft` |
| `bg-amber-50 dark:bg-amber-950/40` | `bg-warning-soft` |
| `bg-emerald-100 dark:bg-emerald-950/60` | `bg-income-soft` |
| `bg-red-100 dark:bg-red-950/60` | `bg-error-soft` |
| `bg-blue-50 dark:bg-blue-950/60` | `bg-surface-alt` |
| `text-blue-700 dark:text-blue-300` | `text-text-secondary` |
| `rounded-3xl` (modal) | `rounded-modal` |
| `rounded-2xl` (card) | `rounded-panel` |
| `rounded-xl` (controle) | `rounded-ctl` |
| `rounded-lg` / `rounded-md` (tile) | `rounded-tile` |
| `h-10` / `min-h-[40px]` / `min-h-[42px]` | `h-ctl` |
| `h-11` / `h-12` | `h-ctl` ou `h-ctl-lg` conforme papel |
| `min-h-[36px]` | `h-ctl-sm` |
| `min-h-[52px]` | `h-ctl-lg` |
| `text-[14.5px]` | `text-body` |
| `text-[11px]` / `text-[10.5px]` | `text-caption` |
| `text-[10px]` | `text-overline` |
| `transition-all` | Listar propriedades |
| `shadow-sh1` / `sh2` / `sh3` | Mantidos (agora comutam por tema) |

---

## Anexo B — Inventário de emojis e glifos

| Arquivo | Linha | Glifo | Substituto |
|---|---|---|---|
| `components/connect/ConnectAccountModal.tsx` | 134 | 🔒 | `ShieldIcon` (ou arquivo deletado) |
| `components/layout/AppLayout.tsx` | 83 | ☀️ | `SunIcon` |
| `components/layout/AppLayout.tsx` | 85 | 🌙 | `MoonIcon` |
| `pages/DashboardPage.tsx` | 109 | ◀ | `ChevronLeftIcon` |
| `pages/DashboardPage.tsx` | 119 | ▶ | `ChevronRightIcon` |
| `pages/DashboardPage.tsx` | 290 | • | `·` com `aria-hidden` |
| `pages/DashboardPage.tsx` | 347 | 🏦 | `BankIcon` |
| `pages/HomePage.tsx` | 13 | 👋 | Arquivo deletado |
| `pages/LoginPage.tsx` | 59 | •••••••• | Mantido (placeholder de senha) |
| `pages/LoginPage.tsx` | 82 | 💡 | Bloco removido |
| `pages/ProfilePage.tsx` | 189 | 🏦 | `BankIcon` |
| `pages/ProfilePage.tsx` | 197 | • | `·` com `aria-hidden` |
| `pages/ProfilePage.tsx` | 266 | ☀️ | `SunIcon` |
| `pages/ProfilePage.tsx` | 280 | 🌙 | `MoonIcon` |
| `pages/ProfilePage.tsx` | 315 | × | `CloseIcon` |

Scan de verificação:

```bash
node -e "const fs=require('fs'),p=require('path');const re=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{FE0F}]/gu;(function w(d){for(const f of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,f.name);if(f.isDirectory())w(q);else if(/\.(tsx|ts|css)$/.test(f.name)){fs.readFileSync(q,'utf8').split('\n').forEach((l,i)=>{if(re.test(l))console.log(q+':'+(i+1)+'  '+l.trim())})}}})('apps/desktop/src')"
```

Ícones novos necessários: `SunIcon`, `MoonIcon`, `BankIcon`, `ChevronLeftIcon`, `ShieldIcon`, `AlertIcon`, `MoreIcon`, `TrashIcon`, `EditIcon`, `SortIcon`.

---

## Anexo C — Biblioteca de ícones de categoria

`lib/categoryIcons.tsx` — chave → componente, com sinônimos em português para a busca.

**Cobertura do seed** (obrigatória — 11 categorias já existem no banco com estas chaves):

| Chave | Categoria do seed | Desenho |
|---|---|---|
| `wallet` | Renda | Carteira |
| `cart` | Mercado | Carrinho de compras |
| `home` | Moradia | Casa |
| `car` | Transporte | Carro |
| `film` | Lazer | Tela com play |
| `utensils` | Restaurante | Garfo e faca |
| `repeat` | Assinaturas | Setas circulares |
| `pulse` | Saúde | Batimento |
| `sofa` | Casa | Sofá |
| `device` | Eletrônicos | Celular |
| `dots` | Outros | Três pontos |

**Complemento do picker** (13, totalizando 24):

`plane` (viagem) · `gift` (presentes) · `book` (educação) · `dumbbell` (academia) · `paw` (pets) · `shirt` (roupas) · `fuel` (combustível) · `phone` (telefone/internet) · `coffee` (café) · `tools` (manutenção) · `heart` (doações) · `briefcase` (trabalho) · `ticket` (eventos)

Especificação: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth="1.8"`, `strokeLinecap="round"`, `strokeLinejoin="round"`. Desenho legível a 14px. `folder` é o fallback quando a chave é desconhecida.

Mapa de sinônimos para busca:

```ts
const SYNONYMS: Record<string, string[]> = {
  cart:     ["mercado", "supermercado", "compras", "feira"],
  utensils: ["comida", "restaurante", "almoço", "jantar", "delivery"],
  car:      ["carro", "transporte", "uber", "combustível", "ônibus"],
  home:     ["casa", "moradia", "aluguel", "condomínio"],
  pulse:    ["saúde", "médico", "farmácia", "remédio", "plano"],
  film:     ["lazer", "cinema", "streaming", "netflix", "diversão"],
  // ...
};
```

---

## Anexo D — Reescrita de copy

Alterações de texto visível ao usuário. Nada altera semântica de dado ou nome de rota.

### Títulos e navegação

| Local | Antes | Depois |
|---|---|---|
| `ProfilePage` H1 | Perfil & Configurações | Perfil |
| `ReportsPage` H1 | Relatórios & Análise de Gastos | Relatórios |
| `BudgetsPage` H1 | Planejamento | Planejamento *(mantido)* |
| Dashboard | Últimas Transações do Mês | Últimas transações |
| Dashboard | Saldo do Período | Saldo |
| Dashboard | Fluxo Mensal (Entradas x Saídas) | Entradas e saídas |
| Relatórios | Distribuição de Gastos por Categoria | Gastos por categoria |
| Perfil | Contas Bancárias (Open Finance) | Contas conectadas |
| Perfil | Aparência do Aplicativo | Aparência |
| Perfil | Categorias Personalizadas (11) | Categorias · 11 |
| Assinaturas | Gasto Mensal Recorrente | Gasto mensal recorrente |

### Botões

| Antes | Depois |
|---|---|
| Entrar na sua conta | Entrar |
| Sincronizar Todas as Contas | Sincronizar tudo |
| Sincronizar Contas | Sincronizar |
| Criar Primeiro Orçamento | Criar orçamento |
| Definir Primeira Meta | Criar meta |
| Cadastrar Assinatura | Cadastrar assinatura |
| Salvar Orçamento / Salvar Meta | Salvar |
| Criar Categoria | Salvar |
| Encerrar Sessão | Sair |
| Salvar alterações | Salvar |

### Estados vazios

| Local | Antes | Depois |
|---|---|---|
| Orçamentos | Defina limites mensais para suas categorias favoritas e receba alertas inteligentes antes de estourar o limite. | Defina um limite mensal por categoria e receba um aviso antes de estourar. |
| Metas | Defina seus objetivos financeiros (viagens, reserva de emergência, compras) e calcule o ritmo ideal de economia. | Defina um objetivo e veja quanto guardar por mês. |
| Assinaturas | Cadastre seus serviços recorrentes ou conecte seu banco para que o Poup identifique suas assinaturas automaticamente. | Cobranças recorrentes são identificadas automaticamente nas suas faturas. Você também pode cadastrar uma. |
| Transações | Não encontramos nenhuma movimentação com os filtros selecionados. Tente limpar os filtros ou sincronizar suas contas bancárias. | Nenhuma transação com esses filtros. |
| Relatórios | Cadastre despesas para visualizar o comparativo detalhado por categorias. | Sem despesas no período. |
| Perfil / conexões | Nenhuma instituição sincronizada. Verifique se as variáveis de ambiente (PLUGGY_ITEM_IDS) estão configuradas no .env. | Nenhuma instituição conectada ainda. |

### Onboarding

| Slide | Antes | Depois |
|---|---|---|
| 1 | Conecte suas contas e cartões bancários e veja o quadro completo da sua vida financeira, atualizado sozinho todos os dias. | *(mantido — é o texto do protótipo)* |
| 2 | Acompanhe o consumo das suas categorias com alertas inteligentes e descubra o ritmo ideal para realizar seus sonhos. | Acompanhe o gasto de cada categoria e veja quanto guardar por mês para chegar às suas metas. |
| 3 | Detecção automática de cobranças recorrentes para você nunca mais ser pego de surpresa na fatura. | Cobranças recorrentes identificadas automaticamente, antes de virarem surpresa na fatura. |

### Segurança

| Antes | Depois |
|---|---|
| **Conexão 100% segura via Open Finance.** A Poup. nunca tem acesso à sua senha bancária e não realiza movimentações ou transferências. | **Conexão somente leitura via Open Finance.** A Poup. não guarda sua senha e não movimenta seu dinheiro. |

*(o texto de destino é o do protótipo, `Poup Web.dc.html:86`)*

### Mensagens de erro

Todas passam de `alert()` para toast ou erro inline, com causa e saída:

| Antes | Depois |
|---|---|
| `Erro ao salvar orçamento` | Não foi possível salvar o orçamento. Tente novamente. |
| `Erro ao criar meta` | Não foi possível criar a meta. Tente novamente. |
| `Erro ao atualizar transação` | Não foi possível salvar as alterações. |
| `Erro ao sincronizar contas` | Não foi possível sincronizar. Verifique sua conexão. |
| `Categoria "X" já existe` (via alert) | Inline no campo: Já existe uma categoria com esse nome. |
| `Sincronização concluída!\nContas: 3\n...` | Toast: **Sincronização concluída** — 3 contas · 128 transações · 4 assinaturas |
