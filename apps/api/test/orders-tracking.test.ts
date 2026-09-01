import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestRestaurant } from "./helpers.ts";
import {
  buildTestApp,
  createOrder,
  createProduct,
  createRestaurant,
  validDeliveryAddress,
} from "./helpers.ts";

/**
 * Acompanhamento do pedido em tempo real.
 *
 * É o único teste do projeto que **não** usa `app.inject()`, e a exceção ao F21
 * tem motivo: `inject` não faz upgrade de protocolo. Aqui o servidor sobe numa
 * porta efêmera (`listen({ port: 0 })`) e um cliente WebSocket de verdade
 * conecta — que é a única forma de exercitar handshake, mensagens e fechamento.
 */
describe("acompanhamento em tempo real", () => {
  let app: FastifyInstance;
  let base: string;

  beforeAll(async () => {
    app = await buildTestApp();
    // porta 0 = o SO escolhe uma livre; sem isso, testes em paralelo (ou uma
    // API esquecida rodando na máquina) disputariam a mesma porta
    await app.listen({ port: 0, host: "127.0.0.1" });
    const { port } = app.server.address() as AddressInfo;
    base = `ws://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  type Mensagem = { type: string; order: Record<string, unknown> };

  /**
   * Um cliente WebSocket que **não perde mensagem**.
   *
   * O listener é registrado antes do `open`, e o que chega vai para uma fila.
   * Sem isso o teste tem uma corrida real: o servidor manda o `snapshot` assim
   * que a conexão abre, e um `once("message")` registrado depois do `open`
   * pode chegar tarde demais — o teste então trava esperando uma mensagem que
   * já passou. Foi exatamente o que aconteceu na primeira versão daqui.
   */
  class Cliente {
    readonly recebidas: Mensagem[] = [];
    private readonly esperando: ((m: Mensagem) => void)[] = [];
    // atribuído no corpo, e não como parameter property: o projeto roda TS
    // nativo no Node (`erasableSyntaxOnly`), onde `constructor(readonly x)`
    // não é sintaxe apagável
    private readonly socket: WebSocket;

    private constructor(socket: WebSocket) {
      this.socket = socket;
      socket.on("message", (raw) => {
        const mensagem = JSON.parse(String(raw)) as Mensagem;
        const aguardando = this.esperando.shift();
        if (aguardando) aguardando(mensagem);
        else this.recebidas.push(mensagem);
      });
    }

    static conectar(orderId: string, token: string): Promise<Cliente> {
      const socket = new WebSocket(
        `${base}/orders/${orderId}/track?token=${encodeURIComponent(token)}`,
      );
      const cliente = new Cliente(socket);

      return new Promise((resolve, reject) => {
        socket.once("open", () => resolve(cliente));
        // sem isto, upgrade recusado vira timeout de 5s em vez de dizer o motivo
        socket.once("unexpected-response", (_req, res) =>
          reject(new Error(`upgrade recusado com ${res.statusCode}`)),
        );
        socket.once("error", reject);
      });
    }

    /** A próxima mensagem — da fila, se já chegou; senão espera. */
    proxima(): Promise<Mensagem> {
      const jaChegou = this.recebidas.shift();
      if (jaChegou) return Promise.resolve(jaChegou);
      return new Promise((resolve) => this.esperando.push(resolve));
    }

    /** O código com que o servidor fechou. */
    fechamento(): Promise<number> {
      return new Promise((resolve) => this.socket.once("close", resolve));
    }

    fechar(): void {
      this.socket.close();
    }
  }

  function acao(restaurant: TestRestaurant, orderId: string, passo: string) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders/${orderId}/${passo}`,
      headers: restaurant.headers,
    });
  }

  async function pedidoRastreavel(
    type: "takeaway" | "delivery" = "delivery",
  ) {
    const restaurant = await createRestaurant(app);
    const product = await createProduct(app, restaurant, { stock: 20 });
    const order = await createOrder(
      app,
      restaurant.id,
      [{ productId: product.id, quantity: 1 }],
      {
        type,
        ...(type === "delivery"
          ? { deliveryAddress: validDeliveryAddress }
          : {}),
      },
    );
    return { restaurant, product, order };
  }

  describe("o token", () => {
    it("é devolvido na criação de entrega e de retirada", async () => {
      for (const type of ["delivery", "takeaway"] as const) {
        const { order } = await pedidoRastreavel(type);
        expect(order.trackingToken, type).toEqual(expect.any(String));
      }
    });

    /**
     * O teste que fecha o acompanhamento por MODELAGEM: quem está no salão não
     * tem o que acompanhar, e a forma de garantir isso é não emitir credencial
     * — não um `if` na rota, que alguém pode remover sem perceber.
     */
    it("NÃO é devolvido em pedido de salão", async () => {
      const restaurant = await createRestaurant(app);
      const product = await createProduct(app, restaurant, { stock: 5 });
      const order = await createOrder(app, restaurant.id, [
        { productId: product.id, quantity: 1 },
      ]);

      expect(order.type).toBe("dine_in");
      expect(order.trackingToken).toBeUndefined();
    });

    /** O token é credencial: ele não pode reaparecer nas rotas do restaurante. */
    it("não aparece na listagem nem no detalhe do restaurante", async () => {
      const { restaurant, order } = await pedidoRastreavel();

      const lista = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/orders`,
        headers: restaurant.headers,
      });
      const detalhe = await app.inject({
        method: "GET",
        url: `/restaurants/${restaurant.id}/orders/${order.id}`,
        headers: restaurant.headers,
      });

      expect(lista.body).not.toContain(order.trackingToken);
      expect(detalhe.body).not.toContain(order.trackingToken);
      expect(detalhe.body).not.toContain("trackingToken");
    });

    it("o banco guarda o hash, nunca o token", async () => {
      const { order } = await pedidoRastreavel();
      const { pool } = await import("../src/db/pool.ts");

      const { rows } = await pool.query<{ tracking_token_hash: string }>(
        "select tracking_token_hash from orders where id = $1",
        [order.id],
      );
      expect(rows[0].tracking_token_hash).not.toBe(order.trackingToken);
      expect(rows[0].tracking_token_hash).toHaveLength(64); // sha256 hex
    });
  });

  describe("o handshake", () => {
    it("recusa antes do upgrade quando o token não existe", async () => {
      const { order } = await pedidoRastreavel();

      const response = await app.inject({
        method: "GET",
        url: `/orders/${order.id}/track?token=inventado`,
      });

      // 404 pela via HTTP: nenhum socket chega a abrir
      expect(response.statusCode).toBe(404);
    });

    /**
     * Token válido, mas de OUTRO pedido. Responder algo diferente de "não
     * encontrado" diria a quem tenta que aquele pedido existe.
     */
    it("recusa token válido de outro pedido, com a mesma resposta", async () => {
      const a = await pedidoRastreavel();
      const b = await pedidoRastreavel();

      const cruzado = await app.inject({
        method: "GET",
        url: `/orders/${a.order.id}/track?token=${b.order.trackingToken}`,
      });
      const inexistente = await app.inject({
        method: "GET",
        url: `/orders/${a.order.id}/track?token=inventado`,
      });

      expect(cruzado.statusCode).toBe(404);
      expect(cruzado.json().message).toBe(inexistente.json().message);
    });

    it("400 sem token (a validação roda antes do upgrade)", async () => {
      const { order } = await pedidoRastreavel();

      const response = await app.inject({
        method: "GET",
        url: `/orders/${order.id}/track`,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("as mensagens", () => {
    /**
     * Sem o snapshot, uma conexão que caia durante o preparo e volte fica em
     * branco esperando um evento que pode não vir tão cedo.
     */
    it("a primeira mensagem é sempre o estado atual", async () => {
      const { restaurant, order } = await pedidoRastreavel();
      await acao(restaurant, order.id, "confirm");
      await acao(restaurant, order.id, "start-preparing");

      const cliente = await Cliente.conectar(order.id, order.trackingToken);
      const primeira = await cliente.proxima();

      expect(primeira).toMatchObject({
        type: "snapshot",
        order: { id: order.id, type: "delivery", status: "preparing" },
      });
      cliente.fechar();
    });

    it("cada transição chega como uma mensagem `status`", async () => {
      const { restaurant, order } = await pedidoRastreavel();
      const cliente = await Cliente.conectar(order.id, order.trackingToken);
      await cliente.proxima(); // snapshot

      for (const passo of ["confirm", "start-preparing", "dispatch"]) {
        await acao(restaurant, order.id, passo);
      }

      const recebidas = [
        (await cliente.proxima()).order.status,
        (await cliente.proxima()).order.status,
        (await cliente.proxima()).order.status,
      ];

      expect(recebidas).toEqual([
        "confirmed",
        "preparing",
        "out_for_delivery",
      ]);
      cliente.fechar();
    });

    /**
     * O teste que separa "funciona" de "vaza": o roteamento é por id de pedido,
     * então uma conexão nunca pode ver o pedido de outra pessoa.
     */
    it("um socket não recebe evento de outro pedido", async () => {
      const a = await pedidoRastreavel();
      const b = await pedidoRastreavel();

      const cliente = await Cliente.conectar(a.order.id, a.order.trackingToken);
      await cliente.proxima(); // snapshot

      await acao(b.restaurant, b.order.id, "confirm");
      await new Promise((r) => setTimeout(r, 80));

      // nada na fila: o roteamento é por id de pedido
      expect(cliente.recebidas).toEqual([]);
      cliente.fechar();
    });

    it("não transmite dado do cliente pelo canal", async () => {
      const { order } = await pedidoRastreavel();
      const cliente = await Cliente.conectar(order.id, order.trackingToken);

      const snapshot = await cliente.proxima();

      // o canal manda o mínimo: sem telefone, sem nome, sem itens
      expect(JSON.stringify(snapshot)).not.toContain("11999990000");
      expect(Object.keys(snapshot.order)).toEqual([
        "id",
        "type",
        "status",
        "totalInCents",
        "updatedAt",
      ]);
      cliente.fechar();
    });
  });

  describe("o fechamento", () => {
    it("fecha com 1000 quando o pedido é concluído", async () => {
      const { restaurant, order } = await pedidoRastreavel();
      const cliente = await Cliente.conectar(order.id, order.trackingToken);
      await cliente.proxima();

      const fechou = cliente.fechamento();
      for (const passo of ["confirm", "start-preparing", "dispatch", "complete"]) {
        await acao(restaurant, order.id, passo);
      }

      expect(await fechou).toBe(1000);
    });

    it("fecha com 1000 quando o pedido é cancelado", async () => {
      const { restaurant, order } = await pedidoRastreavel();
      const cliente = await Cliente.conectar(order.id, order.trackingToken);
      await cliente.proxima();

      const fechou = cliente.fechamento();
      await acao(restaurant, order.id, "cancel");

      expect(await fechou).toBe(1000);
    });

    /** Conectar num pedido que já acabou: recebe o estado e a conexão encerra. */
    it("fecha na hora se o pedido já está finalizado", async () => {
      const { restaurant, order } = await pedidoRastreavel();
      await acao(restaurant, order.id, "cancel");

      const cliente = await Cliente.conectar(order.id, order.trackingToken);
      const snapshot = await cliente.proxima();

      expect(snapshot).toMatchObject({ order: { status: "cancelled" } });
      expect(await cliente.fechamento()).toBe(1000);
    });
  });
});
