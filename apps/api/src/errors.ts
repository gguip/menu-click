/**
 * Erros de negócio.
 *
 * São lançados pelos **serviços**, que não conhecem HTTP: o serviço só diz
 * "isso não existe" ou "isso conflita com o estado atual". Quem traduz isso em
 * status code é o `setErrorHandler()` central do `app.ts` (F14) — nenhuma rota
 * monta corpo de erro na mão.
 *
 * Classes simples de propósito: o projeto mantém as dependências mínimas, e a
 * sintaxe precisa ser "apagável" (sem parameter properties — ver CLAUDE.md).
 */

/** Recurso inexistente ou já removido (soft delete). Vira **404**. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** A operação é válida, mas o estado atual não permite. Vira **409**. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
