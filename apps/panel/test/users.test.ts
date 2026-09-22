import { describe, expect, it } from "vitest";
import type { RestaurantUser } from "../src/api/types.ts";
import {
  initials,
  isSelf,
  removeUserConfirm,
  roleLabel,
  validateInvite,
} from "../src/features/users/users.ts";

function makeUser(overrides: Partial<RestaurantUser> = {}): RestaurantUser {
  return {
    id: "u-1",
    restaurantId: "r-1",
    name: "Cláudia Mendes",
    email: "gerencia@trattoriabella.com.br",
    role: "owner",
    createdAt: "2026-09-01T12:00:00.000Z",
    updatedAt: "2026-09-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("regras dos usuários", () => {
  it("as iniciais saem do primeiro e do último nome", () => {
    expect(initials("Cláudia Mendes")).toBe("CM");
    expect(initials("João")).toBe("J");
    expect(initials("  Ana   Paula   Souza  ")).toBe("AS");
    expect(initials("")).toBe("?");
  });

  it("'é você' é decidido pelo id da sessão, nunca pelo e-mail", () => {
    const me = makeUser({ id: "u-1" });
    const outro = makeUser({ id: "u-2", email: "gerencia@trattoriabella.com.br" });
    expect(isSelf(me, "u-1")).toBe(true);
    expect(isSelf(outro, "u-1")).toBe(false);
  });

  it("o selo do papel é texto fixo em pt-BR", () => {
    expect(roleLabel("owner")).toBe("Dono");
    expect(roleLabel("staff")).toBe("Equipe");
  });

  it("o convite é validado campo a campo, com a senha de 8", () => {
    expect(validateInvite({ name: "", email: "", password: "", role: "staff" })).toEqual({
      name: "Diga o nome da pessoa.",
      email: "Digite um e-mail válido.",
      password: "A senha provisória precisa de pelo menos 8 caracteres.",
    });
    expect(
      validateInvite({ name: "João", email: "joao-arroba-nada", password: "1234567", role: "staff" }),
    ).toEqual({
      email: "Digite um e-mail válido.",
      password: "A senha provisória precisa de pelo menos 8 caracteres.",
    });
    expect(
      validateInvite({ name: "João", email: "joao@loja.com.br", password: "12345678", role: "staff" }),
    ).toEqual({});
  });

  it("reusa o checkPassword do access: 40 'ç' são 80 bytes e estouram o teto do bcrypt", () => {
    const overflowing = "ç".repeat(40);
    expect(
      validateInvite({ name: "João", email: "joao@loja.com.br", password: overflowing, role: "staff" }),
    ).toEqual({
      password: "A senha passou do limite: use até 72 bytes (letras acentuadas contam em dobro).",
    });
  });

  it("a confirmação de remover diz que a sessão morre e o histórico fica", () => {
    const copy = removeUserConfirm("João");
    expect(copy.title).toBe("Remover o acesso de João?");
    expect(copy.body).toBe(
      "A conta perde o acesso na hora, e a sessão aberta dela morre na próxima ação. Os pedidos que ela atendeu continuam no histórico.",
    );
    expect(copy.cta).toBe("Remover acesso");
    expect(copy.tone).toBe("danger");
  });
});
