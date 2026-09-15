import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import * as tablesRepository from "../src/repositories/tables.ts";
import { buildTestApp, createRestaurant } from "./helpers.ts";
import type { TestRestaurant } from "./helpers.ts";

/** Cria uma mesa via API e devolve o corpo já em camelCase. */
async function criaMesa(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  label: string,
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/tables`,
    headers: restaurant.headers,
    payload: { label },
  });
  return response.json();
}

describe("CRUD /restaurants/:restaurantId/tables", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe("POST", () => {
    it("201 com o rótulo, o hash sorteado e a URL pronta do QR", async () => {
      const restaurant = await createRestaurant(app);

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/tables`,
        headers: restaurant.headers,
        payload: { label: "Mesa 7" },
      });

      expect(response.statusCode).toBe(201);
      const mesa = response.json();
      expect(mesa).toMatchObject({
        label: "Mesa 7",
        restaurantId: restaurant.id,
      });
      // 16 bytes em base64url = 22 caracteres, sem padding
      expect(mesa.hash).toMatch(/^[A-Za-z0-9_-]{22}$/);
      // a URL vem montada pelo servidor: o front só passa isso para o <QRCode>
      expect(mesa.qrUrl).toBe(
        `http://localhost:5173/${restaurant.slug}?mesa=${mesa.hash}`,
      );
    });

    it("409 no rótulo repetido, sem diferenciar maiúscula", async () => {
      const restaurant = await createRestaurant(app);
      await criaMesa(app, restaurant, "Mesa 7");

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/tables`,
        headers: restaurant.headers,
        payload: { label: "mesa 7" },
      });

      expect(response.statusCode).toBe(409);
    });

    it("duas mesas do mesmo salão nascem com hashes diferentes", async () => {
      const restaurant = await createRestaurant(app);

      const sete = await criaMesa(app, restaurant, "Mesa 7");
      const oito = await criaMesa(app, restaurant, "Mesa 8");

      expect(sete.hash).not.toBe(oito.hash);
    });

    it("o rótulo volta a ficar livre depois de a mesa ser removida", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
        headers: restaurant.headers,
      });

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/tables`,
        headers: restaurant.headers,
        payload: { label: "Mesa 7" },
      });

      expect(response.statusCode).toBe(201);
    });
  });

  describe("GET", () => {
    it("lista as mesas no envelope paginado", async () => {
      const restaurant = await createRestaurant(app);
      await criaMesa(app, restaurant, "Mesa 1");
      await criaMesa(app, restaurant, "Mesa 2");

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/tables`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ limit: 20, offset: 0, total: 2 });
      expect(response.json().data).toHaveLength(2);
    });

    it("404 na mesa de outro restaurante — nunca 403 (S19)", async () => {
      const dono = await createRestaurant(app);
      const intruso = await createRestaurant(app);
      const mesa = await criaMesa(app, dono, "Mesa 7");

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${intruso.id}/tables/${mesa.id}`,
        headers: intruso.headers,
      });

      expect(response.statusCode).toBe(404);
    });

    it("404 na mesa removida", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");
      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
        headers: restaurant.headers,
      });

      const response = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("PATCH", () => {
    it("renomeia sem tocar no hash — o QR impresso continua valendo", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
        headers: restaurant.headers,
        payload: { label: "Mesa 8" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().label).toBe("Mesa 8");
      expect(response.json().hash).toBe(mesa.hash);
    });

    /**
     * O projeto inteiro roda com `removeAdditional: true` (`routes/validators.ts`),
     * então campo desconhecido é DESCARTADO, não recusado — conferido contra a
     * rota de categorias, que responde 200 do mesmo jeito. O que este teste
     * prende, então, não é o status: é a propriedade que importa, a de o hash
     * não ter por onde ser escolhido pelo cliente (S8). Quem a garante é o mapa
     * fixo `tableColumns` do repositório; trocá-lo pelas chaves do corpo faria
     * este teste cair.
     */
    it("hash no corpo do PATCH não escolhe o hash da mesa (S8)", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");

      const response = await app.inject({
        method: "PATCH",
        url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
        headers: restaurant.headers,
        payload: { label: "Mesa 8", hash: "escolhido-por-mim" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().label).toBe("Mesa 8");
      expect(response.json().hash).toBe(mesa.hash);
    });
  });

  describe("POST rotate-hash", () => {
    it("troca o hash e devolve a qrUrl nova", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/tables/${mesa.id}/rotate-hash`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(200);
      const rotacionada = response.json();
      expect(rotacionada.hash).not.toBe(mesa.hash);
      expect(rotacionada.hash).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(rotacionada.qrUrl).toBe(
        `http://localhost:5173/${restaurant.slug}?mesa=${rotacionada.hash}`,
      );
      expect(rotacionada.label).toBe("Mesa 7");
    });

    it("404 ao rotacionar mesa de outro restaurante", async () => {
      const dono = await createRestaurant(app);
      const intruso = await createRestaurant(app);
      const mesa = await criaMesa(app, dono, "Mesa 7");

      const response = await app.inject({
        method: "POST",
        url: `/restaurants/${intruso.id}/tables/${mesa.id}/rotate-hash`,
        headers: intruso.headers,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  /**
   * ⚠️ Este bloco fala com o REPOSITÓRIO direto, sem passar por HTTP, e isso é
   * deliberado.
   *
   * Pela via HTTP a proteção contra mass assignment (S8) é INALCANÇÁVEL: o
   * `removeAdditional: true` de `routes/validators.ts` apaga o campo
   * desconhecido do corpo antes de ele chegar ao serviço, então o mapa fixo
   * `tableColumns` nunca chega a ser exercitado. Medido por mutação — trocar o
   * mapa pelas chaves do corpo mantém os treze testes de HTTP verdes.
   *
   * É o S29 aplicado: o schema é a primeira barreira, não a última. Quem
   * afrouxar o schema um dia (um campo novo no PATCH) volta a expor a de
   * baixo, e é ela que este teste prende.
   */
  describe("o repositório não aceita coluna que não está no mapa (S8)", () => {
    it("um campo forjado no input não vira atribuição no UPDATE", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");

      const resultado = await tablesRepository.update(
        restaurant.id as string,
        mesa.id,
        {
          label: "Mesa 8",
          hash: "escolhido-por-mim",
        } as Parameters<typeof tablesRepository.update>[2],
      );

      expect(resultado.outcome).toBe("updated");
      if (resultado.outcome !== "updated") return;
      expect(resultado.table.label).toBe("Mesa 8");
      expect(resultado.table.hash).toBe(mesa.hash);
    });
  });

  /**
   * A cascata do D3: remover o restaurante marca as mesas junto, na mesma
   * transação. Sem isso as mesas ficariam vivas apontando para um restaurante
   * morto, fora do alcance de qualquer limpeza — e o `CLAUDE.md` descreve
   * exatamente esse modo de falha para as outras filhas.
   */
  describe("cascata da remoção do restaurante (D3)", () => {
    it("remover o restaurante marca as mesas dele", async () => {
      const restaurant = await createRestaurant(app);
      await criaMesa(app, restaurant, "Mesa 7");
      await criaMesa(app, restaurant, "Mesa 8");

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
      });

      const { rows } = await pool.query<{ vivas: string }>(
        `select count(*) as vivas from tables
          where restaurant_id = $1 and deleted_at is null`,
        [restaurant.id],
      );
      expect(Number(rows[0].vivas)).toBe(0);
    });
  });

  describe("DELETE", () => {
    it("204 e a mesa some da listagem", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");

      const response = await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/tables/${mesa.id}`,
        headers: restaurant.headers,
      });

      expect(response.statusCode).toBe(204);

      const listagem = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/tables`,
        headers: restaurant.headers,
      });
      expect(listagem.json().total).toBe(0);
    });

    it("404 ao remover duas vezes (D1)", async () => {
      const restaurant = await createRestaurant(app);
      const mesa = await criaMesa(app, restaurant, "Mesa 7");
      const url = `/restaurants/${restaurant.id}/tables/${mesa.id}`;

      await app.inject({ method: "DELETE", url, headers: restaurant.headers });
      const segunda = await app.inject({
        method: "DELETE",
        url,
        headers: restaurant.headers,
      });

      expect(segunda.statusCode).toBe(404);
    });
  });
});
