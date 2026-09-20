import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  fromProduct,
  isDirty,
  sameIds,
  toCreateBody,
  toUpdateBody,
  validateProductForm,
} from "../src/features/products/productForm.ts";
import { makeProduct } from "./fixtures.ts";

const valid = { ...EMPTY_FORM, name: " Pizza Grande ", price: "45,90", stock: "12", categoryId: "cat-1" };

describe("formulário de produto", () => {
  it("valida e converte o preço por string", () => {
    const result = validateProductForm(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        name: "Pizza Grande",
        description: "",
        priceInCents: 4590,
        stock: 12,
        categoryId: "cat-1",
        photoUrl: null,
        optionGroupIds: [],
      },
    });
  });

  it("recusa com mensagem que a pessoa entende", () => {
    expect(validateProductForm({ ...valid, name: "  " })).toEqual({ ok: false, error: "Informe o nome do produto." });
    expect(validateProductForm({ ...valid, price: "45,999" })).toEqual({
      ok: false,
      error: "Informe o preço no formato 12,50.",
    });
    expect(validateProductForm({ ...valid, stock: "-1" })).toEqual({
      ok: false,
      error: "O estoque é um número inteiro, zero ou mais.",
    });
    expect(validateProductForm({ ...valid, photoUrl: "foto.jpg" })).toEqual({
      ok: false,
      error: "Cole um endereço completo de imagem, começando com https://.",
    });
  });

  it("criação omite o que ficou vazio", () => {
    const result = validateProductForm({ ...valid, categoryId: "" });
    if (!result.ok) throw new Error("devia ser válido");
    expect(toCreateBody(result.value)).toEqual({ name: "Pizza Grande", priceInCents: 4590, stock: 12 });
  });

  it("edição manda categoryId null para tirar da seção", () => {
    const result = validateProductForm({ ...valid, categoryId: "", description: "Massa fina" });
    if (!result.ok) throw new Error("devia ser válido");
    expect(toUpdateBody(result.value)).toEqual({
      name: "Pizza Grande",
      priceInCents: 4590,
      stock: 12,
      categoryId: null,
      description: "Massa fina",
    });
  });

  it("carrega um produto existente para edição", () => {
    expect(fromProduct(makeProduct({ priceInCents: 4590, stock: 12, optionGroupIds: ["g1"] }))).toMatchObject({
      price: "45,90",
      stock: "12",
      categoryId: "cat-1",
      optionGroupIds: ["g1"],
    });
  });

  it("ordem dos grupos importa", () => {
    expect(sameIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameIds(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("detecta alteração", () => {
    expect(isDirty(EMPTY_FORM, EMPTY_FORM)).toBe(false);
    expect(isDirty({ ...EMPTY_FORM, name: "x" }, EMPTY_FORM)).toBe(true);
  });
});
