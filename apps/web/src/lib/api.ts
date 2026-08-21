import type {
  LoginRequest,
  LoginResponse,
  CategoryDTO,
  AccountDTO,
  TransactionDTO,
  BudgetDTO,
  GoalDTO,
  NotificationDTO,
  ItemDTO,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  CreateTransactionRequest,
  UpdateTransactionRequest,
  TransactionFilterQuery,
  CreateBudgetRequest,
  CreateGoalRequest,
  UpdateGoalRequest,
  ReportQuery,
  ReportSummaryDTO,
  SyncItemResponse,
  UserDTO,
  UpdateAccountRequest,
  UpdateProfileRequest,
  ChangePasswordRequest,
  PluggyCredentialsDTO,
  RegisterInput,
  ApplySuggestionsPayload,
  SuggestionsResponse,
  SimilarTransactionsResponse,
} from "@poup/shared";

/**
 * Erro de API que preserva o que o servidor disse além da mensagem: `field`
 * permite acender o erro no campo culpado do formulário em vez de num alerta
 * genérico no topo, e `code` distingue "credencial Pluggy não cadastrada" de
 * "a Pluggy falhou".
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly field?: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Onde a API atende, em ordem de confianca:
 *
 * 1. O prefixo `/api` da propria origem — em dev e o proxy do Vite, em producao
 *    e o proprio Express servindo o build (mesma origem, que e o que o service
 *    worker do PWA precisa).
 * 2. A porta padrao do `npm run dev:api`, para o caso raro de a pagina nao ser
 *    servida por http.
 */
function resolveApiUrl(): string {
  if (typeof window === "undefined") return "http://localhost:4000/api";
  if (window.location.protocol.startsWith("http")) return "/api";
  return "http://localhost:4000/api";
}

const API_URL = resolveApiUrl();
const TOKEN_KEY = "poup:token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });
  } catch (err: any) {
    // Estar sem rede e o servidor estar fora são falhas diferentes para quem
    // lê: uma o usuário resolve, a outra não. `navigator.onLine` erra para
    // cima — diz "sim" a qualquer interface ativa —, mas um `false` é sempre
    // confiável, que é o único caso em que mudamos o texto.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new ApiError(
        "Você está sem conexão. O Poup precisa de internet para buscar seus dados.",
        0,
        undefined,
        "OFFLINE"
      );
    }
    throw new ApiError(
      `Não foi possível falar com o servidor do Poup (${API_URL}). ` +
        "Em desenvolvimento, confira se 'npm run dev' está em execução.",
      0,
      undefined,
      "NETWORK"
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
    }
    const body = await res.json().catch(() => ({} as any));
    throw new ApiError(
      body.error || "Ocorreu um erro na requisição",
      res.status,
      body.field,
      body.code
    );
  }

  return res.json();
}


