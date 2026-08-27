# Conta conjunta

Status: aprovado, aguardando plano de implementação.

## Problema

Duas pessoas que dividem a vida financeira têm hoje duas contas de Poup que não
se falam. Cada uma vê metade do dinheiro do casal e nenhuma vê o todo: o
orçamento de mercado é feito duas vezes, a mesma despesa aparece na conta de
quem pagou e some para o outro, e a pergunta que importa — "quanto **nós**
gastamos este mês?" — não tem onde ser respondida.

O que se quer é um espaço conjunto: um convite por e-mail, aceito pelo sininho,
e dali em diante os dois enxergam a soma, com o histórico anterior de cada um
já incluído.

## Decisões tomadas

Quatro perguntas foram decididas antes deste documento, e o resto do desenho é
consequência delas:

1. **Espaço conjunto de verdade**, e não visão somada por cima de dados
   separados. Categorias, orçamentos e metas deixam de ser de cada um e passam a
   ser do casal. Contas bancárias e transações continuam com dono.
2. **A fusão funde homônimos automaticamente.** "Mercado" dos dois vira um
   "Mercado" só, e as transações de quem aceitou o convite são remapeadas. Sem
   guardar de-para.
3. **Sair dissolve o espaço e cada um leva uma cópia** das categorias,
   orçamentos e metas do casal, com as próprias transações religadas à sua cópia.
4. **Filtro por pessoa nas telas** — "Todos / Fulano / Beltrano" —, com a foto de
   perfil de cada um, no mesmo formato do filtro de contas, que já mostra a logo
   da instituição.

## Onde mora a posse

O eixo do desenho é uma divisão por natureza do dado.

| Vai para o espaço (`householdId`) | Continua com dono (`userId`) |
|---|---|
| `Category` | `Item` |
| `Budget` | `Account` |
| `Goal` | `Transaction` |
| | `CreditCardBill` |
| | `CategorySuggestion` |
| | `Notification` |

Categoria, orçamento e meta são o que o casal decide junto — um "Mercado" só, um
teto de R$ 1.200 só, uma meta de viagem só. Já a transação tem dono no sentido
de **de quem é o dinheiro**, e é justamente isso que dá lastro ao filtro por
pessoa. Não é uma fronteira de permissão: dentro do espaço, qualquer membro
categoriza, edita e apaga qualquer transação (ver *Permissões*).

A alternativa era carregar `householdId` também na transação, tornando toda
leitura um `where: { householdId }` de coluna única. Foi descartada por duas
razões: perderia o dono — e com ele o filtro por pessoa —, e obrigaria o aceite
do convite a reescrever cada linha de transação do parceiro, um trabalho de
tamanho desconhecido dentro dos 60 segundos que a função da Vercel tem.

Com a divisão acima, a leitura somada é `userId: { in: memberIds }`, que
continua servida pelos índices `[userId, date]` e `[userId, competenceDate]` que
já existem, e o aceite do convite mexe só em categorias, orçamentos e metas —
dezenas de linhas, não dezenas de milhares.

## Modelo de dados

```prisma
/// O espaço em que categorias, orçamentos e metas vivem.
///
/// Todo usuário tem um desde o cadastro, mesmo sozinho: sem isso a fusão teria
/// de lidar com dois casos (tem espaço / não tem) e a leitura precisaria de um
/// fallback para `userId` em toda consulta.
model Household {
  id        String   @id @default(uuid())
  createdAt DateTime @default(now())

  members    User[]
  categories Category[]
  budgets    Budget[]
  goals      Goal[]
  invites    HouseholdInvite[]
}
```

`User` ganha `householdId String` (obrigatório) e a relação. Não há tabela de
associação: um usuário pertence a exatamente um espaço, e os membros são
`user.findMany({ where: { householdId } })`.

`Category` troca `userId` por `householdId`, e os índices únicos acompanham:
`@@unique([householdId, name])` e `@@unique([householdId, systemKey])`.
`Budget` idem, com `@@unique([householdId, categoryId])`.

`Goal` troca `userId` por `householdId` e **ganha** `createdByUserId`. A meta
precisa de dono para a dissolução saber para qual lado mandá-la, e o
`accountId` não serve: ele é anulável de propósito, e meta sem conta ficaria
sem destino.

