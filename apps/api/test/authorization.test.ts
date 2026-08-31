import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.ts";

/**
 * A garantia do "fechado por padrão", testada como garantia — e não rota a rota.
 *
 * O hook de `authenticate.ts` fecha tudo que não declara `config.public`. Um
 * teste que só verificasse as rotas de hoje não protegeria nada amanhã: rota
 * nova nasceria sem cobertura, que é exatamente o erro que o desenho tenta
 * impedir.
 *
 * Então aqui a lista de rotas é lida do próprio Fastify, e a lista de
 * **públicas** é escrita à mão. Toda rota que existe e não está na lista abaixo
 * precisa responder 401 sem credencial. Rota nova, portanto, só passa neste
 * teste de dois jeitos: exigindo sessão, ou entrando conscientemente na lista
 * de públicas — que é uma linha visível no diff.
 */

/**
 * A superfície aberta da API, inteira, num lugar só.
 *
 * `/health` porque readiness probe não tem credencial; o cardápio e a criação
 * de pedido porque são o produto (quem escaneia o QR não tem conta); e
 * register/login porque quem ainda não tem conta não tem como se autenticar.
 */
const ROTAS_PUBLICAS = new Set([
  "GET /health",
  "GET /menu/:slug",
  "GET /menu/:slug/products",
  "POST /auth/register",
  "POST /auth/login",
  "POST /restaurants/:restaurantId/orders",
]);

/** Métodos que o Fastify não gera sozinho (HEAD vem de brinde com GET). */
const METODOS = ["GET", "POST", "PATCH", "DELETE"];

/**
 * Converte a árvore de `printRoutes()` numa lista plana de "MÉTODO /caminho".
 *
 * O formato é uma árvore com prefixo de 4 caracteres por nível
 * (`│   `, `    `) e o nó em `├── ` / `└── `, terminando com os métodos entre
 * parênteses.
 */
function listarRotas(app: FastifyInstance): string[] {
  const arvore = app.printRoutes({ commonPrefix: false });
  const caminhoPorNivel: string[] = [];
  const rotas: string[] = [];

  for (const linha of arvore.split("\n")) {
    const no = /^([│\s]*)(?:├── |└── )(\S*)\s*(?:\(([^)]*)\))?/.exec(linha);
    if (no === null) continue;

    const nivel = no[1].length / 4;
    const segmento = no[2];
    caminhoPorNivel.length = nivel;
    caminhoPorNivel[nivel] = segmento;

    if (no[3] === undefined) continue;
    const caminho = caminhoPorNivel.join("");
    for (const metodo of no[3].split(", ")) {
      if (METODOS.includes(metodo)) rotas.push(`${metodo} ${caminho}`);
    }
  }
  return rotas;
}

describe("autorização: fechado por padrão", () => {
  let app: FastifyInstance;
  let rotas: string[];

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
    rotas = listarRotas(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("a árvore de rotas foi lida (o parser não silenciou)", () => {
    // se o formato do printRoutes mudar, o parser devolve lista vazia e todos
    // os testes abaixo passariam sem testar nada
    expect(rotas.length).toBeGreaterThan(10);
    expect(rotas).toContain("GET /health");
    expect(rotas).toContain("POST /restaurants/:restaurantId/orders/:orderId/confirm");
  });

  it("toda rota pública declarada existe de fato", () => {
    for (const publica of ROTAS_PUBLICAS) {
      expect(rotas, `${publica} está na lista de públicas mas não existe`).toContain(
        publica,
      );
    }
  });

  it("toda rota não declarada pública responde 401 sem credencial", async () => {
    const protegidas = rotas.filter((rota) => !ROTAS_PUBLICAS.has(rota));
    expect(protegidas.length).toBeGreaterThan(0);

    for (const rota of protegidas) {
      const [metodo, caminho] = rota.split(" ");
      // params com valor sintático válido: um uuid mal formado seria rejeitado
      // antes de chegar na autenticação e o teste mediria a coisa errada
      const url = caminho
        .replace(/:restaurantId|:orderId|:id/g, "00000000-0000-0000-0000-000000000000")
        .replace(/:slug/g, "um-slug");

      const response = await app.inject({
        method: metodo as "GET",
        url,
        payload: metodo === "GET" || metodo === "DELETE" ? undefined : {},
      });

      expect(response.statusCode, `${rota} deveria exigir sessão`).toBe(401);
    }
  });

  it("toda rota pública responde qualquer coisa MENOS 401", async () => {
    for (const rota of ROTAS_PUBLICAS) {
      const [metodo, caminho] = rota.split(" ");
      const url = caminho
        .replace(/:restaurantId/g, "00000000-0000-0000-0000-000000000000")
        .replace(/:slug/g, "um-slug");

      const response = await app.inject({
        method: metodo as "GET",
        url,
        payload: metodo === "GET" ? undefined : {},
      });

      // 400/404 são respostas legítimas (corpo vazio, slug inexistente); o que
      // não pode é a rota pedir credencial
      expect(response.statusCode, `${rota} não deveria exigir sessão`).not.toBe(401);
    }
  });
});
