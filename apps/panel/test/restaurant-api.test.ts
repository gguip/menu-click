import { describe, expect, it } from "vitest";
import { updateRestaurant } from "../src/api/restaurant.ts";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, RESTAURANT_ID } from "./fixtures.ts";

describe("updateRestaurant", () => {
  it("manda só os campos recebidos", async () => {
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant() },
    ]);
    await updateRestaurant(RESTAURANT_ID, { acceptsMealVoucher: true, timezone: "America/Bahia" });
    expect(api.calls[0].body).toEqual({ acceptsMealVoucher: true, timezone: "America/Bahia" });
  });
});