// ==========================================
// AUTH
// ==========================================
export async function login(payload: LoginRequest): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function register(payload: RegisterInput): Promise<LoginResponse> {
  return request<LoginResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchPluggyCredentials(): Promise<PluggyCredentialsDTO> {
  const res = await request<{ credentials: PluggyCredentialsDTO }>("/auth/pluggy-credentials");
  return res.credentials;
}

export async function updatePluggyCredentials(payload: {
  clientId: string;
  clientSecret: string;
  currentPassword: string;
}): Promise<PluggyCredentialsDTO> {
  const res = await request<{ credentials: PluggyCredentialsDTO }>("/auth/pluggy-credentials", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return res.credentials;
}

/**
 * Devolve `null` quando não há sessão — sem token, ou com token recusado.
 * Falha de rede **sobe**: apagar o token aqui deslogava quem só estava sem
 * sinal, que é exatamente o caso de abrir o app instalado fora de cobertura.
 */
export async function fetchMe(): Promise<UserDTO | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await request<{ user: UserDTO }>("/auth/me");
    return res.user;
  } catch (err) {
    // O 401 já limpou o token dentro de `request`.
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function updateProfile(data: UpdateProfileRequest): Promise<UserDTO> {
  const res = await request<{ user: UserDTO }>("/auth/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.user;
}

export async function changePassword(data: ChangePasswordRequest): Promise<void> {
  await request("/auth/password", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// ==========================================
// ACCOUNTS
// ==========================================
export async function fetchAccounts(): Promise<AccountDTO[]> {
  const res = await request<{ accounts: AccountDTO[] }>("/accounts");
  return res.accounts;
}

export async function updateAccount(id: string, data: UpdateAccountRequest): Promise<AccountDTO> {
  const res = await request<{ account: AccountDTO }>(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.account;
}

// ==========================================
// CATEGORIES
// ==========================================
export async function fetchCategories(): Promise<CategoryDTO[]> {
  const res = await request<{ categories: CategoryDTO[] }>("/categories");
  return res.categories;
}

export async function createCategory(data: CreateCategoryRequest): Promise<CategoryDTO> {
  const res = await request<{ category: CategoryDTO }>("/categories", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.category;
}

export async function updateCategory(id: string, data: UpdateCategoryRequest): Promise<CategoryDTO> {
  const res = await request<{ category: CategoryDTO }>(`/categories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.category;
}

export async function deleteCategory(id: string): Promise<void> {
  await request(`/categories/${id}`, { method: "DELETE" });
}

// ==========================================
// TRANSACTIONS
// ==========================================
export async function fetchTransactions(query?: TransactionFilterQuery): Promise<TransactionDTO[]> {
  const params = new URLSearchParams();
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        params.append(k, String(v));
      }
    });
  }
  const queryString = params.toString() ? `?${params.toString()}` : "";
  const res = await request<{ transactions: TransactionDTO[] }>(`/transactions${queryString}`);
  return res.transactions;
}

export async function createTransaction(data: CreateTransactionRequest): Promise<TransactionDTO> {
  const res = await request<{ transaction: TransactionDTO }>("/transactions", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.transaction;
}

export async function updateTransaction(id: string, data: UpdateTransactionRequest): Promise<TransactionDTO> {
  const res = await request<{ transaction: TransactionDTO }>(`/transactions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.transaction;
}

// ==========================================
// BUDGETS
// ==========================================
export async function fetchBudgets(month?: string): Promise<BudgetDTO[]> {
  const qs = month ? `?month=${month}` : "";
  const res = await request<{ budgets: BudgetDTO[] }>(`/budgets${qs}`);
  return res.budgets;
}

export async function upsertBudget(data: CreateBudgetRequest): Promise<BudgetDTO> {
  const res = await request<{ budget: BudgetDTO }>("/budgets", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.budget;
}

export async function deleteBudget(id: string): Promise<void> {
  await request(`/budgets/${id}`, { method: "DELETE" });
}

// ==========================================
// GOALS
// ==========================================
export async function fetchGoals(): Promise<GoalDTO[]> {
  const res = await request<{ goals: GoalDTO[] }>("/goals");
  return res.goals;
}

export async function createGoal(data: CreateGoalRequest): Promise<GoalDTO> {
  const res = await request<{ goal: GoalDTO }>("/goals", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.goal;
}

export async function updateGoal(id: string, data: UpdateGoalRequest): Promise<GoalDTO> {
  const res = await request<{ goal: GoalDTO }>(`/goals/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return res.goal;
}

export async function deleteGoal(id: string): Promise<void> {
  await request(`/goals/${id}`, { method: "DELETE" });
}

// ==========================================
// NOTIFICATIONS
// ==========================================
export async function fetchNotifications(): Promise<{ notifications: NotificationDTO[]; unreadCount: number }> {
  return request<{ notifications: NotificationDTO[]; unreadCount: number }>("/notifications");
}

export async function markNotificationRead(id: string): Promise<NotificationDTO> {
  const res = await request<{ notification: NotificationDTO }>(`/notifications/${id}/read`, {
    method: "PATCH",
  });
  return res.notification;
}

export async function markAllNotificationsRead(): Promise<void> {
  await request("/notifications/read-all", { method: "PATCH" });
}

/**
 * Pede ao servidor que reavalie orcamentos e gere os alertas automaticos.
 * Chamado depois do sync — que e quando os dados mudam. Antes isso acontecia
 * dentro do GET, o que fazia abrir o sininho gravar no banco.
 */
export async function checkNotifications(): Promise<number> {
  const res = await request<{ generated: number }>("/notifications/check", { method: "POST" });
  return res.generated;
}

// ==========================================
// RELATORIOS
// ==========================================

/**
 * Totais do periodo somados no banco. Substitui baixar meses inteiros de
 * transacoes so para reduzi-los a quatro numeros no navegador.
 */
export async function fetchReportSummary(query: ReportQuery = {}): Promise<ReportSummaryDTO> {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, String(value));
    }
  });
  const queryString = params.toString() ? `?${params.toString()}` : "";
  const res = await request<{ summary: ReportSummaryDTO }>(`/reports/summary${queryString}`);
  return res.summary;
}

// ==========================================
// PLUGGY
// ==========================================
export async function syncItem(pluggyItemId?: string): Promise<SyncItemResponse> {
  return request<SyncItemResponse>("/pluggy/sync", {
    method: "POST",
    body: JSON.stringify(pluggyItemId ? { pluggyItemId } : {}),
  });
}

export async function addItem(pluggyItemId: string): Promise<SyncItemResponse> {
  return request<SyncItemResponse>("/pluggy/items", {
    method: "POST",
    body: JSON.stringify({ pluggyItemId }),
  });
}

export async function fetchItems(): Promise<ItemDTO[]> {
  const res = await request<{ items: ItemDTO[] }>("/pluggy/items");
  return res.items;
}

export async function deleteItem(id: string): Promise<void> {
  await request(`/pluggy/items/${id}`, { method: "DELETE" });
}

export async function updateItemImage(id: string, imageUrl: string | null): Promise<ItemDTO> {
  const res = await request<{ item: ItemDTO }>(`/pluggy/items/${id}/image`, {
    method: "PATCH",
    body: JSON.stringify({ imageUrl }),
  });
  return res.item;
}

// ==========================================
// SUGESTÕES DE CATEGORIA
// ==========================================
export async function fetchSuggestions(): Promise<SuggestionsResponse> {
  return request("/suggestions");
}

export async function fetchSuggestionsCount(): Promise<number> {
  const data = await request<{ count: number }>("/suggestions/count");
  return data.count;
}

/**
 * Confirma uma página da revisão. As duas respostas já vêm com a fila
 * recarregada — o servidor reavalia as pendentes depois de aplicar o lote, e a
 * lista que a tela tinha na mão envelhece nesse instante.
 */
export async function applySuggestions(
  payload: ApplySuggestionsPayload
): Promise<SuggestionsResponse & { applied: number }> {
  return request("/suggestions/apply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function dismissSuggestions(
  ids: string[]
): Promise<SuggestionsResponse & { dismissed: number }> {
  return request("/suggestions/dismiss", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export async function fetchSimilarTransactions(
  transactionId: string,
  categoryId: string
): Promise<SimilarTransactionsResponse> {
  return request(
    `/transactions/${transactionId}/similar?categoryId=${encodeURIComponent(categoryId)}`
  );
}

export async function bulkCategorize(
  transactionIds: string[],
  categoryId: string
): Promise<{ updated: number }> {
  return request("/transactions/bulk-categorize", {
    method: "POST",
    body: JSON.stringify({ transactionIds, categoryId }),
  });
}
