# Modo claro mais suave — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tirar do modo claro o brilho que cansa a vista, sem perder identidade nem legibilidade. O card deixa de ser branco puro, o fundo desce junto para criar uma área de descanso, o texto sai do quase-preto sobre branco, e os acentos param de ser simultaneamente berrantes e ilegíveis.

**Architecture:** É um trabalho de **tokens**, não de varredura por componente. Todo o tema claro mora no bloco `:root` de `apps/web/src/index.css`, e o `tailwind.config.js` deriva cada classe de lá. A varredura confirmou **um único** valor de cor escrito à mão fora do sistema — `bg-white` em `InstitutionLogo.tsx:69`, que é proposital (a placa branca atrás do logo do banco). Nenhum arquivo `.tsx` precisa mudar por causa da cor, com uma exceção discutida na Task 6.

**Escopo:** só o tema claro. O bloco `.dark` **não é tocado** — e o plano tem um portão de verificação para provar isso.

---

## Decisões travadas com o usuário

| Decisão | Escolha | Consequência |
|---|---|---|
| Intensidade | **Papel** | Card sai do branco puro (L\*100 → 98,8) e o fundo desce (L\*97,9 → 93,1) |
| Escopo | **Neutros + Semânticas + Categorias** | As três camadas, nas Tasks 1–5 |
| Temperatura | **Manter o verde** | Os neutros seguem tingidos de verde (hsl ~145–150), a identidade não se mexe |

---

## Diagnóstico medido

Números apurados sobre os tokens atuais, não impressão. Contraste é WCAG 2.1; `L*` é lightness perceptual CIE; `dE` é distância CIELAB entre duas cores.

**1. A tela inteira é uma folha branca só.**

| | L\* | |
|---|---|---|
| `--surface` (card) | 100,0 | topo absoluto da escala |
| `--bg` (fundo) | 97,9 | |
| **separação** | **2,1** | o olho não tem onde descansar |

O card — que cobre a maior parte da tela — está no máximo de luminância possível. **Esta é a origem principal do incômodo.**

**2. A escala de elevação está invertida e comprimida.**

Hoje: `sunken` 93,7 < `alt` 95,3 < `bg` 97,9 < `surface` 100. Um botão secundário (`bg-surface-alt`) pousado no fundo da página é **2,6 mais escuro** que o fundo — ou seja, "elevado" é desenhado como afundado. E `alt → sunken` são só 1,57 de distância: dois tokens que são praticamente a mesma cor.

**3. Texto a 16,56:1.**

`--text-primary #16211C` sobre branco puro. WCAG AAA pede 7:1. Estamos a **2,4× além do AAA** — é a combinação clássica de halation que "queima" em leitura longa.

**4. Semânticas berrantes E ilegíveis ao mesmo tempo.**

| token | contraste no card | veredito |
|---|---|---|
| `--income #22C55E` | **2,28:1** | reprova até em 3:1 |
| `--warning #F5A524` | **2,04:1** | reprova até em 3:1 |
| `--expense #E85D4C` | **3,44:1** | reprova como texto |

Elas são usadas **como texto em 40 pontos** e como preenchimento em 27. `income` é hsl(142, **71%**, 45%) — um verde quase neon em alta luminância. Escurecer resolve o barulho e a ilegibilidade de uma vez só: é a mesma edição.

O pior caso não é texto sobre o card — é `text-income` sobre `bg-income-soft` no [`Badge.tsx:23`](../../../apps/web/src/components/ui/Badge.tsx). Todo valor novo tem que passar **ali**.

**5. Os fundos das categorias são decoração barulhenta que não informa nada.**

Este é o achado que reorienta a Task 5. Medindo a distinguibilidade par a par dos 16 chips:

| camada | menor dE | pares abaixo de dE 10 |
|---|---|---|
| **fundos** (`--cat-N-bg`) | **1,3** (Vermelho × Carmim) | **23 de 120** |
| **foregrounds** (`--cat-N-fg`) | **14,4** (Índigo × Roxo) | **0 de 120** |

O comentário da paleta diz "sem que duas vizinhas se confundam numa lista" — e isso é verdade **do foreground**, que carrega 100% do sinal de identidade. Os fundos já são indistinguíveis hoje: Vermelho e Carmim são a mesma cor para o olho a dE 1,3. E são justamente eles, com saturação de 78–100%, que geram o confete.