```prisma
enum HouseholdInviteStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
}

/// Convite para entrar num espaço. O e-mail é guardado junto do `inviteeId`
/// para que o registro continue legível depois — quem convidou precisa ver
/// para quem mandou, e o nome do outro pode mudar.
model HouseholdInvite {
  id           String                @id @default(uuid())
  householdId  String
  inviterId    String
  inviteeId    String
  inviteeEmail String
  status       HouseholdInviteStatus @default(PENDING)
  createdAt    DateTime              @default(now())
  respondedAt  DateTime?

  household Household @relation(fields: [householdId], references: [id], onDelete: Cascade)
  inviter   User      @relation("InvitesSent", fields: [inviterId], references: [id], onDelete: Cascade)
  invitee   User      @relation("InvitesReceived", fields: [inviteeId], references: [id], onDelete: Cascade)

  @@index([inviteeId, status])
  @@index([householdId, status])
}
```

Um índice único parcial garante um convite pendente por par, e é o que impede
convite duplicado por corrida em vez de por `findFirst`:

```sql
CREATE UNIQUE INDEX "HouseholdInvite_pendente_por_par"
  ON "HouseholdInvite" ("householdId", "inviteeId")
  WHERE "status" = 'PENDING';
```

### Migração

Escrita à mão, em quatro passos, porque nenhum deles o Prisma gera sozinho:

1. Cria `Household` e `HouseholdInvite`.
2. `ALTER TABLE "User" ADD COLUMN "householdId" TEXT` (nulo por ora), cria **um
   espaço por usuário existente** e aponta cada um para o seu, num único
   `UPDATE ... FROM` com CTE modificadora. Depois `SET NOT NULL` e a FK.
3. Em `Category`, `Budget` e `Goal`: adiciona `householdId`, preenche com
   `SELECT "householdId" FROM "User" WHERE id = tabela."userId"`, torna
   obrigatório, e **só então** derruba `userId` e recria os índices únicos.
   Em `Goal`, `createdByUserId` é criado nulo, recebe o `userId` antigo e só
   então vira obrigatório — na mesma ordem, e pelo mesmo motivo, que o
   `householdId` do `User`.
4. Recria os índices únicos sobre `householdId`.

O banco de desenvolvimento é compartilhado e tem **uma segunda conta real** além
da do desenvolvedor. A migração é escrita para valer sobre todas as linhas, sem
`WHERE` de usuário; nenhum passo apaga dado.

Derrubar `Category.userId` é intencional e é a principal rede de segurança do
trabalho: todo `where: { userId }` em `categories.service`, `budgets.service` e
`goals.service` vira erro de compilação, e nenhum site escapa por esquecimento.

## O escopo da requisição

Um objeto resolvido uma vez por requisição, em `apps/api/src/lib/scope.ts`:

```ts
export interface Scope {
  /** Quem está agindo. Dono do que for criado e sujeito das permissões. */
  userId: string;
  /** O espaço em que categorias, orçamentos e metas vivem. */
  householdId: string;
  /** Todos os membros, em ordem de entrada. É o que a leitura somada usa. */
  memberIds: string[];
}
```

Um middleware `withScope`, montado logo depois de `requireAuth`, faz um
`findUnique` em `User` pela chave primária e um `findMany` dos membros do
espaço, e grava em `req.scope`. São duas idas ao banco de poucos milissegundos —
a função e o Neon estão os dois em `gru1` —, e nenhuma delas pode ir para o JWT:
entrar num espaço mudaria o escopo e o token velho continuaria valendo até
expirar.

As assinaturas dos serviços mudam de `(userId: string, ...)` para
`(scope: Scope, ...)` em tudo que lê ou escreve dado de usuário. Não é
cosmético: é o que transforma "esqueci de somar o parceiro nesta consulta" de um
bug silencioso num erro do compilador.

### O filtro por pessoa, e o buraco que ele abre

As rotas de leitura de transações, dashboard e relatórios aceitam
`?owner=<userId>`. A resolução é uma função só:

```ts
export function ownerIds(scope: Scope, owner?: string): string[] {
  if (!owner || owner === "all") return scope.memberIds;
  if (!scope.memberIds.includes(owner)) {
    throw new ForbiddenError("Este usuário não faz parte da sua conta conjunta");
  }
  return [owner];
}
```

A checagem de pertinência não é opcional. Sem ela, `?owner=<id de qualquer
usuário>` lê a vida financeira de um estranho — a rota está autenticada, o que
faltaria é justamente a autorização. Isto tem teste próprio.

## A fusão, no aceite do convite

Tudo dentro de um `prisma.$transaction`. Chamemos `A` o espaço de quem convidou
(o destino) e `B` o de quem aceita (a origem).

