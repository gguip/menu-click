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

/**
 * A entrada é JSON bem formado e passou pelo schema, mas viola uma regra que o
 * JSON Schema não consegue expressar. Vira **400**.
 *
 * Existe por um caso concreto: o limite de senha do bcrypt é de 72 **bytes**, e
 * `maxLength` conta caracteres. Não é conflito de estado (409) nem erro do
 * servidor — é entrada inválida, e o cliente precisa saber disso como 400.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** A operação é válida, mas o estado atual não permite. Vira **409**. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Credencial ausente, inválida ou expirada. Vira **401**.
 *
 * Distinto de 404 de propósito: 401 fala da requisição ("você não se
 * identificou"), enquanto acessar recurso de OUTRO restaurante continua sendo
 * 404 — confirmar que ele existe já seria vazar informação.
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}
