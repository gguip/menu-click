import { describe, expect, it } from "vitest";
import { checkoutBlock, dineInPayments, formatPhone } from "../src/lib/checkout.ts";

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

  it("máscara do telefone enquanto digita, com teto de 11 dígitos", () => {
    expect(formatPhone("")).toBe("");
    expect(formatPhone("1")).toBe("(1");
    expect(formatPhone("11")).toBe("(11");
    expect(formatPhone("119")).toBe("(11) 9");
    expect(formatPhone("1198888")).toBe("(11) 9888-8");
    expect(formatPhone("1138887777")).toBe("(11) 3888-7777");
    expect(formatPhone("11988887777")).toBe("(11) 98888-7777");
    expect(formatPhone("15982311213132132312312")).toBe("(15) 98231-1213");
    expect(formatPhone("(11) 98888-7777")).toBe("(11) 98888-7777");
  });
});
