import { describe, expect, it } from "vitest";
import { putNeighborhoods } from "../src/api/delivery.ts";
import {
  createOption,
  createOptionGroup,
  deleteOption,
  deleteOptionGroup,
  updateOption,
  updateOptionGroup,
} from "../src/api/optionGroups.ts";
import { listAllProducts } from "../src/api/products.ts";
import { updateRestaurant } from "../src/api/restaurant.ts";
import { mockApi } from "./api-mock.ts";
import { makeOptionGroup, makeProduct, makeRestaurant, RESTAURANT_ID } from "./fixtures.ts";

const BASE = `/restaurants/${RESTAURANT_ID}`;

describe("grupos de opções", () => {
  it("cria, edita e remove grupo", async () => {
    const api = mockApi([
      { method: "POST", path: `${BASE}/option-groups`, status: 201, body: makeOptionGroup() },
      { method: "PATCH", path: `${BASE}/option-groups/grp-1`, body: makeOptionGroup() },
      { method: "DELETE", path: `${BASE}/option-groups/grp-1`, status: 204 },
    ]);
    await createOptionGroup(RESTAURANT_ID, { name: "Borda", minOptions: 0, maxOptions: 1, priceRule: "sum" });
    await updateOptionGroup(RESTAURANT_ID, "grp-1", { name: "Bordas" });
    await deleteOptionGroup(RESTAURANT_ID, "grp-1");
    expect(api.calls.map((call) => [call.method, call.body])).toEqual([
      ["POST", { name: "Borda", minOptions: 0, maxOptions: 1, priceRule: "sum" }],
      ["PATCH", { name: "Bordas" }],
      ["DELETE", undefined],
    ]);
  });

  it("cria, edita e remove opção dentro do grupo", async () => {
    const option = { id: "opt-1", name: "Catupiry", priceInCents: 800, maxQuantity: 1, available: true, position: 0 };
    const api = mockApi([
      { method: "POST", path: `${BASE}/option-groups/grp-1/options`, status: 201, body: option },
      { method: "PATCH", path: `${BASE}/option-groups/grp-1/options/opt-1`, body: option },
      { method: "DELETE", path: `${BASE}/option-groups/grp-1/options/opt-1`, status: 204 },
    ]);
    await createOption(RESTAURANT_ID, "grp-1", { name: "Catupiry", priceInCents: 800, maxQuantity: 1 });
    await updateOption(RESTAURANT_ID, "grp-1", "opt-1", { available: false });
    await deleteOption(RESTAURANT_ID, "grp-1", "opt-1");
    expect(api.calls.map((call) => [call.method, call.path, call.body])).toEqual([
      ["POST", `${BASE}/option-groups/grp-1/options`, { name: "Catupiry", priceInCents: 800, maxQuantity: 1 }],
      ["PATCH", `${BASE}/option-groups/grp-1/options/opt-1`, { available: false }],
      ["DELETE", `${BASE}/option-groups/grp-1/options/opt-1`, undefined],
    ]);
  });
});

describe("entrega", () => {
  it("putNeighborhoods manda a lista inteira e devolve a lista salva", async () => {
    const saved = [{ name: "Centro", feeInCents: 500 }];
    const api = mockApi([
      { method: "PUT", path: `${BASE}/delivery-neighborhoods`, body: { neighborhoods: saved } },
    ]);
    const result = await putNeighborhoods(RESTAURANT_ID, saved);
    expect(api.calls[0].body).toEqual({ neighborhoods: saved });
    expect(result).toEqual(saved);
  });

  it("'grátis acima de' desligado vai como null no PATCH", async () => {
    const api = mockApi([{ method: "PATCH", path: BASE, body: makeRestaurant() }]);
    await updateRestaurant(RESTAURANT_ID, { freeDeliveryAboveInCents: null, deliveryFeeMode: "neighborhood" });
    expect(api.calls[0].body).toEqual({ freeDeliveryAboveInCents: null, deliveryFeeMode: "neighborhood" });
  });
});

describe("listAllProducts", () => {
  it("percorre as páginas até o total", async () => {
    const api = mockApi([
      {
        method: "GET",
        path: `${BASE}/products`,
        query: { offset: "0" },
        body: { data: [makeProduct({ id: "p1" })], limit: 100, offset: 0, total: 2 },
      },
      {
        method: "GET",
        path: `${BASE}/products`,
        query: { offset: "1" },
        body: { data: [makeProduct({ id: "p2" })], limit: 100, offset: 1, total: 2 },
      },
    ]);
    const result = await listAllProducts(RESTAURANT_ID);
    expect(result.items.map((product) => product.id)).toEqual(["p1", "p2"]);
    expect(result.truncated).toBe(false);
    expect(api.calls.every((call) => call.query.limit === "100")).toBe(true);
  });
});