**Consequência:** o fundo pode cair pesado sem custo de informação. O foreground é **protegido**.

### Correção de uma afirmação minha

Na conversa eu disse que as bordas a **1,25:1 estavam "invisíveis"**. Está errado e não deve virar tarefa. Razão de contraste comprime muito no topo da escala; a métrica honesta para um fio de 1px é ΔL\*, e a borda atual está a **ΔL\* 8,65** do card — um fio perfeitamente legível. Um passe anterior desta análise chegou a derivar uma borda a 1,60:1 (`#BCCEC2`, ΔL\* 17), que teria deixado a interface pesada e encaixotada — o oposto do pedido. **A borda mantém a relação atual com o card** (ΔL\* ~8). O que ela precisa é só acompanhar a queda das superfícies.

---

## Global Constraints

- **Só `:root` muda.** O bloco `.dark` de `apps/web/src/index.css` fica byte a byte idêntico. A Task 7 prova isso com `git diff`.
- **Hex e `-rgb` andam juntos — este é o erro fácil.** O `tailwind.config.js` lê `rgb(var(--surface-rgb) / <alpha-value>)` para **superfícies e bordas**; atualizar só o hex deixa toda classe `bg-surface`, `bg-bg`, `border-border` com a cor antiga, e o bug fica invisível no CSS. Já `text`, `primary`, as semânticas e as categorias usam `color-mix(in srgb, var(--token) ...)` e precisam **só do hex**.
  - Precisam do par hex + `-rgb`: `bg`, `surface`, `surface-alt`, `surface-sunken`, `border`, `border-strong`.
  - Precisam só do hex: `text-*`, `primary*`, `income`, `expense`, `warning`, `error`, `info`, `cat-*`.
- **Nenhum `.tsx` muda por causa de cor**, salvo a exceção explícita da Task 6.
- **Nada de cor escrita à mão.** Todo valor entra como token em `:root`.
- **`--primary` tem três dependentes** que precisam ser recalculados junto: `--primary-ghost`, `--ring` e `--focus-color`. Esquecer deles deixa o anel de foco na cor velha.
- **Comentário explica o porquê, não o quê**, em português, no tom dos comentários já existentes no arquivo.
- **A verificação é medida, não olhada.** Os scripts da Task 7 são o portão; screenshot é confirmação, não prova.
- Web: `npm run test --workspace=apps/web` e `npx tsc --noEmit -p apps/web/tsconfig.json`.

---

## Mapa de arquivos

**Modificados**

| Arquivo | O que muda |
|---|---|
| `apps/web/src/index.css` | Bloco `:root`: superfícies, texto, marca, semânticas, 16 categorias, sombras |
| `apps/web/src/components/ui/Input.tsx` | Só se a Task 6 for aprovada |
| `docs/DESIGN-CORRECTIONS.md` | Anexo A (mapa de tokens), se listar valores literais |

**Criados**

| Arquivo | Responsabilidade |
|---|---|
| `apps/web/scripts/verificar-contraste.mjs` | Portão de verificação: lê os tokens do CSS e reprova a build se algum par cair abaixo do mínimo |

---

## Task 1 — Superfícies

- [ ] Substituir os seis pares de superfície em `:root`, **hex e `-rgb` juntos**:

```css
--bg:                 #E5EDE9;  --bg-rgb:             229 237 233;
--surface:            #FAFCFB;  --surface-rgb:        250 252 251;
--surface-alt:        #EFF5F2;  --surface-alt-rgb:    239 245 242;
--surface-sunken:     #DBE6E1;  --surface-sunken-rgb: 219 230 225;
--border:             #DEE7E1;  --border-rgb:         222 231 225;
--border-strong:      #BFD0C6;  --border-strong-rgb:  191 208 198;
```

- [ ] Comentar no arquivo **por que** o card não é mais branco puro (a folha pousada na mesa, não a folha iluminada).

**Resultado esperado, medido:**

| degrau | antes | depois |
|---|---|---|
| card → alt | 4,7 | 2,8 |
| alt → fundo | **−2,6 (invertido)** | **+3,0** |
| fundo → sunken | 4,2 | 2,7 |

A escala passa a ser monotônica: `sunken` < `bg` < `alt` < `surface`. Um botão secundário no fundo da página finalmente lê como elevado.