**Casamento de nomes.** Uma `normalizeCategoryName` própria — minúsculas, sem
acento (NFD + faixa combinante), espaços colapsados. Não se reaproveita a
`normalizeDescription` da categorização: aquela derruba stopwords como "conta" e
"pagamento", que em nome de categoria são conteúdo e não ruído.

Para cada categoria de `B`, nesta ordem:

1. **Casa por `systemKey`**, quando houver. As três categorias de sistema
   ("Transferência entre contas", "Sem categoria", "Pagamento de fatura")
   existem nos dois lados e são a mesma coisa por definição, mesmo que uma tenha
   sido renomeada.
2. **Casa por nome normalizado** contra as categorias de `A`.
3. **Não casou:** a categoria migra inteira — `UPDATE "Category" SET
   "householdId" = A`. Nada a remapear, porque as transações já apontam para ela.

Quando casou, `bCat` é absorvida por `aCat`:

- `transaction.updateMany({ where: { categoryId: bCat.id }, data: { categoryId: aCat.id } })`
- `categorySuggestion.updateMany` para `categoryId` **e** para
  `resolvedCategoryId` — são duas colunas apontando para categoria, e esquecer a
  segunda deixa a fila de revisão com referência morta.
- O orçamento: se `A` e `B` têm limite para a mesma categoria, os dois valores
  são **somados** num só; se só `B` tem, ele migra para `A`.
- `bCat` é apagada.

**Colisão de nome no que migra.** Se uma categoria de `B` não casou por
`systemKey` nem por nome normalizado mas ainda assim bate com o
`@@unique([householdId, name])` de `A` — dois nomes que normalizam igual mas se
escrevem diferente, ou dois "Sem categoria" com `systemKey` distintos —, a
absorção do passo 2 já cobriu o caso comum. O que sobrar entra com sufixo
`" (2)"`, e a fusão não quebra por causa de um unique.

**Metas** vão inteiras: `goal.updateMany({ where: { householdId: B }, data:
{ householdId: A } })`. Não há nome único, logo não há colisão.

Ao final: `user.update` aponta quem aceitou para `A`, o `HouseholdInvite` vira
`ACCEPTED` e o espaço `B` — agora vazio — é apagado. Quem convidou recebe uma
notificação: "Fulano aceitou seu convite."

Os outros convites pendentes que envolvem quem aceitou precisam morrer junto, e
são de duas naturezas. Os **enviados a partir de `B`** somem sozinhos: a FK de
`householdId` é `onDelete: Cascade` e o espaço deixou de existir. Os
**recebidos de outros espaços** não — vivem sob o `householdId` de um terceiro —
e viram `CANCELLED` explicitamente, ou quem aceitou continuaria com um convite
de outra pessoa esperando resposta numa tela que já não faz sentido.

Ordem de grandeza: uma dúzia ou duas de categorias, dois `updateMany` cada.
Cabe com folga nos 60 segundos.

## A dissolução, na saída

Também num `$transaction`, e simétrica por construção. Para **cada** membro:

1. Cria um `Household` novo.
2. Copia todas as categorias do espaço, guardando o de-para `antigo → novo` em
   memória (só durante a transação — não vira tabela).
3. Remapeia as transações **daquele membro** para as cópias dele, e as
   `CategorySuggestion` dele em `categoryId` e `resolvedCategoryId`.
4. Copia os orçamentos, com o mesmo limite. Um teto de R$ 1.200 do casal vira
   R$ 1.200 para cada um; foi a escolha feita ao decidir "cópia idêntica", e a
   tela avisa disso antes de confirmar.
5. Leva as metas cujo `createdByUserId` é dele. Metas do outro não são copiadas
   — meta é de quem a criou.
6. Aponta o usuário para o espaço novo.

O espaço antigo, esvaziado, é apagado. Ambos recebem notificação.

Sair é **dissolver**, e não "um sai e o outro fica": com dois membros os dois
casos são o mesmo, e tratá-los como um só evita o desenho assimétrico que a
abordagem de `PartnerLink` teria imposto. Com três ou mais membros — que o
modelo suporta e a UI desta versão não oferece — a regra vale igual.

Num espaço de um membro só, `POST /household/leave` responde 422: não há de
quem se separar, e dissolver ali seria trocar o espaço do usuário por outro
idêntico — trabalho e risco por nada. A tela nem oferece o botão nesse estado.

## Permissões dentro do espaço

Membro do espaço pode tudo com dado do espaço, com duas exceções, e cada uma
tem um motivo concreto:

