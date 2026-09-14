import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthContext } from "../domain/session.ts";
import { ForbiddenError, NotFoundError, UnauthorizedError } from "../errors.ts";
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
    /** Preenchido pelo hook; `null` em rota pública. */
    auth: AuthContext | null;
  }

  interface FastifyContextConfig {
    /**
     * Marca a rota como acessível sem sessão. **Ausente = protegida.**
     *
     * A lista está invertida de propósito. Com opt-in (`preHandler` rota a
     * rota), esquecer uma linha expõe a rota em silêncio; com opt-out, o mesmo
     * esquecimento a fecha, e o sintoma é um 401 que aparece no primeiro teste.
     * Os dois erros não custam a mesma coisa.
     */
    public?: boolean;

    /**
     * Restringe a rota a quem é `owner` do restaurante. **Ausente = qualquer
     * usuário do restaurante.**
     *
     * O sentido é o oposto do `public`, e de propósito. Lá o padrão fecha
     * porque esquecer expõe; aqui o padrão abre porque o papel restringe
     * apenas duas ações — remover o restaurante e administrar usuários — e
     * tudo o mais é igual para os dois papéis. Marcar rota nova como
     * `ownerOnly` por reflexo criaria uma hierarquia que ninguém decidiu.
     */
    ownerOnly?: boolean;
  }
}

/**
 * Instala a autenticação na instância raiz: o decorator e o hook que fecha tudo.
 *
 * O decorator nasce com `null` de propósito (F18): decorar com um valor
 * "vazio" desde o começo mantém o shape do objeto de requisição estável para a
 * V8, em vez de fazer a propriedade aparecer no meio do caminho.
 *
 * Não precisa de `fastify-plugin` (F3) porque é chamado direto na raiz pelo
 * `buildApp()` — o encapsulamento que o `fp` quebraria nem chega a existir. E
 * precisa ser chamado ANTES de registrar as rotas: hook de raiz vale para o
 * que for registrado depois dele (F5).
 */
export function installAuth(app: FastifyInstance): void {
  app.decorateRequest("auth", null);

  // `onRequest` roda depois do roteamento, então `routeOptions.config` e
  // `params` já existem aqui.
  app.addHook("onRequest", async (request) => {
    if (request.routeOptions.config.public === true) return;

    await authenticate(request);

    // Autorização, e não só autenticação: ter sessão não dá acesso a qualquer
    // restaurante. A checagem é feita AQUI, e não em cada rota, pelo mesmo
    // motivo da lista invertida — rota nova com `:restaurantId` já nasce
    // protegida, sem depender de alguém lembrar de escrever a comparação.
    const { restaurantId } = request.params as { restaurantId?: string };
    if (
      restaurantId !== undefined &&
      restaurantId !== request.auth?.restaurantId
    ) {
      // 404, não 403: responder "proibido" confirmaria que esse restaurante
      // existe. Do lado de fora, restaurante dos outros é indistinguível de
      // restaurante que não existe.
      throw new NotFoundError(
        `Restaurante com id "${restaurantId}" não encontrado`,
      );
    }

    /**
     * A loja precisa ter provado o e-mail para operar.
     *
     * Vale para toda rota escopada em restaurante, POR PADRÃO — rota nova
     * nasce bloqueada, pelo mesmo raciocínio do `public`: esquecer uma linha
     * fecha em vez de abrir, e os dois erros não custam a mesma coisa.
     *
     * 403 e não 404, e é a segunda situação do projeto em que 403 é o certo:
     * a sessão é válida e o restaurante É o da sessão, então a existência já
     * é conhecida. O 404 do S19 continua valendo para restaurante alheio — e
     * note que ele é conferido ACIMA desta linha: quem tenta o restaurante de
     * outro continua recebendo 404, verificado ou não. Invertendo a ordem,
     * alguém descobriria que o restaurante de outra pessoa existe só por
     * receber 403 em vez de 404 — há teste para isso.
     */
    if (restaurantId !== undefined && request.auth?.emailVerified !== true) {
      throw new ForbiddenError(
        "Confirme o e-mail do restaurante para usar o painel. Reenvie o link em POST /auth/resend-verification",
      );
    }

    // Permissão, depois de identidade e escopo. 403 e não 404: o restaurante é
    // o da sessão, então a existência dele já é conhecida — esconder aqui
    // mandaria quem está no painel procurar o problema no lugar errado.
    if (
      request.routeOptions.config.ownerOnly === true &&
      request.auth?.role !== "owner"
    ) {
      throw new ForbiddenError(
        "Esta ação é restrita ao dono do restaurante",
      );
    }
  });
}

const BEARER_PATTERN = /^Bearer (.+)$/;

/**
 * Resolve o header `Authorization` em `request.auth`, ou lança 401.
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
