export type TransactionType = "INCOME" | "EXPENSE";

/**
 * Os quatro primeiros vem da Pluggy. `DEBIT_CARD` nao: para ela um cartao de
 * debito e a conta corrente a que esta preso, entao o rotulo so existe quando o
 * usuario o escolhe a mao.
 */
export type AccountType =
  | "CHECKING"
  | "SAVINGS"
  | "CREDIT"
  | "DEBIT_CARD"
  | "INVESTMENT";

export type BudgetStatus = "ok" | "warning" | "exceeded";

export type SystemCategoryKey = "TRANSFER" | "UNCATEGORIZED" | "BILL_PAYMENT";

/**
 * Fixa e o que se repete com o mesmo valor todo mes — aluguel, mensalidade,
 * assinatura. Variavel e o resto. Vive na categoria, e nao na transacao: e
 * assim que a pessoa pensa nela, e e o que deixa o relatorio somar os dois
 * grupos sem depender de marcacao transacao a transacao.
 */
export type CategoryKind = "FIXED" | "VARIABLE";

export interface CategoryDTO {
  id: string;
  name: string;
  icon: string;
  colorKey: string;
  kind: CategoryKind;
  /** Preenchido nas categorias que o Poup mantém. Não aparecem em seletores. */
  systemKey: SystemCategoryKey | null;
}

export interface AccountDTO {
  id: string;
  /** Nome exibido: o customizado pelo usuario quando existe, senao o do banco. */
  name: string;
  /** Nome original vindo da Pluggy, preservado para permitir voltar atras. */
  originalName: string;
  /** Nome dado pelo usuario. Null quando ele nunca renomeou a conta. */
  customName?: string | null;
  /** O tipo **efetivo**: o escolhido pelo usuario quando existe, senao o da Pluggy. */
  type: AccountType;
  /** O que a Pluggy derivou. Preservado para permitir voltar atras. */
  originalType: AccountType;
  /** A escolha do usuario. Null quando ele nunca reclassificou a conta. */
  customType: AccountType | null;
  /** Dia do mes em que a fatura vence, 1 a 31. Obrigatorio em cartao de credito. */
  creditCardDueDay: number | null;
  balance: number;
  institution: string;
  institutionName: string;
  /** Logo da instituicao (URL do conector Pluggy). Null quando indisponivel. */
  institutionImageUrl?: string | null;
  /** Logo escolhida manualmente no item (data URL). Precede as demais. */
  customImageUrl?: string | null;
  itemId?: string | null;
  pluggyAccountId?: string | null;
  lastSyncedAt: string | null;
  /** Ligada, a conta nao entra nos cards de saldo do Dashboard. */
  excludedFromBalance: boolean;
}

export interface TransactionDTO {
  id: string;
  description: string;
  amount: number;
  type: TransactionType;
  date: string;
  note: string | null;
  isRecurring: boolean;
  accountId: string;
  accountName: string;
  categoryId: string | null;
  categoryName: string | null;
  /** Numero desta parcela. Null quando a compra nao foi parcelada. */
  installmentIndex: number | null;
  /** Total de parcelas. Anda junto com `installmentIndex`: ou vem os dois, ou nenhum. */
  installmentTotal: number | null;
  /**
   * Vencimento da fatura em que a transacao cai (ISO). Derivado do mes da fatura
   * mais o dia de vencimento da conta — nao e coluna, para que corrigir o dia do
   * cartao conserte todas as parcelas de uma vez.
   */
  dueDate: string | null;
  /**
   * O mes em que a transacao conta (ISO, sempre dia 1 quando vem de fatura).
   * Para cartao e o mes da fatura; para o resto e o proprio dia. E por ele que
   * relatorio, orcamento e a lista mensal somam.
   */
  competenceDate: string;
  /** Junta as parcelas de uma mesma compra. Null quando nao ha o que agrupar. */
  purchaseKey: string | null;
  /**
   * Une o estorno as parcelas que ele cancela, quando a pessoa compensou os
   * dois a mao. Null e o normal. Nao-null significa que esta linha esta fora
   * de todos os totais.
   */
  compensationId: string | null;
}

