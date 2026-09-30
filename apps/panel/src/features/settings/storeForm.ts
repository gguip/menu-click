import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";

export type StoreForm = {
  name: string;
  cuisineType: string;
  timezone: string;
  logoUrl: string;
  coverUrl: string;
  /** #RRGGBB, ou vazio (= azul padrão do app do cliente). */
  brandColor: string;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

export function fromRestaurant(restaurant: Restaurant): StoreForm {
  return {
    name: restaurant.name,
    cuisineType: restaurant.cuisineType,
    timezone: restaurant.timezone,
    logoUrl: restaurant.logoUrl ?? "",
    coverUrl: restaurant.coverUrl ?? "",
    brandColor: restaurant.brandColor ?? "",
    street: restaurant.address.street,
    number: restaurant.address.number,
    neighborhood: restaurant.address.neighborhood,
    city: restaurant.address.city,
    state: restaurant.address.state,
    zipCode: restaurant.address.zipCode,
  };
}

const ADDRESS_FIELDS = ["street", "number", "neighborhood", "city", "state", "zipCode"] as const;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateStoreForm(form: StoreForm): string | null {
  if (form.name.trim() === "") return "Informe o nome da loja.";
  if (form.cuisineType.trim() === "") return "Informe o tipo de cozinha.";
  if (ADDRESS_FIELDS.some((field) => form[field].trim() === "")) {
    return "Preencha o endereço completo da loja.";
  }
  const logoUrl = form.logoUrl.trim();
  const coverUrl = form.coverUrl.trim();
  if ((logoUrl !== "" && !isHttpUrl(logoUrl)) || (coverUrl !== "" && !isHttpUrl(coverUrl))) {
    return "Cole um endereço completo de imagem, começando com https://.";
  }
  const brandColor = form.brandColor.trim();
  if (brandColor !== "" && !/^#[0-9A-Fa-f]{6}$/.test(brandColor)) {
    return "Use a cor no formato #RRGGBB, por exemplo #1E5AE8.";
  }
  return null;
}

/**
 * Só o que mudou. O endereço vai INTEIRO quando qualquer campo dele muda: a
 * API o recebe como objeto, e mandar meio endereço apagaria o resto.
 */
export function changedPatch(form: StoreForm, initial: StoreForm): RestaurantPatch {
  const patch: RestaurantPatch = {};
  if (form.name.trim() !== initial.name) patch.name = form.name.trim();
  if (form.cuisineType.trim() !== initial.cuisineType) patch.cuisineType = form.cuisineType.trim();
  if (form.timezone !== initial.timezone) patch.timezone = form.timezone;
  const logoUrl = form.logoUrl.trim();
  // Esvaziar o campo tira o logo: a API aceita `null` (string vazia seria 400
  // pelo `format: uri`).
  if (logoUrl !== initial.logoUrl) patch.logoUrl = logoUrl === "" ? null : logoUrl;
  const coverUrl = form.coverUrl.trim();
  if (coverUrl !== initial.coverUrl) patch.coverUrl = coverUrl === "" ? null : coverUrl;
  // maiúsculas antes de comparar: "#0b7a48" e "#0B7A48" são a mesma cor
  const brandColor = form.brandColor.trim().toUpperCase();
  if (brandColor !== initial.brandColor.toUpperCase()) {
    patch.brandColor = brandColor === "" ? null : brandColor;
  }
  // `state` é comparado já em maiúsculas: é o valor que de fato vai no PATCH
  // (`toUpperCase()` abaixo). Comparar o cru deixava "rj" ficar para sempre
  // "diferente" de "RJ", mesmo depois de salvar.
  const dirtyAddress = ADDRESS_FIELDS.some((field) => {
    const value = form[field].trim();
    return field === "state" ? value.toUpperCase() !== initial.state : value !== initial[field];
  });
  if (dirtyAddress) {
    patch.address = {
      street: form.street.trim(),
      number: form.number.trim(),
      neighborhood: form.neighborhood.trim(),
      city: form.city.trim(),
      state: form.state.trim().toUpperCase(),
      zipCode: form.zipCode.trim(),
    };
  }
  return patch;
}
