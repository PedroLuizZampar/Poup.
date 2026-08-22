# Fase 9 — Correções visuais + credenciais Pluggy por usuário + cadastro

> **Status: implementado.** O que a verificação mostrou está no fim do arquivo.

Decisões já tomadas com o usuário:

- **Migrar e remover do `.env`**: `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITEM_IDS`/`PLUGGY_ITEM_ID`/`PLUGGY_TEST_ITEM_ID` deixam de existir. Tudo passa a viver no banco, por usuário.
- **Adicionar conexão**: campo manual onde se cola o item id do painel Pluggy + validação na API (nome, logo e cor do conector) + sync imediato. Sem widget Pluggy Connect nesta fase.
- **Cadastro**: nome, email, senha, confirmação, client id e client secret — todos obrigatórios, com as credenciais validadas contra a Pluggy antes de criar a conta.

---

## Parte A — Correções visuais (independentes do resto; entram primeiro)

### A1. Logo das instituições não assenta no quadrado

Arquivo: [InstitutionLogo.tsx](apps/desktop/src/components/ui/InstitutionLogo.tsx)

1. **Reproduzir antes de corrigir**: subir o app (`npm run dev`), abrir Início e Perfil, e inspecionar o `<img>` real de cada instituição (dimensões naturais, tipo do arquivo, se é a URL da CDN Pluggy ou o data URL enviado pelo usuário). O sintoma da captura — círculo vermelho cortado nas bordas — pode ser logo não-quadrado, SVG sem `viewBox`, ou imagem que falhou e caiu num estado intermediário. A correção sai do que a inspeção mostrar, não do palpite.
2. Normalizar a caixa: `aspect-square` explícito, `overflow-hidden`, `img` como `block w-full h-full object-contain` e **padding proporcional ao tamanho** (`sm` → `p-1`, `md` → `p-1.5`, `lg` → `p-2`) em vez do `p-1` fixo de hoje, que sufoca o `lg` e deixa o `sm` encostando na borda.
3. Fundo previsível: hoje a cor da marca só é aplicada quando não há `customImageUrl`, então logo enviado pelo usuário e logo da Pluggy assentam sobre fundos diferentes na mesma lista. Unificar: fundo neutro claro para logo com transparência, cor da marca quando ela existe — mesma regra para as duas origens.
4. Arredondamento interno acompanha o container (logo não pode "vazar" o canto do tile).

### A2. Logos não aparecem em "Contas conectadas" no painel inicial

