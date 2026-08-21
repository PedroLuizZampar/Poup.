/**
 * Erros de domínio como classes, com o status HTTP que cada um significa.
 *
 * Antes, cada `*.routes.ts` repetia o mesmo `if (err instanceof XNotFoundError)
 * return res.status(404)` — sete arquivos escrevendo a mesma tabela à mão, e a
 * mesma `AccountNotFoundError` declarada em três serviços. Aqui o status é
 * propriedade do erro; o `errorHandler` (src/middleware/errorHandler.ts) lê e
 * responde. Rota que não trata nada devolve o status certo mesmo assim.
 */

export interface AppErrorOptions {
  /** Código estável que o cliente usa para decidir o que fazer (não o texto). */
  code?: string;
  /** Campo do formulário culpado, para o app acender o erro no lugar certo. */
  field?: string;
  /** Detalhe extra ecoado no corpo da resposta. */
  details?: unknown;
}

export class AppError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly field?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, options: AppErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = options.code;
    this.field = options.field;
    this.details = options.details;
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 400, options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 401, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 403, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 404, options);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 409, options);
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 422, options);
  }
}

/** Falha de um serviço externo (hoje só a Pluggy) — não é culpa do pedido. */
export class UpstreamError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super(message, 502, options);
  }
}

// ==========================================
// Erros de recurso, compartilhados entre módulos
// ==========================================

export class AccountNotFoundError extends NotFoundError {
  constructor() {
    super("Conta não encontrada");
  }
}

export class CategoryNotFoundError extends NotFoundError {
  constructor() {
    super("Categoria não encontrada");
  }
}

export class CategoryAlreadyExistsError extends ConflictError {
  constructor(name: string) {
    super(`Categoria "${name}" já existe`);
  }
}

export class TransactionNotFoundError extends NotFoundError {
  constructor() {
    super("Transação não encontrada");
  }
}

export class BudgetNotFoundError extends NotFoundError {
  constructor() {
    super("Orçamento não encontrado");
  }
}

export class GoalNotFoundError extends NotFoundError {
  constructor() {
    super("Meta não encontrada");
  }
}

export class NotificationNotFoundError extends NotFoundError {
  constructor() {
    super("Notificação não encontrada");
  }
}

export class ItemNotFoundError extends NotFoundError {
  constructor() {
    super("Item não encontrado");
  }
}

export class UserNotFoundError extends NotFoundError {
  constructor() {
    super("Usuário não encontrado");
  }
}

export class SystemCategoryError extends BadRequestError {
  constructor() {
    super("Esta categoria é mantida pelo Poup e não pode ser editada ou excluída");
  }
}
