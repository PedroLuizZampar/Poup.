export type TransactionType = "INCOME" | "EXPENSE";

export type BudgetStatus = "ok" | "warning" | "exceeded";

export type SystemCategoryKey =
  | "TRANSFER"
  | "UNCATEGORIZED_EXPENSE"
  | "UNCATEGORIZED_INCOME";

export interface CategoryDTO {
  id: string;
  name: string;
  icon: string;
  colorKey: string;
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
  type: string;
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
  name: string | null;
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
}

export interface UpdateCategoryRequest {
  name?: string;
  icon?: string;
  colorKey?: string;
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
  amount: number;
  /** Fatia da despesa total do periodo, em pontos percentuais. */
  percentage: number;
  transactionCount: number;
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
