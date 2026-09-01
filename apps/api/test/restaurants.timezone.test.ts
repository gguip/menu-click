import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createRestaurant,
  registerResponse,
} from "./helpers.ts";

/**
 * O fuso do restaurante.
 *
 * Ele existe por um motivo só, e ele é o painel: "pedidos de hoje" não tem
 * resposta sem saber onde o dia começa. Por isso o campo é editável (ao
 * contrário do slug) e recusado quando o sistema não o conhece — um fuso
 * inválido gravado só apareceria depois, como erro do Postgres na consulta.
 */
describe("fuso horário do restaurante", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sem informar nada, o restaurante nasce em America/Sao_Paulo", async () => {
    const restaurant = await createRestaurant(app);

    expect(restaurant.timezone).toBe("America/Sao_Paulo");
  });

  it("aceita um fuso explícito no cadastro", async () => {
    const response = await registerResponse(app, {
      timezone: "America/Manaus",
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().restaurant.timezone).toBe("America/Manaus");
  });

  it("400 com fuso que o sistema não conhece", async () => {
    const response = await registerResponse(app, {
      timezone: "Marte/Olympus_Mons",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain("Marte/Olympus_Mons");
  });

  it("400 com fuso mal formado, antes mesmo do serviço", async () => {
    const response = await registerResponse(app, {
      timezone: "não é fuso nenhum",
    });

    expect(response.statusCode).toBe(400);
  });

  it("é editável por PATCH — mudar o fuso não quebra QR code impresso", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { timezone: "America/Manaus" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().timezone).toBe("America/Manaus");
  });

  it("400 ao editar para um fuso inexistente", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { timezone: "Nowhere/Nothing" },
    });

    expect(response.statusCode).toBe(400);
  });

  /**
   * `Brazil/East` é apelido legítimo de `America/Sao_Paulo`, e o Postgres o
   * aceita. Validar contra `Intl.supportedValuesOf("timeZone")` (que só lista
   * canônicos) o recusaria, e aí a API e o banco discordariam sobre o que
   * existe.
   */
  it("aceita apelido de fuso que o Postgres também aceita", async () => {
    const response = await registerResponse(app, { timezone: "Brazil/East" });

    expect(response.statusCode).toBe(201);
  });

  /**
   * S10: coluna nova não entra na superfície pública por reflexo. O fuso é
   * detalhe de operação do restaurante — o cliente do QR code não precisa dele
   * enquanto não houver horário de funcionamento.
   */
  it("não vaza no cardápio público", async () => {
    await createRestaurant(app, { slug: "tokyo-fuso" });

    const response = await app.inject({
      method: "GET",
      url: "/menu/tokyo-fuso",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().timezone).toBeUndefined();
  });
});
