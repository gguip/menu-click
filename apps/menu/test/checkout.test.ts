import { describe, expect, it } from "vitest";
import { checkoutBlock, dineInPayments } from "../src/lib/checkout.ts";

describe("finalizar no salão", () => {
  it("formas do salão, só as que a loja aceita, sem vale-refeição", () => {
    expect(dineInPayments(["cash", "pix", "meal_voucher"])).toEqual([
      { method: "cash", label: "Dinheiro no caixa" },
      { method: "pix", label: "Pix" },
    ]);
  });

  it("o botão diz o que falta", () => {
    expect(checkoutBlock({ name: " ", phone: "11999990000", payment: "pix" })).toBe("Informe seu nome");
    expect(checkoutBlock({ name: "Ana", phone: "1199", payment: "pix" })).toBe("Informe um telefone válido");
    expect(checkoutBlock({ name: "Ana", phone: "(11) 99999-0000", payment: null })).toBe("Escolha a forma de pagamento");
    expect(checkoutBlock({ name: "Ana", phone: "(11) 99999-0000", payment: "pix" })).toBeNull();
  });
});
