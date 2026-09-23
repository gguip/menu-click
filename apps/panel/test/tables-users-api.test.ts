import { beforeEach, describe, expect, it } from "vitest";
import {
  createTable,
  deleteTable,
  renameTable,
  rotateTableHash,
} from "../src/api/tables.ts";
import { deleteUser, inviteUser, listUsers } from "../src/api/users.ts";
import { mockApi } from "./api-mock.ts";
import { RESTAURANT_ID, signIn } from "./fixtures.ts";

const TABLES = `/restaurants/${RESTAURANT_ID}/tables`;
const USERS = `/restaurants/${RESTAURANT_ID}/users`;

const table = {
  id: "mesa-1",
  restaurantId: RESTAURANT_ID,
  label: "Mesa 7",
  hash: "a1b2c3",
  qrUrl: "http://localhost:5173/trattoria-bella?mesa=a1b2c3",
};

describe("api de mesas e usuários", () => {
  beforeEach(() => {
    signIn();
  });

  it("cria mesa mandando só o rótulo", async () => {
    const api = mockApi([{ method: "POST", path: TABLES, status: 201, body: table }]);
    const created = await createTable(RESTAURANT_ID, "Mesa 7");
    expect(created.qrUrl).toBe(table.qrUrl);
    expect(api.calls[0].body).toEqual({ label: "Mesa 7" });
  });

  it("renomeia com PATCH e não manda mais nada junto", async () => {
    const api = mockApi([{ method: "PATCH", path: `${TABLES}/mesa-1`, body: table }]);
    await renameTable(RESTAURANT_ID, "mesa-1", "Mesa 8");
    expect(api.calls[0].method).toBe("PATCH");
    expect(api.calls[0].body).toEqual({ label: "Mesa 8" });
  });

  it("gira o código pela rota própria, sem corpo", async () => {
    const api = mockApi([
      { method: "POST", path: `${TABLES}/mesa-1/rotate-hash`, body: { ...table, hash: "z9" } },
    ]);
    const rotated = await rotateTableHash(RESTAURANT_ID, "mesa-1");
    expect(rotated.hash).toBe("z9");
    expect(api.calls[0].body).toBeUndefined();
  });

  it("remove mesa com DELETE e aceita o 204 sem corpo", async () => {
    const api = mockApi([{ method: "DELETE", path: `${TABLES}/mesa-1`, status: 204 }]);
    await deleteTable(RESTAURANT_ID, "mesa-1");
    expect(api.calls[0].method).toBe("DELETE");
  });

  it("lista usuários: a rota não é paginada, responde só { data }", async () => {
    const users = [
      {
        id: "u-1",
        restaurantId: RESTAURANT_ID,
        name: "Cláudia Mendes",
        email: "gerencia@trattoriabella.com.br",
        role: "owner",
        createdAt: "2026-09-01T12:00:00.000Z",
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    ];
    mockApi([{ method: "GET", path: USERS, body: { data: users } }]);
    expect(await listUsers(RESTAURANT_ID)).toEqual(users);
  });

  it("convida mandando nome, e-mail, senha e papel", async () => {
    const api = mockApi([{ method: "POST", path: USERS, status: 201, body: { id: "u-2" } }]);
    await inviteUser(RESTAURANT_ID, {
      name: "João",
      email: "joao@trattoriabella.com.br",
      password: "provisoria8",
      role: "staff",
    });
    expect(api.calls[0].body).toEqual({
      name: "João",
      email: "joao@trattoriabella.com.br",
      password: "provisoria8",
      role: "staff",
    });
  });

  it("remove usuário com DELETE", async () => {
    const api = mockApi([{ method: "DELETE", path: `${USERS}/u-2`, status: 204 }]);
    await deleteUser(RESTAURANT_ID, "u-2");
    expect(api.calls[0].method).toBe("DELETE");
  });
});
