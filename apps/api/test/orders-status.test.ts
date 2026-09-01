import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import type { TestRestaurant } from "./helpers.ts";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
  validDeliveryAddress,
} from "./helpers.ts";

/**
 * A máquina de status, por modalidade.
 *
 * As três trilhas divergem só no penúltimo passo, e é exatamente aí que mora a
 * regra: retirada fica "disponível para retirada", entrega "sai para entrega",
 * e o pedido de salão vai direto de preparo a servido. Os testes de transição
 * ilegal são mais importantes que os do caminho feliz — é a transição que não
 * deveria existir que causa dano.
 */
describe("máquina de status do pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function stockOf(productId: string): Promise<number> {
    const { rows } = await pool.query<{ stock: number }>(
      "select stock from products where id = $1",
      [productId],
    );
    return rows[0].stock;
  }

  function acao(restaurant: TestRestaurant, orderId: string, acao: string) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders/${orderId}/${acao}`,
      headers: restaurant.headers,
    });
  }

  /** Cria um pedido da modalidade pedida, com estoque de sobra. */
  async function pedidoDe(type: "dine_in" | "takeaway" | "delivery") {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant, { stock: 20 });
    const order = await createOrder(
      app,
      restaurant.id,
      [{ productId: product.id, quantity: 2 }],
      {
        type,
        ...(type === "delivery"
          ? { deliveryAddress: validDeliveryAddress }
          : {}),
      },
    );
    return { restaurant, product, order };
  }

  describe("as três trilhas completas", () => {
    it("delivery: pending → confirmed → preparing → out_for_delivery → completed", async () => {
      const { restaurant, order } = await pedidoDe("delivery");

      for (const passo of ["confirm", "start-preparing", "dispatch", "complete"]) {
        const response = await acao(restaurant, order.id, passo);
        expect(response.statusCode, `falhou em ${passo}`).toBe(200);
      }

      const final = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/orders/${order.id}`,
        headers: restaurant.headers,
      });
      expect(final.json().status).toBe("completed");
    });

    it("takeaway: passa por ready_for_pickup, não por out_for_delivery", async () => {
      const { restaurant, order } = await pedidoDe("takeaway");

      for (const passo of ["confirm", "start-preparing", "ready", "complete"]) {
        const response = await acao(restaurant, order.id, passo);
        expect(response.statusCode, `falhou em ${passo}`).toBe(200);
      }
    });

    it("dine_in: vai de preparing direto para completed", async () => {
      const { restaurant, order } = await pedidoDe("dine_in");

      for (const passo of ["confirm", "start-preparing", "complete"]) {
        const response = await acao(restaurant, order.id, passo);
        expect(response.statusCode, `falhou em ${passo}`).toBe(200);
      }
    });
  });

  describe("transições que não existem na modalidade", () => {
    it("409 ao despachar pedido de retirada", async () => {
      const { restaurant, order } = await pedidoDe("takeaway");
      await acao(restaurant, order.id, "confirm");
      await acao(restaurant, order.id, "start-preparing");

      const response = await acao(restaurant, order.id, "dispatch");

      expect(response.statusCode).toBe(409);
      // a mensagem culpa a modalidade, não o estado: dizer "está em preparing"
      // esconderia que o problema é retirada não ter esse passo
      expect(response.json().message).toContain("retirada");
    });

    it("409 ao marcar entrega como disponível para retirada", async () => {
      const { restaurant, order } = await pedidoDe("delivery");
      await acao(restaurant, order.id, "confirm");
      await acao(restaurant, order.id, "start-preparing");

      const response = await acao(restaurant, order.id, "ready");

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("entrega");
    });

    it.each(["dispatch", "ready"])(
      "409 ao usar %s em pedido de salão",
      async (passo) => {
        const { restaurant, order } = await pedidoDe("dine_in");
        await acao(restaurant, order.id, "confirm");
        await acao(restaurant, order.id, "start-preparing");

        expect((await acao(restaurant, order.id, passo)).statusCode).toBe(409);
      },
    );
  });

  describe("transições fora de ordem", () => {
    it("409 ao pular o preparo", async () => {
      const { restaurant, order } = await pedidoDe("delivery");
      await acao(restaurant, order.id, "confirm");

      const response = await acao(restaurant, order.id, "dispatch");

      expect(response.statusCode).toBe(409);
      expect(response.json().message).toContain("confirmed");
    });

    it("409 ao preparar pedido ainda não confirmado", async () => {
      const { restaurant, order } = await pedidoDe("dine_in");

      expect((await acao(restaurant, order.id, "start-preparing")).statusCode).toBe(409);
    });

    it.each(["confirm", "start-preparing", "cancel"])(
      "409 ao aplicar %s em pedido concluído",
      async (passo) => {
        const { restaurant, order } = await pedidoDe("dine_in");
        await acao(restaurant, order.id, "confirm");
        await acao(restaurant, order.id, "start-preparing");
        await acao(restaurant, order.id, "complete");

        expect((await acao(restaurant, order.id, passo)).statusCode).toBe(409);
      },
    );
  });

  /**
   * O corte é "a comida já existe". Antes de sair ou ficar pronta, as unidades
   * voltam; depois, não — devolvê-las seria mentir sobre o que há na cozinha.
   */
  describe("o cancelamento devolve estoque até a comida ficar pronta", () => {
    it("pending: não havia debitado, nada muda", async () => {
      const { restaurant, product, order } = await pedidoDe("dine_in");

      expect((await acao(restaurant, order.id, "cancel")).statusCode).toBe(200);
      expect(await stockOf(product.id)).toBe(20);
    });

    it.each(["confirm", "start-preparing"])(
      "devolve quando cancelado depois de %s",
      async (ate) => {
        const { restaurant, product, order } = await pedidoDe("delivery");
        await acao(restaurant, order.id, "confirm");
        if (ate === "start-preparing") {
          await acao(restaurant, order.id, "start-preparing");
        }
        expect(await stockOf(product.id)).toBe(18);

        expect((await acao(restaurant, order.id, "cancel")).statusCode).toBe(200);
        expect(await stockOf(product.id)).toBe(20);
      },
    );

    it("NÃO devolve depois de sair para entrega", async () => {
      const { restaurant, product, order } = await pedidoDe("delivery");
      for (const passo of ["confirm", "start-preparing", "dispatch"]) {
        await acao(restaurant, order.id, passo);
      }

      expect((await acao(restaurant, order.id, "cancel")).statusCode).toBe(200);
      expect(await stockOf(product.id)).toBe(18);
    });

    it("NÃO devolve depois de ficar pronto para retirada", async () => {
      const { restaurant, product, order } = await pedidoDe("takeaway");
      for (const passo of ["confirm", "start-preparing", "ready"]) {
        await acao(restaurant, order.id, passo);
      }

      expect((await acao(restaurant, order.id, "cancel")).statusCode).toBe(200);
      expect(await stockOf(product.id)).toBe(18);
    });

    /**
     * Sem o lock na leitura do pedido, dois cancelamentos leem `confirmed`, os
     * dois se acham legais e os dois devolvem — o estoque terminaria em 22.
     */
    it("cancelamentos simultâneos devolvem uma vez só", async () => {
      const { restaurant, product, order } = await pedidoDe("delivery");
      await acao(restaurant, order.id, "confirm");
      await Promise.all(
        Array.from({ length: 6 }, () => pool.query("select 1")),
      );

      const respostas = await Promise.all(
        Array.from({ length: 6 }, () => acao(restaurant, order.id, "cancel")),
      );

      expect(respostas.filter((r) => r.statusCode === 200)).toHaveLength(1);
      expect(await stockOf(product.id)).toBe(20);
    });
  });

  it("os estados novos não mexem em estoque", async () => {
    const { restaurant, product, order } = await pedidoDe("delivery");
    await acao(restaurant, order.id, "confirm");
    expect(await stockOf(product.id)).toBe(18);

    for (const passo of ["start-preparing", "dispatch", "complete"]) {
      await acao(restaurant, order.id, passo);
      expect(await stockOf(product.id), `${passo} mexeu no estoque`).toBe(18);
    }
  });
});