/**
 * Em que pe esta uma parcela.
 *
 * Sai do cruzamento da parcela com a fatura em que ela caiu, e nunca de
 * deducao: `FORECAST` cobre tanto a parcela que ainda nao foi para fatura
 * nenhuma quanto aquela cuja fatura o conector nao entrega. Chamar de vencida
 * uma parcela so porque a data passou pintaria de vermelho todo cartao cuja
 * fatura o app nao conseguiu importar.
 */
export type InstallmentStatus =
  /** A fatura em que ela caiu esta quitada. */
  | "PAID"
  /** A fatura fechou, o vencimento passou e ela nao consta como paga. */
  | "OVERDUE"
  /** Ja esta numa fatura, que ainda vai vencer. */
  | "OPEN"
  /** Ainda nao foi para fatura nenhuma — ou a fatura nao chegou ao app. */
  | "FORECAST";

export interface InstallmentDTO extends TransactionDTO {
  status: InstallmentStatus;
  /** Quando a fatura desta parcela foi quitada (ISO). Null fora de `PAID`. */
  paidAt: string | null;
}

export interface InstallmentsResponse {
  /** As parcelas da compra, ordenadas por numero. */
  installments: InstallmentDTO[];
  /** A soma das parcelas conhecidas — o valor da compra. */
  total: number;
  /** A soma das que ja estao pagas. */
  paidTotal: number;
}

export type CompensationIneligibleReason = "valor-diferente" | "ja-compensado";

export interface CompensationCandidateDTO {
  purchaseKey: string;
  description: string;
  /** ISO da data da compra, ou null quando o conector nao informou. */
  purchaseDate: string | null;
  installmentTotal: number;
  /** Quantas parcelas o app importou. Menor que o total significa historico cortado. */
  parcelasConhecidas: number;
  /** Total da compra, em reais. */
  total: number;
  elegivel: boolean;
  motivo: CompensationIneligibleReason | null;
  preSelecionada: boolean;
}

export interface CompensationCandidatesResponse {
  candidates: CompensationCandidateDTO[];
}

export interface CompensateRequest {
  purchaseKey: string;
}

/**
 * As duas pontas de uma compensacao ja feita, para a tela poder dizer *qual*
 * compra aquele estorno cancelou — e nao so que cancelou alguma.
 */
export interface CompensationDetailDTO {
  /** A ponta credito: o estorno que o banco lancou. */
  estorno: {
    id: string;
    description: string;
    amount: number;
    date: string;
  };
  /** A compra parcelada que o estorno cancela, somada. */
  compra: {
    purchaseKey: string | null;
    description: string;
    /** A soma das parcelas — o valor da compra, e nao o de uma parcela. */
    total: number;
    installmentTotal: number | null;
    parcelasConhecidas: number;
    purchaseDate: string | null;
  };
}

export interface CompensationDetailResponse {
  /** Null quando a transacao pedida nao esta compensada. */
  compensation: CompensationDetailDTO | null;
}

export interface BudgetDTO {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  categoryColorKey: string;
  monthlyLimit: number;
  spent: number;
  percentage: number;
  status: BudgetStatus;
}

export interface CreateBudgetRequest {
  categoryId: string;
  monthlyLimit: number;
}

export interface UpdateBudgetRequest {
  monthlyLimit: number;
}

export interface GoalDTO {
  id: string;
  name: string;
  targetAmount: number;
  /** Acumulado da meta: o saldo da conta vinculada, com piso em zero. */
  currentAmount: number;
  /** Conta cujo saldo alimenta a meta. Null quando a conta foi excluida. */
  accountId: string | null;
  accountName: string | null;
  targetDate: string | null;
  progress: number;
  remainingAmount: number;
  monthlyPaceNeeded: number | null;
  createdAt: string;
}

export interface CreateGoalRequest {
  name: string;
  accountId: string;
  targetAmount: number;
  targetDate?: string | null;
}