**Portão:** os quatro degraus entre superfícies vizinhas ficam em ΔL\* 2,5–3,5. Nenhum abaixo de 2,0 (viraria a mesma cor) nem acima de 5 (viraria degrau visível demais).

---

## Task 2 — Texto

- [ ] Aplicar:

```css
--text-primary:   #283832;   /* 11,98:1 no card — AAA com folga, sem o "queimado" de 16,56:1 */
--text-secondary: #55695F;   /* 4,60:1 no pior fundo real (surface-sunken) */
--text-disabled:  #90A398;   /* 2,59:1 — decorativo, não carrega informação */
```

- [ ] Comentar por que `text-primary` **deixou de buscar o contraste máximo**: 16,56:1 não é uma virtude, é halation.

**Resultado esperado:**

| token | card | alt | fundo | sunken |
|---|---|---|---|---|
| `text-primary` | 11,98 | 11,17 | 10,35 | 9,65 |
| `text-secondary` | 5,71 | 5,32 | 4,93 | **4,60** |

`text-secondary` foi resolvido contra `surface-sunken` de propósito — é o fundo mais escuro em que ele de fato aparece ([`InstallmentBadge.tsx:41`](../../../apps/web/src/components/transactions/InstallmentBadge.tsx), [`AppLayout.tsx:108`](../../../apps/web/src/components/layout/AppLayout.tsx)). Resolver contra o card teria deixado esses pontos reprovando.

**Portão:** `text-primary` ≥ 10:1 nas quatro superfícies; `text-secondary` ≥ 4,5:1 nas quatro.

---

## Task 3 — Marca e anel de foco

- [ ] Aplicar:

```css
--primary:        #247A56;
--primary-hover:  #1E6647;
--primary-active: #195439;
--primary-ghost:  rgba(36,122,86,.08);   /* rgb de #247A56 */
--ring:           0 0 0 3px rgba(36,122,86,.28);
--focus-color:    #247A56;
```

- [ ] Reconferir `--primary-soft: #A8E6C3`. Ele é um verde claro de 2013 na paleta atual; sobre o novo card ele fica alto demais. Levar para um véu no mesmo padrão das semânticas.

**Portão:** branco sobre `--primary` ≥ 4,5:1 (botão primário), e `--primary` como texto sobre o card ≥ 4,5:1. Medido: **5,26:1** e **5,10:1**.

---

## Task 4 — Semânticas

Cada valor foi resolvido por ponto fixo **contra o próprio `-soft`** — o caso do `Badge` — e não contra o card, porque resolver contra o card reprovava no Badge a 3,97–4,23:1.

- [ ] Aplicar:

```css
--expense: #B14C38;   /* antes #E85D4C — 3,44:1 */
--warning: #926224;   /* antes #F5A524 — 2,04:1 */
--error:   #C03B36;   /* antes #DC2626 */
--info:    #2F748C;   /* antes #1E6A80 */
```

- [ ] Baixar o alpha dos `-soft` de 0.10/0.12 para **0.09**, uniformemente. É o que permite que a cor base não precise ir tão escura.

### Decisão em aberto: `--income`

Ao trazer `income` para um contraste legível, ele **converge com `--primary`**: no melhor caso testado ficaram a 14° de matiz e ΔL\* 0,2 — praticamente a mesma cor. Isso é inevitável, porque contraste igual força luminância igual, e aí só o matiz separa.

**Recomendação: assumir a convergência e definir `--income: #247A56`, igual a `--primary`.** Num app financeiro, "dinheiro que entra" ser o verde da marca é coerente, e a regra do playbook é reduzir a variedade de cores, não preservá-la por inércia. O par que de fato importa para varrer a tela é entrada × saída, e esse continua sendo verde × vermelho.

**Alternativa,** se a separação for desejada: levar `income` para o territorio teal (matiz ~172, `#0A776E`). Custa uma cor a mais no sistema e afasta a receita do verde da marca.

- [ ] **Confirmar esta decisão com o usuário antes de aplicar.**

**Portão:** cada semântica ≥ 4,5:1 como texto **sobre o card** e **sobre o próprio `-soft`**. Medido: 5,10–5,20 no card, 4,53–4,58 no soft.

