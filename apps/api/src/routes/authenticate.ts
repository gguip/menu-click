import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthContext } from "../domain/session.ts";
import { UnauthorizedError } from "../errors.ts";
import * as authService from "../services/auth.ts";

/**
 * A ponte entre o header `Authorization` e o contexto da requisição.
 *
 * Fica em `routes/` porque é camada HTTP: ler header e decidir status code não
 * é regra de negócio. Quem sabe o que é um token válido é `services/auth.ts`;
 * aqui só se traduz "não deu" em 401.
 */

declare module "fastify" {
  interface FastifyRequest {
    /** Preenchido pelo `authenticate`; `null` em rota pública. */
    auth: AuthContext | null;
  }
}

/**
 * Instala o decorator na instância raiz.
 *
 * Inicializado com `null` de propósito (F18): decorar com um valor "vazio"
 * desde o começo mantém o shape do objeto de requisição estável para a V8, em
 * vez de fazer a propriedade nascer no meio do caminho.
 *
 * Não precisa de `fastify-plugin` (F3) porque é chamado direto na raiz pelo
 * `buildApp()` — o encapsulamento que o `fp` quebraria nem chega a existir.
 */
export function installAuth(app: FastifyInstance): void {
  app.decorateRequest("auth", null);
}

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * `preHandler` que exige sessão válida.
 *
 * O token viaja em `Authorization: Bearer <token>` — nunca na querystring, que
 * acabaria em log de proxy, histórico de navegador e `Referer`. O `app.ts`
 * ainda redige esse header no logger (S13).
 *
 * A mensagem não distingue "faltou header" de "token expirado" para quem não
 * está autenticado: as duas são a mesma coisa do lado de fora.
 */
export async function authenticate(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  const match = header === undefined ? null : BEARER_PATTERN.exec(header);
  if (match === null) {
    throw new UnauthorizedError("Autenticação obrigatória");
  }

  const auth = await authService.resolve(match[1]);
  if (auth === null) {
    throw new UnauthorizedError("Sessão inválida ou expirada");
  }

  request.auth = auth;
}

/**
 * O contexto já garantido pelo `authenticate`, sem `null` no tipo.
 *
 * Existe porque `request.auth` é `AuthContext | null` para todo mundo — inclusive
 * rota pública. Num handler protegido, `null` significa que alguém esqueceu o
 * `preHandler`, e aí 401 é melhor resposta que um `TypeError` virando 500.
 */
export function requireAuth(request: FastifyRequest): AuthContext {
  if (request.auth === null) {
    throw new UnauthorizedError("Autenticação obrigatória");
  }
  return request.auth;
}