Arquivo: [DashboardPage.tsx:403](apps/desktop/src/pages/DashboardPage.tsx#L403)

O dashboard monta `<InstitutionLogo>` sem passar `customImageUrl` — o Perfil passa. Por isso a imagem que você escolheu à mão aparece no Perfil e some no Início, que cai para a URL da CDN da Pluggy. A API já devolve o campo (`accounts.service.ts` inclui `customImageUrl`), então é só repassar. Se a inspeção de A1 mostrar que a URL da CDN também falha em carregar dentro do Electron, tratar aqui (o `index.html` não define CSP hoje, então a hipótese é rede/URL, não bloqueio).

### A3. Tooltip do gráfico de histórico

Arquivo: [MonthlyFlowChart.tsx](apps/desktop/src/components/dashboard/MonthlyFlowChart.tsx)

Hoje o hover no grupo do mês acende **dois** balões simultâneos (um por barra), que se sobrepõem, são cortados pelo topo do gráfico, e ainda concorrem com um `title` nativo do navegador dizendo outra coisa. Reformular:

- **Um único tooltip por mês**, não um por barra: cabeçalho com o mês, linha de Receitas, linha de Despesas e o **saldo** do mês (o dado que hoje o leitor tem que calcular de cabeça), cada linha com o marcador da cor da barra.
- **Posicionamento que não corta**: âncora sobre o grupo com clamp dentro da área do gráfico, e reserva de espaço no topo do plot para o balão caber.
- **Remover o `title` nativo** das barras (fonte duplicada e atrasada de informação).
- **Acessível**: o grupo do mês vira alvo focável, o tooltip abre no `focus` além do `hover`, e o conteúdo textual completo fica disponível para leitor de tela.
- Hover state nas barras do mês ativo (leve realce) para o vínculo balão↔barra ficar óbvio.

---

## Parte B — Credenciais Pluggy por usuário (backend)

### B1. Schema e criptografia

- `User`: `pluggyClientId String?`, `pluggyClientSecret String?` (guardado **cifrado**, AES-256-GCM).
- Nova env — a única que sobra do bloco Pluggy: `APP_ENCRYPTION_KEY` (32 bytes, base64). Novo módulo `apps/api/src/lib/crypto.ts` com `encryptSecret`/`decryptSecret`.
- Migration Prisma + **migration de dados**: um script one-shot que lê os valores hoje presentes no `.env` e os grava (cifrados) no usuário existente, e cria os `Item` correspondentes aos item ids configurados. Rodar antes de remover as variáveis.
- `env.ts`: remover `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET`, `PLUGGY_ITEM_IDS`, `PLUGGY_ITEM_ID`, `PLUGGY_TEST_ITEM_ID` e a função `getConfiguredPluggyItemIds()`. Atualizar `.env.example`.

### B2. Cliente Pluggy por usuário

- [lib/pluggy.ts](apps/api/src/lib/pluggy.ts) deixa de exportar um singleton criado a partir do `.env` e passa a expor `getPluggyClientForUser(userId)`, com cache em memória por usuário invalidado quando as credenciais mudam.
- Erro dedicado `MissingPluggyCredentialsError` → 409 com mensagem acionável ("Configure suas credenciais Pluggy no Perfil"), para o front conseguir levar o usuário ao lugar certo.
- Todas as chamadas em `pluggy.service.ts` (`createConnectToken`, `fetchItem`, `fetchAccounts`, `fetchTransactions`, `deleteItem`) passam pelo cliente do usuário.
- `syncAllConfiguredItems` vira `syncAllItems(userId)`: itera os `Item` do usuário no banco, não uma lista do `.env`.

### B3. Novos endpoints

- `POST /pluggy/items` `{ pluggyItemId }` — valida o id na Pluggy, recusa duplicado (do próprio usuário e de outro), cria o `Item` com nome/logo/cor do conector e dispara o sync inicial. Erros distintos e legíveis para: id inexistente, credenciais inválidas, item de outra aplicação.
- `GET /auth/pluggy-credentials` — devolve `clientId` e `hasSecret`; **nunca** devolve o secret.
- `PATCH /auth/pluggy-credentials` `{ clientId, clientSecret }` — exige a senha atual (é credencial), valida contra a Pluggy antes de salvar, invalida o cache do cliente.
- Tipos correspondentes em `packages/shared`.

---

## Parte C — Cadastro de conta (backend)

- `POST /auth/register` `{ name, email, password, confirmPassword, pluggyClientId, pluggyClientSecret }`.
- Validações: email único (409), senha ≥ 8 (regra `MIN_PASSWORD_LENGTH` já existente), confirmação conferida também no servidor, credenciais Pluggy validadas com uma chamada real antes de criar o usuário (nada de conta criada com credencial que não funciona).
- Extrair as categorias padrão de `prisma/seed.ts` para um módulo reutilizável e semeá-las no registro — conta nova nasce utilizável.
- Resposta idêntica à do login (token + user) para auto-login.

---

## Parte D — Telas (`/impeccable`)

Contexto do skill já resolvido: o projeto **tem** sistema visual incumbente (tokens Tailwind, `Card`, `Field`, `Input`, `Button`, `Modal`) e não tem `PRODUCT.md`. Estas telas são **extensão** desse mundo visual, não redesenho — o caminho de refinamento escopado. Antes de editar UI, carregar `reference/craft-floor.md`; ao final, rodar o detector mecânico uma vez sobre os arquivos alterados. Modo **Operate**: o sucesso é a tarefa concluída, então escaneabilidade e previsibilidade vêm antes de expressão; a marca vive no detalhe.

### D1. Tela de cadastro

- Nova `SignupPage`, irmã visual da `LoginPage` (mesmo card centrado, mesma marca), com o `App.tsx` alternando entre login e cadastro e link recíproco nas duas.
- **Dois grupos declarados**, porque o formulário mistura duas coisas de naturezas diferentes: *Sua conta* (nome, email, senha, confirmação) e *Integração Pluggy* (client id, client secret). Sem os grupos, o usuário encara seis campos indiferenciados.
- Confirmação de senha valida **em tempo real** (mismatch aparece ao sair do campo, não só no submit); indicação de força mínima atendida.
- Client secret com toggle mostrar/ocultar e nota curta de onde tirar as credenciais (painel Pluggy → Applications). Sem link externo se não houver URL estável a citar.
- Estados completos: submit em loading, erro do servidor (email em uso, credencial Pluggy inválida) mapeado **para o campo culpado**, não só um alerta genérico no topo.
- Após cadastrar: auto-login e queda direta no app.

### D2. Perfil — seção "Integração Pluggy"

- Novo card no [ProfilePage](apps/desktop/src/pages/ProfilePage.tsx), acima de "Contas bancárias conectadas": mostra o client id em uso, o secret mascarado, e um botão *Alterar credenciais* que abre modal (padrão dos modais já existentes, com senha atual como confirmação).
- Estado de credencial ausente/ inválida é um estado de primeira classe: aviso claro no card e nas ações de sync que dependem dele.

### D3. Perfil — adicionar conexão por item id

- Na seção "Contas bancárias conectadas", ação *Adicionar conexão* → modal com um campo (item id), texto de ajuda de onde copiá-lo, validação e feedback do que foi importado ("Banco Inter conectado — 3 contas, 214 transações").
- Erros específicos e legíveis (id inválido, já conectado, credenciais não configuradas), não "erro ao sincronizar".
- Estado vazio da lista deixa de ser a frase solta de hoje e passa a apontar para essa ação.

---

## Parte E — Verificação

1. `npm run build` (shared + api + desktop) sem erros de tipo.
2. App rodando: login, cadastro de conta nova, credenciais no perfil, adicionar item id, sync, dashboard.
3. Rodada única e batelada de screenshots (Início, Perfil, Cadastro) para conferir A1/A2/A3 e as telas novas; corrigir tudo o que aparecer num lote só.
4. Detector do impeccable uma vez sobre os arquivos de UI alterados.
5. Relatar o que passou e o que não passou, com a saída real.

---

## Ordem de execução

**A** (correções visuais, isoladas) → **B** (backend por usuário + migração de dados, é o que destrava o resto) → **C** (registro) → **D** (telas, com o skill) → **E** (verificação).

## Riscos anotados

- A migração de dados do `.env` para o banco precisa rodar **antes** de as variáveis serem removidas, senão a conexão atual fica órfã. Passo explícito e verificado em B1.
- `Item.pluggyItemId` é `@unique` global; um item id já usado por outro usuário precisa de erro claro em vez de estouro de constraint.
- Guardar client secret cifrado depende de `APP_ENCRYPTION_KEY` estar presente: se sumir, os secrets ficam ilegíveis. A mensagem de erro tem que dizer isso em vez de falhar como "credencial inválida".


---

## Resultado da verificação

- `npm run build` (shared + api + desktop): limpo.
- Migration `20260819180000_user_pluggy_credentials` aplicada no Neon; script de dados migrou as credenciais do `.env` para o usuário (os dois itens já existiam no banco). Variáveis `PLUGGY_CLIENT_ID/SECRET/ITEM_IDS/ITEM_ID/TEST_ITEM_ID` removidas de `.env` e `.env.example`; entrou `APP_ENCRYPTION_KEY`.
- Credenciais lidas do banco autenticam na Pluggy (connect token obtido).
- `POST /auth/register` com credencial inválida: 422, campo `pluggyClientSecret`, **nenhum** usuário criado.
- Logos: as quatro imagens do painel inicial carregam (256×256, renderizadas 22×22 dentro do tile branco de 32px) e nenhuma extrapola a caixa.
- Gráfico: um balão por mês (173×104), dentro do card na horizontal e sem cortar no topo; nenhum `title` nativo remanescente.
- Adicionar conexão: id duplicado e id inexistente devolvem mensagens acionáveis.
- Detector do impeccable sobre os arquivos de UI alterados: sem achados.

**Não verificado:** captura de tela. O painel do navegador não estava sendo exibido nesta sessão, então as checagens visuais foram feitas por medição de geometria e contraste no DOM, não por inspeção de imagem.
