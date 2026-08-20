# Edição de metas/orçamentos, contas, perfil e renomeação para Planejamento

Data: 2026-08-19

## Escopo

Nove pedidos agrupados em uma única entrega:

1. Editar Metas e Orçamentos já criados.
2. Vincular meta a uma conta; o acumulado passa a ser o saldo dela.
3. Renomear contas.
4. Editar imagem de banco (sync não sobrescreve).
5. Editar foto de perfil, nome, email e senha.
6. Página de Orçamentos vira Planejamento (rota e nome).
7. Corrigir recorte do anel de foco no modal de detalhes da transação.
8. Despesas em vermelho (par do verde de receita).

## Banco de dados (migration única)

| Modelo | Mudança | Motivo |
|---|---|---|
| `User` | `+ avatarUrl String? @db.Text` | foto de perfil como data URL base64 |
| `Item` | `+ customImageUrl String? @db.Text` | override manual do logo; coluna separada de `institutionImageUrl` (a que o sync escreve), então o sync nunca a sobrescreve |
| `Account` | `+ customName String?` | nome renomeado; sync continua escrevendo `name`, exibição usa `customName ?? name` |
| `Goal` | `+ accountId String?` FK `onDelete: SetNull`; `- currentAmount` | acumulado deriva do saldo da conta |

`Goal.accountId` é nullable no banco (para não quebrar metas existentes nem
quando uma conta é excluída) mas **obrigatório na API** em create/update. Metas
com `accountId` nulo aparecem na UI com selo "Vincule uma conta".

`progress` e `remainingAmount` são calculados sobre o saldo da conta, com clamp
em 0 para saldos negativos (contas de crédito).

## API

- `PATCH /goals/:id` — passa a aceitar/exigir `accountId`; valida posse da conta.
- `PATCH /budgets/:id` — já existe (só `monthlyLimit`); só o front passa a usar.
- `PATCH /accounts/:id` — novo. `{ name }` grava `customName`; vazio/null reverte.
- `PATCH /items/:id/image` — novo. `{ imageUrl: string | null }` (data URL).
- `PATCH /auth/me` — novo. `{ name?, email?, avatarUrl? }`; trocar email exige
  `currentPassword` e valida unicidade (409 em conflito).
- `PATCH /auth/password` — novo. `{ currentPassword, newPassword }`, mínimo 8
  caracteres, rehash bcrypt.

Imagens: o cliente redimensiona para 256×256 via `<canvas>` e envia data URL
JPEG. Servidor valida prefixo `data:image/` e teto de 512KB. Sem multer.

## Front-end

- Rota `/orcamentos` → `/planejamento`; `BudgetsPage.tsx` → `PlanningPage.tsx`;
  label da sidebar e os dois links do Dashboard. A aba interna segue "Orçamentos".
- Cards de orçamento e meta ganham lápis de edição reabrindo o modal em modo
  edição. Orçamento: categoria travada. Meta: todos os campos + seletor de conta.
- Perfil: renomear conta vinculada; trocar/remover imagem do banco; editar perfil
  (nome, email, avatar) e alterar senha.
- `resolveInstitutionLogo` ganha precedência: custom > asset local > URL Pluggy.

## Correções

- `Modal` recorta o anel de foco verticalmente (`overflow-y-auto` +
  `outline-offset`). Já há remendo horizontal (`px-1.5 -mx-1.5`); adicionar o
  vertical (`py-1.5 -my-1.5`).
- Despesa em `text-expense` em TransactionDetailModal, DashboardPage e
  TransactionsPage (hoje `text-text-primary`).

## Verificação

Não há suite de testes no projeto. Verificação por `npm run build` (typecheck de
shared + api + desktop) e execução manual dos fluxos.