**Efeito colateral verificado (não é regressão):** as barras do gráfico em `bg-income/45` passam de verde neon para `#9EC0B9` (L\* 75, 1,91:1 com o card) — um verde-sálvia calmo. É exatamente o efeito pedido, mas **é a mudança visual mais perceptível de todo o plano**. Vale conferir por olho no `MonthlyFlowChart` antes de dar por fechado.

---

## Task 5 — Categorias: amansar o fundo, proteger o foreground

Guiado pelo achado do diagnóstico: o fundo não carrega sinal, o foreground carrega tudo.

- [ ] **Fundos:** derrubar para saturação ≤ 19% e L\* ~93,5, faixa uniforme. Os três "tons quebrados" (Café, Sálvia, Grafite) ficam a S 8–11%, preservando o papel deles de "para o que não quer cor".
- [ ] **Foregrounds:** manter os valores atuais, com uma exceção — dez deles reprovam ≥4,5:1 e são **escurecidos no mesmo matiz e saturação**, só descendo a lightness.

```css
--cat-1-bg:  #F0EBEB; --cat-1-fg:  #B91C1C; /* Vermelho */
--cat-2-bg:  #F0EBE9; --cat-2-fg:  #B94509; /* Laranja  * */
--cat-3-bg:  #EFECE9; --cat-3-fg:  #AD5009; /* Âmbar    * */
--cat-4-bg:  #EAEEE6; --cat-4-fg:  #4A770E; /* Lima     * */
--cat-5-bg:  #E7EEEA; --cat-5-fg:  #147A3A; /* Verde    * */
--cat-6-bg:  #E6EEED; --cat-6-fg:  #0A776E; /* Turquesa * */
--cat-7-bg:  #E8EEEF; --cat-7-fg:  #06748F; /* Ciano    * */
--cat-8-bg:  #EBEDF1; --cat-8-fg:  #2260EB; /* Azul     * */
--cat-9-bg:  #ECEBF1; --cat-9-fg:  #4F46E5; /* Índigo */
--cat-10-bg: #EEEBF1; --cat-10-fg: #7C3AED; /* Roxo */
--cat-11-bg: #F0EAF0; --cat-11-fg: #86198F; /* Fúcsia */
--cat-12-bg: #F0EBED; --cat-12-fg: #C9216C; /* Pink     * */
--cat-13-bg: #F0EBEC; --cat-13-fg: #D01B42; /* Carmim   * */
--cat-14-bg: #EEECEA; --cat-14-fg: #78543A; /* Café */
--cat-15-bg: #EAEDEB; --cat-15-fg: #47735E; /* Sálvia   * */
--cat-16-bg: #EBEDEE; --cat-16-fg: #475569; /* Grafite */
```

`*` = foreground escurecido para corrigir contraste **que já reprovava antes deste plano**.

- [ ] Reescrever o comentário da paleta. O atual credita a discriminabilidade à volta no círculo cromático dos fundos; a medição mostra que quem discrimina é o foreground. O comentário deve dizer isso, senão a próxima pessoa amansa o foreground achando que é decoração.

**Resultado esperado:**

| | antes | depois |
|---|---|---|
| faixa L\* dos fundos | 89,8 → 96,7 | 93,3 → 93,7 |
| faixa S dos fundos | 19% → 100% | 8% → 19% |
| pior contraste fg/chip | **3,01:1** | **4,53:1** |
| menor dE entre foregrounds | 14,4 | 10,1 |

**Atenção — o único ponto que aperta:** escurecer o Laranja para passar em contraste o aproxima do Âmbar, e esse par cai de dE 22,7 para **10,1**. Ainda acima do limiar de 10, mas é o par mais apertado da paleta. **Conferir Laranja e Âmbar lado a lado numa lista real antes de fechar.** Se não convencer, a saída é abrir o matiz do Âmbar alguns graus, não reverter o contraste.

---

## Task 6 — Duas decisões de token com dois trabalhos (opcional, requer aprovação)

Duas se revelaram na análise. Nenhuma é causada por este plano, e nenhuma precisa entrar agora — mas ambas ficam mais fáceis de resolver enquanto os tokens estão abertos.