export interface UpdateGoalRequest {
  name?: string;
  accountId?: string;
  targetAmount?: number;
  targetDate?: string | null;
}

export interface UpdateAccountRequest {
  /** Novo nome. String vazia ou null volta ao nome original do banco. */
  name?: string | null;
  /** Ligada, a conta sai dos cards de saldo do Dashboard. */
  excludedFromBalance?: boolean;
  /** Reclassificacao manual. Null volta ao tipo que a Pluggy derivou. */
  customType?: AccountType | null;
  /** Dia do vencimento da fatura, 1 a 31. Obrigatorio quando o tipo efetivo e CREDIT. */
  creditCardDueDay?: number | null;
}

export interface UpdateItemImageRequest {
  /** Data URL da imagem, ou null para voltar ao logo do conector. */
  imageUrl: string | null;
}

export interface UpdateProfileRequest {
  name?: string;
  email?: string;
  /** Data URL da foto, ou null para remover. */
  avatarUrl?: string | null;
  /** Obrigatorio quando `email` muda. */
  currentPassword?: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface NotificationDTO {
  id: string;
  title: string;
  body: string;
  severity: "INFO" | "WARNING" | "ERROR";
  read: boolean;
  /** Rota do app para onde o item leva. Null = só informativo. */
  link: string | null;
  createdAt: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserDTO;
}

export interface CreateCategoryRequest {
  name: string;
  icon?: string;
  colorKey?: string;
  kind?: CategoryKind;
}

export interface UpdateCategoryRequest {
  name?: string;
  icon?: string;
  colorKey?: string;
  kind?: CategoryKind;
}

export interface CreateTransactionRequest {
  accountId: string;
  description: string;
  amount: number;
  type: TransactionType;
  date: string;
  categoryId?: string | null;
  note?: string | null;
  isRecurring?: boolean;
}

export interface UpdateTransactionRequest {
  description?: string;
  categoryId?: string | null;
  note?: string | null;
  isRecurring?: boolean;
}

export interface TransactionFilterQuery {
  month?: string; // YYYY-MM
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  accountId?: string;
  categoryId?: string;
  uncategorized?: boolean | string;
  type?: TransactionType;
  search?: string;
  /** Piso do valor absoluto da transacao, em reais. */
  minAmount?: number;
  /** Teto do valor absoluto da transacao, em reais. */
  maxAmount?: number;
  /** Teto de resultados. O painel usa 5 — ele so mostra as ultimas. */
  limit?: number;
}

export interface ItemDTO {
  id: string;
  pluggyItemId: string;
  institutionName: string;
  /** Logo da instituicao (URL do conector Pluggy). Null quando indisponivel. */
  institutionImageUrl?: string | null;
  /** Logo escolhida manualmente (data URL). Tem precedencia sobre as demais. */
  customImageUrl?: string | null;
  status: string;
  lastSyncedAt: string | null;
  /**
   * O webhook avisou que ha transacao nova nesta conexao e o sync ainda nao
   * rodou. O app nunca sincroniza sozinho: isto e um convite, nao um estado.
   */
  hasPendingSync: boolean;
  createdAt: string;
}

export interface SyncItemRequest {
  pluggyItemId?: string;
}

/**
 * Credenciais da aplicacao Pluggy do usuario, como o app pode ve-las: o secret
 * nunca sai da API, so a informacao de que existe um cadastrado.
 */
export interface PluggyCredentialsDTO {
  clientId: string | null;
  hasSecret: boolean;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  pluggyClientId: string;
  pluggyClientSecret: string;
}

export interface SyncItemResponse {
  item?: ItemDTO;
  itemsSynced?: number;
  accountsSynced: number;
  transactionsSynced: number;
}


// ==========================================
// RELATORIOS
// ==========================================

/** Periodos pre-definidos aceitos por GET /reports/summary. */
export type ReportPeriod = "current" | "3m" | "6m" | "year" | "all";

export interface ReportQuery {
  /** Mes especifico, YYYY-MM. Tem precedencia sobre `period`. */
  month?: string;
  period?: ReportPeriod;
  /** Quantos meses a serie mensal deve cobrir, terminando no mes do periodo. */
  history?: number;
}

export interface ReportCategoryTotalDTO {
  /** Null agrupa o que esta sem categoria. */
  categoryId: string | null;
  categoryName: string;
  categoryIcon: string | null;
  categoryColorKey: string | null;
  /** Null so na linha agregada de cauda ("Outras categorias"). */
  categoryKind: CategoryKind | null;
  amount: number;
  /** Fatia da despesa total do periodo, em pontos percentuais. */
  percentage: number;
  transactionCount: number;
}

/** Um dos dois lados de "quanto foi fixo, quanto foi variavel". */
export interface ReportKindTotalDTO {
  kind: CategoryKind;
  amount: number;
  /** Fatia da despesa total do periodo, em pontos percentuais. */
  percentage: number;
  transactionCount: number;
  /** As categorias do grupo, da maior despesa para a menor. */
  categories: ReportCategoryTotalDTO[];
}

export interface ReportMonthTotalDTO {
  /** YYYY-MM */
  month: string;
  income: number;
  expense: number;
}

/**
 * Totais do periodo somados no banco.
 *
 * Existe para que o app pare de baixar meses inteiros de transacoes so para
 * somar quatro numeros — e para que a soma aconteca em `numeric` no Postgres,
 * nao em ponto flutuante no navegador.
 */
export interface ReportSummaryDTO {
  /** Inicio do periodo (ISO). Null em "todo o periodo". */
  start: string | null;
  /** Fim exclusivo do periodo (ISO). Null em "todo o periodo". */
  end: string | null;
  income: number;
  expense: number;
  /** income - expense. */
  balance: number;
  /** (income - expense) / income, em pontos percentuais. 0 se nao houve receita. */
  savingsRate: number;
  transactionCount: number;
  expenseCount: number;
  uncategorizedCount: number;
  byCategory: ReportCategoryTotalDTO[];
  /** As mesmas despesas de `byCategory`, separadas em fixas e variaveis. */
  byKind: {
    fixed: ReportKindTotalDTO;
    variable: ReportKindTotalDTO;
  };
  /** Serie mensal do periodo, em ordem cronologica. */
  monthly: ReportMonthTotalDTO[];
}

// ==========================================
// SUGESTOES DE CATEGORIA
// ==========================================

export interface SuggestionDTO {
  id: string;
  transaction: TransactionDTO;
  /**
   * Null quando o app nao teve palpite (`source: "NONE"`) ou quando o palpite
   * foi recusado a mao na revisao. A transacao esta na fila do mesmo jeito: o
   * que a fila lista e transacao sem categoria, e nao palpite do app. Na tela,
   * e o que cai na ultima pagina, "Sem categoria definida".
   */
  suggestedCategoryId: string | null;
  suggestedCategoryName: string | null;
  source: "HISTORY" | "RULE" | "PLUGGY" | "NONE";
  confidence: number;
}

export interface SuggestionsResponse {
  suggestions: SuggestionDTO[];
  count: number;
}

/** O corpo de `POST /suggestions/apply`: uma pagina da revisao, confirmada. */
export interface ApplySuggestionsPayload {
  /** A categoria da pagina — a mesma para o lote inteiro. */
  categoryId: string;
  /** Sugestoes marcadas: a transacao recebe a categoria. */
  acceptIds: string[];
  /** Sugestoes desmarcadas: perdem o palpite e caem na ultima pagina. */
  rejectIds: string[];
}

export interface SimilarTransactionDTO extends TransactionDTO {
  /** 0..1. Quanto a descrição se parece com a da transação de origem. */
  score: number;
  /** Só na seção de categoria divergente. */
  currentCategoryName?: string | null;
}

export interface SimilarTransactionsResponse {
  uncategorized: SimilarTransactionDTO[];
  differentCategory: SimilarTransactionDTO[];
}