| Ação | Quem pode | Por quê |
|---|---|---|
| Categorizar, editar, apagar transação | Qualquer membro | É o ponto da conta conjunta |
| Criar/editar categoria, orçamento, meta | Qualquer membro | São do casal |
| Ver contas e saldos do outro | Qualquer membro | É o ponto da conta conjunta |
| Editar apelido/tipo/vencimento de uma conta | Qualquer membro | É preferência de exibição, e a tela é compartilhada |
| **Sincronizar ou desconectar uma conexão da Pluggy** | Só o dono | Roda com as credenciais Pluggy cifradas **dele**; um erro de login é problema dele para resolver |
| **Perfil, senha, credenciais Pluggy** | Só o dono | Nunca foi dado do espaço |
| **Convidar e remover membro** | Qualquer membro | Espaço de casal não tem hierarquia |

## Convite e notificação

Não há infraestrutura de e-mail nem web push no projeto, e esta feature não
introduz nenhuma das duas. O convite alcança apenas quem **já tem conta no
Poup**, e chega pelo sininho.

```
GET    /api/household                    estado: membros, convites enviados e recebidos
POST   /api/household/invites            { email }
POST   /api/household/invites/:id/accept
POST   /api/household/invites/:id/decline
DELETE /api/household/invites/:id        cancelar um que eu enviei
POST   /api/household/leave              dissolve o espaço
```

`POST /invites` recusa, com mensagem própria para cada caso: e-mail sem conta no
Poup ("não encontramos ninguém com este e-mail"), o próprio e-mail, alguém que
já está num espaço com mais de um membro, alguém que já é membro do meu, e
convite pendente repetido. O e-mail é comparado sem diferenciar maiúsculas.

**A resposta ao convite não mora na notificação.** A notificação é a que já
existe — título, corpo e `link` —, apontando para `/perfil#conjunta`; é lá que o
cartão do convite tem os botões Aceitar e Recusar. Isso mantém o modelo
`Notification` intocado e resolve a ambiguidade de uma notificação com botões
que continua na lista depois de respondida.

## Telas

**Perfil** ganha a seção "Conta conjunta", com âncora `#conjunta`:

- Sozinho: explicação de uma linha e o campo de e-mail para convidar.
- Convite recebido pendente: cartão com quem convidou (foto e nome), o que vai
  acontecer com as categorias, e Aceitar / Recusar.
- Convite enviado pendente: para quem, e Cancelar.
- Em espaço conjunto: os membros com foto e nome, e "Sair da conta conjunta",
  atrás de um `ConfirmDialog` que diz o que a saída faz — cada um leva uma cópia
  das categorias e orçamentos, e o teto de cada orçamento vale inteiro para os
  dois.

**Filtro por pessoa** em Dashboard, Transações e Relatórios. É o mesmo `Select`
com `renderOption` que o filtro de contas já usa para desenhar a
`InstitutionLogo`, trocando-a pelo `UserAvatar` (`size="xs"`, que é o tamanho de
ícone de 24px e o que o componente já expõe para conviver com texto). Opções:
"Todos", depois um por membro, com foto e primeiro nome. O filtro **só aparece
quando o espaço tem mais de um membro** — sozinho, ele seria um seletor de uma
opção.

**Dono na linha da transação.** Quando o espaço tem mais de um membro, cada
linha da lista e o modal de detalhe mostram o `UserAvatar` do dono. O DTO da
transação ganha `ownerUserId`, e a tela cruza com os membros que já tem em mãos,
em vez de a API repetir nome e foto em cada linha.

**`fetchMe`** passa a devolver o espaço junto — membros (id, nome, foto) e
convites pendentes —, para que o `App` tenha essa informação desde o login e
nenhuma tela precise de uma requisição própria só para saber se deve desenhar o
filtro.

## Palpite de categoria em espaço conjunto

O motor de palpite aprende do histórico do usuário. Num espaço conjunto ele
passa a aprender do histórico **do casal**: quem entra hoje se beneficia das
centenas de transações que o outro já categorizou, e "Zé da Esquina" não precisa
ser ensinado duas vezes. As consultas de histórico em `similar.service` e
`categorization.service` passam a usar `scope.memberIds`.

A `CategorySuggestion` continua com dono — é a fila de revisão de quem
sincronizou —, mas qualquer membro pode resolvê-la.

## Notificações em espaço conjunto

