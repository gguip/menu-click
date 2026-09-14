import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  authHeaders,
  buildTestApp,
  createRestaurant,
  login,
  registerRestaurant,
  verifyRestaurantEmail,
} from "./helpers.ts";

/**
 * Papéis dentro do restaurante.
 *
 * Existem por um risco concreto: assim que um restaurante pode ter mais de um
 * login, o atendente convidado herdaria o poder de **apagar o restaurante** —
 * soft delete que cascateia para produtos e categorias. A checagem vale em
 * duas ações e nada além delas.
 */
describe("papel do usuário", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Rebaixa o usuário da sessão para `staff` direto no banco.
   *
   * A rota que cria `staff` chega no commit seguinte; aqui o que importa é a
   * checagem, não como o papel foi parar lá.
   */
  /**
   * Cadastra, entra e devolve o par de credenciais — a senha inclusive.
   *
   * ⚠️ Verifica o e-mail pelo fluxo real antes de devolver: este helper é
   * local (duplica `registerAndLogin`, não `createRestaurant`) justamente
   * para expor a senha em texto, mas as checagens deste arquivo são todas de
   * PAPEL — dono vs. `staff` — não de bloqueio por e-mail, e sem verificar
   * aqui toda ação de `staff`/`owner` bateria em 403 antes de chegar na
   * checagem que o arquivo existe para testar.
   */
  async function cadastrar() {
    const { restaurant, user, password } = await registerRestaurant(app);
    await verifyRestaurantEmail(app, user.email);
    const token = await login(app, user.email, password);
    return { restaurant, user, password, headers: authHeaders(token) };
  }

  async function rebaixar(email: string) {
    await pool.query(
      "update restaurant_users set role = 'staff' where email = $1",
      [email],
    );
  }

  it("quem se cadastra nasce owner", async () => {
    const { restaurant, headers } = await cadastrar();

    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().role).toBe("owner");
    expect(response.json().restaurantId).toBe(restaurant.id);
  });

  it("o owner remove o próprio restaurante", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(204);
  });

  /** É o buraco que os papéis tapam. */
  it("staff NÃO remove o restaurante — 403", async () => {
    const { restaurant, user, password } = await cadastrar();
    await rebaixar(user.email);
    // sessão nova, para o papel novo entrar no contexto
    const token = await login(app, user.email, password);

    const response = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}`,
      headers: authHeaders(token),
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      statusCode: 403,
      error: "Forbidden",
    });

    // e o restaurante continua de pé
    const leitura = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}`,
      headers: authHeaders(token),
    });
    expect(leitura.statusCode).toBe(200);
  });

  /**
   * 403 e não 404, e a distinção importa: o restaurante É o da sessão, então
   * esconder a existência mandaria quem está no painel procurar o problema no
   * lugar errado. O 404 do S19 protege restaurante que não é seu — outro caso.
   */
  it("restaurante de outro dono continua sendo 404, não 403", async () => {
    const dono = await createRestaurant(app);
    const intruso = await createRestaurant(app);

    const response = await app.inject({
      method: "DELETE",
      url: `/restaurants/${dono.id}`,
      headers: intruso.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("staff faz tudo o mais — cardápio, pedidos, configurações", async () => {
    const { restaurant, user, password } = await cadastrar();
    await rebaixar(user.email);
    const headers = authHeaders(await login(app, user.email, password));

    const categoria = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/categories`,
      headers,
      payload: { name: "Entradas" },
    });
    const produto = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/products`,
      headers,
      payload: { name: "Guioza", priceInCents: 2490 },
    });
    const config = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers,
      payload: { cuisineType: "Japonesa contemporânea" },
    });
    const pedidos = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/orders`,
      headers,
    });

    expect(categoria.statusCode).toBe(201);
    expect(produto.statusCode).toBe(201);
    expect(config.statusCode).toBe(200);
    expect(pedidos.statusCode).toBe(200);
  });

  it("o papel vem da sessão, então trocá-lo exige entrar de novo", async () => {
    const { restaurant, user, password, headers } = await cadastrar();
    await rebaixar(user.email);

    // a sessão antiga ainda carrega `owner`: ela foi resolvida antes da troca
    const comSessaoAntiga = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}`,
      headers,
    });
    expect(comSessaoAntiga.statusCode).toBe(200);

    const novo = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: authHeaders(await login(app, user.email, password)),
    });
    expect(novo.json().role).toBe("staff");
  });
});
