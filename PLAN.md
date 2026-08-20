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
11. Auto-categorização por palavras-chave (`apps/api/src/lib/categorization/`)
12. Nomes de instituição por tabela COMPE + nome do conector (`apps/api/src/lib/institutions.ts`)
13. Orçamentos: gasto por categoria/mês, status (ok/atenção/estourado)
14. Metas: progresso e ritmo mensal necessário, a partir do saldo da conta vinculada
15. Notificações de orçamento no limite e estourado, geradas no `POST /notifications/check`
16. `GET /reports/summary`: totais do período somados no banco (por tipo, por categoria e série mensal)
17. Erros como classes com status próprio + middleware único de tratamento

### Frontend
18. App React + Vite: roteamento e layout base
19. Design system: tokens do protótipo → Tailwind config, com tema claro/escuro
20. Onboarding (por usuário, depois do login)
21. Dashboard
22. Transações + modal de detalhe/categorização
23. Planejamento: abas de orçamentos e metas
24. Relatórios (distribuição por categoria, por período)
25. Categorias (criar, editar, excluir, com gasto do mês)
26. Perfil: conexões Pluggy, credenciais, foto e senha
27. Skeletons de carregamento, estados vazios, toasts e diálogos de confirmação
28. Painel de notificações

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

- **Sem teste automatizado.** Toda mudança é verificada à mão.
- **Dois sistemas de ícone** convivem: `Icons.tsx` (feito à mão) e `lucide-react` (usado por `categoryIcons.tsx`).
- **Dinheiro trafega como `number`** nos DTOs. Os agregados já são somados no banco; o que resta é a exibição.

## Credenciais e segredos

Em `apps/api/.env` (fora do controle de versão):

- `DATABASE_URL` (Neon)
- `JWT_SECRET`
- `APP_ENCRYPTION_KEY` — 32 bytes em base64, cifra o client secret da Pluggy no banco
- `CORS_ORIGINS` (opcional) — origens extras aceitas, além do dev server do Vite
- `PORT` (opcional) — `0` deixa o sistema escolher; hosts em nuvem costumam injetar a porta aqui

As credenciais da Pluggy (client id/secret) **não** ficam no ambiente: pertencem ao usuário e são cadastradas pelo app. A `apiKey` é obtida dinamicamente pelo backend e cacheada em memória.