- [ ] **`--border` serve fio de card e borda de campo.** [`Input.tsx:43`](../../../apps/web/src/components/ui/Input.tsx) usa `border-border`, então a borda do campo herda o peso de um fio decorativo. WCAG pede 3:1 para o contorno de um controle. Fazer toda borda de card ficar pesada seria o remédio errado. **Proposta:** o `Input` passa a usar `border-border-strong` em repouso — uma linha, sem tocar em nenhum outro componente.
- [ ] **`--income` serve texto e preenchimento.** Já tratado na Task 4.

---

## Task 7 — Portão de verificação

Escrever o verificador **antes** de olhar screenshot. Olho confirma; número reprova.

- [ ] Criar `apps/web/scripts/verificar-contraste.mjs`, que lê os tokens direto de `index.css` (não uma cópia) e reprova com exit ≠ 0 se:
  - `text-primary` < 10:1 em qualquer uma das quatro superfícies
  - `text-secondary` < 4,5:1 em qualquer uma das quatro
  - qualquer semântica < 4,5:1 no card **ou** sobre o próprio `-soft`
  - branco sobre `--primary` < 4,5:1
  - qualquer `cat-N-fg` < 4,5:1 sobre o seu `cat-N-bg`
  - menor dE entre dois `cat-N-fg` < 10
  - degraus entre superfícies vizinhas fora de ΔL\* 2,0–5,0
- [ ] Rodar o verificador nos **dois temas**. Ele deve passar no claro e no escuro — o escuro não mudou, então serve de controle: se reprovar lá, o bloco `.dark` foi contaminado.
- [ ] `git diff apps/web/src/index.css` e confirmar por leitura que **nenhuma linha do bloco `.dark` aparece**.
- [ ] `npx tsc --noEmit -p apps/web/tsconfig.json` e `npm run test --workspace=apps/web`.
- [ ] Rodar o detector mecânico do Impeccable: `node ~/.agents/skills/impeccable/scripts/detect.mjs --json apps/web/src/index.css`.
- [ ] Só então: subir o dev server e conferir por olho, em **um lote só**, claro e escuro, desktop e mobile. Telas que importam:
  - **Dashboard** — a mudança das barras do gráfico (Task 4) é a mais visível de todas
  - **Categorias** — o confete amansado, e o par Laranja × Âmbar da Task 5
  - **Transações** — chips de categoria em lista longa, que é o caso de uso real da paleta
  - **Perfil** — botões secundários sobre o fundo da página, que é o degrau invertido corrigido na Task 1
  - Um **modal** aberto — sombra tingida sobre o novo fundo

---

## Task 8 — Sombras e documentação

- [ ] Tingir as sombras. Preto puro sobre um tema de neutros verdes lê como sujeira cinza:

```css
--sh1: 0 1px 2px  rgba(31,58,45,.05);
--sh2: 0 4px 14px rgba(31,58,45,.06);
--sh3: 0 16px 40px rgba(31,58,45,.09);
```

O alpha cai junto (de .06/.07/.10): sobre um card que não é mais branco puro, a mesma sombra pesa mais.

- [ ] Atualizar o Anexo A de `docs/DESIGN-CORRECTIONS.md` se ele listar valores literais de token.
- [ ] Registrar no doc a razão de fundo — o modo claro deixou de perseguir contraste máximo — para que a próxima varredura não "conserte" o texto de volta para 16:1.

---

## Ordem de execução

1 → 2 → 3 → 4 → 5 → 8, com a Task 7 rodando **ao fim de cada uma**, não só no final. Cada task é um commit. A Task 6 fica fora da fila até ser aprovada.

A ordem não é arbitrária: as superfícies são o denominador de todo contraste medido depois. Mexer nas semânticas antes das superfícies obriga a refazer a conta.

---

## O que este plano deliberadamente NÃO faz

- **Não toca no modo escuro.** Ele não foi reclamado e a medição não achou problema.
- **Não engrossa as bordas.** ΔL\* 8,65 já é um fio legível; a razão de 1,25:1 é artefato da métrica no topo da escala, não um defeito. Ver a correção no diagnóstico.
- **Não redesenha nada.** Nenhum espaçamento, raio, peso de fonte ou layout muda. É recalibração de luminância e croma, e só.
- **Não uniformiza os foregrounds das categorias.** Um passe da análise tentou resolver todos para 4,55:1 e a distinguibilidade caiu de dE 14,4 para 10,1, porque a variação de lightness entre eles é parte do que os separa. Contraste uniforme teria custado informação.