`Notification` continua com dono, e não ganha `householdId`: uma notificação é
algo que **uma pessoa** leu ou não leu, e compartilhar a linha faria a leitura de
um apagar o aviso do outro. O que muda é quem recebe cada tipo.

**Alerta de orçamento** (`generateAutomaticAlerts`) passa a nascer do orçamento
do casal e a ser gravado **para cada membro** — uma linha por pessoa, com o
mesmo título e corpo. Estourar o teto de mercado é notícia para os dois, e a
deduplicação de sete dias que já existe passa a olhar por `userId` **e** título,
como hoje, o que continua correto com uma linha por pessoa.

**Aviso de transações sem categoria** (`createReviewNotification`) vai só para
quem rodou o sync — foi a ação dele que trouxe as linhas —, mas a contagem de
pendentes no título passa a ser a do espaço, porque a fila de revisão que a tela
abre também é. Sem isso o título prometeria um número e a tela mostraria outro.

**Convite e resposta ao convite** são notificações comuns, com `link` para
`/perfil#conjunta`.

## Correção avulsa: o nome da conta na transação

Fora do escopo da conta conjunta, e junto porque é de uma linha.

`accounts.service` tem a `resolveAccountName`, que dá precedência ao
`customName` sobre o `name` que o sync reescreve a cada atualização.
`goals.service` a usa. `transactions.service:99` **não**: monta o DTO com
`tx.account.name`, o nome cru do banco. Quem apelidou "Nubank" de "Cartão da
casa" vê o apelido no filtro de contas e no perfil, e "Nubank" na grid de
transações e no modal de detalhe.

A correção é no `TX_INCLUDE`: acrescentar `customName: true` ao `select` da
conta, estender o tipo do parâmetro de `formatTransactionDTO` e trocar
`tx.account.name` por `resolveAccountName(tx.account)`. Um ponto só, e as quatro
telas que consomem `accountName` — a grid (`TransactionsPage`, nas duas
larguras), o `TransactionDetailModal` e o `SimilarTransactionsModal` — se
corrigem juntas.

## Ordem de implementação

O trabalho tem uma ordem em que cada etapa deixa o app inteiro e testável, e
outra em que ele fica meses quebrado. A que serve:

1. **A correção do nome da conta.** Independente de tudo, de uma linha, e sai do
   caminho.
2. **Schema e migração**, com o `Scope` e o `withScope`, e todos os serviços
   reescritos para `(scope, ...)`. Ao fim desta etapa o app faz exatamente o que
   fazia antes — cada usuário sozinho no próprio espaço —, e é isso que prova que
   o refactor não quebrou nada. É a etapa longa, e é onde o compilador trabalha
   a favor.
3. **Convite**: modelo, rotas, notificação e a seção do perfil, com o aceite
   ainda recusando-se a fundir. Dá para mandar, receber, cancelar e recusar.
4. **Fusão e dissolução**, com os testes de cada uma antes do código que as faz.
5. **Filtro por pessoa e avatar do dono** nas telas — a parte que só faz sentido
   depois que dois usuários conseguem de fato dividir um espaço.

## Testes

Os testes de hoje mockam o `prisma`; a fusão e a dissolução seguem o mesmo
caminho, sem precisar de banco.

- `normalizeCategoryName`: acento, caixa, espaço, e o que **não** deve cair
  (as stopwords que a `normalizeDescription` derruba).
- Casamento de categorias na fusão: por `systemKey`, por nome normalizado, o que
  migra sem par, e a colisão de unique.
- Orçamento em duplicata: os limites somam.
- `CategorySuggestion`: `categoryId` **e** `resolvedCategoryId` remapeados.
- Dissolução: cada membro sai com cópia própria, nenhuma transação fica apontando
  para categoria de outro espaço, meta vai para o `createdByUserId`.
- `ownerIds`: `owner` de quem não é membro é recusado com 403.
- Convite: e-mail inexistente, próprio e-mail, membro já acompanhado, pendente
  repetido.
- `formatTransactionDTO`: `customName` ganha do `name`, e sem `customName` cai
  no `name`.

## Fora de escopo

- E-mail e web push. O convite só alcança quem já tem conta.
- Convidar quem ainda não é usuário (convite por link, cadastro pendente).
- Mais de dois membros na interface. O modelo aguenta; a tela desta versão fala
  de duas pessoas.
- Dividir despesa entre os dois ("esta é 50/50"). É outra feature, e grande.
- Papéis e permissões graduadas (leitor, editor, administrador).
- Guardar o de-para da fusão para desfazer o aceite. Foi decidido contra.
