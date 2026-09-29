import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant, type TestRestaurant } from "./helpers.ts";

/** "Pix · pago": quem diz que foi pago é a loja, na mão. */
describe("pagamento do pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function novo() {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { paymentMethod: "pix" });
    return { r, order };
  }

  const act = (r: TestRestaurant, orderId: string, action: string) =>
    app.inject({ method: "POST", url: `/restaurants/${r.id}/orders/${orderId}/${action}`, headers: r.headers });

  it("nasce não pago, com paidAt null", async () => {
    const { order } = await novo();
    expect(order.paidAt).toBeNull();
  });

  it("marca e desmarca", async () => {
    const { r, order } = await novo();
    const paid = await act(r, order.id, "mark-paid");
    expect(paid.statusCode).toBe(200);
    expect(Number.isNaN(Date.parse(paid.json().paidAt))).toBe(false);

    const unpaid = await act(r, order.id, "mark-unpaid");
    expect(unpaid.json().paidAt).toBeNull();
  });

  it("marcar de novo mantém a hora da primeira marcação", async () => {
    const { r, order } = await novo();
    const first = (await act(r, order.id, "mark-paid")).json().paidAt;
    const second = (await act(r, order.id, "mark-paid")).json().paidAt;
    expect(second).toBe(first);
  });

  it("pedido cancelado não recebe pagamento (409), mas desmarca", async () => {
    const { r, order } = await novo();
    await act(r, order.id, "mark-paid");
    await act(r, order.id, "cancel");
    expect((await act(r, order.id, "mark-paid")).statusCode).toBe(409);
    expect((await act(r, order.id, "mark-unpaid")).json().paidAt).toBeNull();
  });

  it("pagamento não mexe no status", async () => {
    const { r, order } = await novo();
    const paid = await act(r, order.id, "mark-paid");
    expect(paid.json().status).toBe("pending");
  });

  it("pedido de outra loja é 404 (S19)", async () => {
    const { order } = await novo();
    const outra = await createRestaurant(app);
    expect((await act(outra, order.id, "mark-paid")).statusCode).toBe(404);
  });

  it("paidAt sai na listagem", async () => {
    const { r, order } = await novo();
    await act(r, order.id, "mark-paid");
    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    expect(list.json().data[0].paidAt).not.toBeNull();
  });
});
