import type { CreateProductBody, UpdateProductBody } from "../../api/products.ts";
import type { Product } from "../../api/types.ts";
import { centsToInput, parseReaisToCents } from "../../lib/money.ts";

/** O que a pessoa digita: tudo texto, até ser validado. */
export type ProductForm = {
  name: string;
  description: string;
  price: string;
  stock: string;
  isSuggested: boolean;
  categoryId: string;
  optionGroupIds: string[];
};

export const EMPTY_FORM: ProductForm = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  isSuggested: false,
  categoryId: "",
  optionGroupIds: [],
};

export function fromProduct(product: Product): ProductForm {
  return {
    name: product.name,
    description: product.description ?? "",
    price: centsToInput(product.priceInCents),
    stock: String(product.stock),
    isSuggested: product.isSuggested,
    categoryId: product.categoryId ?? "",
    optionGroupIds: [...product.optionGroupIds],
  };
}

export type ValidProduct = {
  name: string;
  description: string;
  priceInCents: number;
  stock: number;
  isSuggested: boolean;
  categoryId: string | null;
  optionGroupIds: string[];
};

export function validateProductForm(
  form: ProductForm,
): { ok: true; value: ValidProduct } | { ok: false; error: string } {
  const name = form.name.trim();
  if (name === "") return { ok: false, error: "Informe o nome do produto." };
  const priceInCents = parseReaisToCents(form.price);
  if (priceInCents === null) return { ok: false, error: "Informe o preço no formato 12,50." };
  const stock = form.stock.trim();
  if (!/^\d+$/.test(stock)) return { ok: false, error: "O estoque é um número inteiro, zero ou mais." };
  return {
    ok: true,
    value: {
      name,
      description: form.description.trim(),
      priceInCents,
      stock: Number(stock),
      isSuggested: form.isSuggested,
      categoryId: form.categoryId === "" ? null : form.categoryId,
      optionGroupIds: form.optionGroupIds,
    },
  };
}

export function toCreateBody(value: ValidProduct): CreateProductBody {
  return {
    name: value.name,
    priceInCents: value.priceInCents,
    stock: value.stock,
    isSuggested: value.isSuggested,
    ...(value.categoryId !== null ? { categoryId: value.categoryId } : {}),
    ...(value.description !== "" ? { description: value.description } : {}),
  };
}

export function toUpdateBody(value: ValidProduct): UpdateProductBody {
  return {
    name: value.name,
    priceInCents: value.priceInCents,
    stock: value.stock,
    isSuggested: value.isSuggested,
    categoryId: value.categoryId,
    description: value.description,
  };
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function isDirty(current: ProductForm, initial: ProductForm): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
