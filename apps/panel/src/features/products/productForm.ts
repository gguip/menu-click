import type { CreateProductBody, UpdateProductBody } from "../../api/products.ts";
import type { Product } from "../../api/types.ts";
import { centsToInput, parseReaisToCents } from "../../lib/money.ts";

/** O que a pessoa digita: tudo texto, até ser validado. */
export type ProductForm = {
  name: string;
  description: string;
  price: string;
  stock: string;
  categoryId: string;
  photoUrl: string;
  optionGroupIds: string[];
};

export const EMPTY_FORM: ProductForm = {
  name: "",
  description: "",
  price: "",
  stock: "0",
  categoryId: "",
  photoUrl: "",
  optionGroupIds: [],
};

export function fromProduct(product: Product): ProductForm {
  return {
    name: product.name,
    description: product.description ?? "",
    price: centsToInput(product.priceInCents),
    stock: String(product.stock),
    categoryId: product.categoryId ?? "",
    photoUrl: product.photoUrl ?? "",
    optionGroupIds: [...product.optionGroupIds],
  };
}

export type ValidProduct = {
  name: string;
  description: string;
  priceInCents: number;
  stock: number;
  categoryId: string | null;
  photoUrl: string | null;
  optionGroupIds: string[];
};

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateProductForm(
  form: ProductForm,
): { ok: true; value: ValidProduct } | { ok: false; error: string } {
  const name = form.name.trim();
  if (name === "") return { ok: false, error: "Informe o nome do produto." };
  const priceInCents = parseReaisToCents(form.price);
  if (priceInCents === null) return { ok: false, error: "Informe o preço no formato 12,50." };
  const stock = form.stock.trim();
  if (!/^\d+$/.test(stock)) return { ok: false, error: "O estoque é um número inteiro, zero ou mais." };
  const photoUrl = form.photoUrl.trim();
  if (photoUrl !== "" && !isHttpUrl(photoUrl)) {
    return { ok: false, error: "Cole um endereço completo de imagem, começando com https://." };
  }
  return {
    ok: true,
    value: {
      name,
      description: form.description.trim(),
      priceInCents,
      stock: Number(stock),
      categoryId: form.categoryId === "" ? null : form.categoryId,
      photoUrl: photoUrl === "" ? null : photoUrl,
      optionGroupIds: form.optionGroupIds,
    },
  };
}

export function toCreateBody(value: ValidProduct): CreateProductBody {
  return {
    name: value.name,
    priceInCents: value.priceInCents,
    stock: value.stock,
    ...(value.categoryId !== null ? { categoryId: value.categoryId } : {}),
    ...(value.description !== "" ? { description: value.description } : {}),
    ...(value.photoUrl !== null ? { photoUrl: value.photoUrl } : {}),
  };
}

export function toUpdateBody(value: ValidProduct): UpdateProductBody {
  return {
    name: value.name,
    priceInCents: value.priceInCents,
    stock: value.stock,
    categoryId: value.categoryId,
    description: value.description,
    ...(value.photoUrl !== null ? { photoUrl: value.photoUrl } : {}),
  };
}

export function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

export function isDirty(current: ProductForm, initial: ProductForm): boolean {
  return JSON.stringify(current) !== JSON.stringify(initial);
}
