import { describe, expect, it } from "vitest";
import {
  changedPatch,
  fromRestaurant,
  validateStoreForm,
} from "../src/features/settings/storeForm.ts";
import { makeRestaurant } from "./fixtures.ts";

const restaurant = makeRestaurant();
const initial = fromRestaurant(restaurant);

describe("formulário de dados da loja", () => {
  it("carrega o restaurante no formulário", () => {
    expect(initial).toEqual({
      name: "Trattoria Bella",
      cuisineType: "Italiana",
      timezone: "America/Sao_Paulo",
      logoUrl: "",
      street: "Rua Aspicuelta",
      number: "120",
      neighborhood: "Vila Madalena",
      city: "São Paulo",
      state: "SP",
      zipCode: "05433-010",
    });
  });

  it("nada mudou, nada vai", () => {
    expect(changedPatch(initial, initial)).toEqual({});
  });

  it("manda só o campo alterado", () => {
    expect(changedPatch({ ...initial, name: "Trattoria Bela" }, initial)).toEqual({
      name: "Trattoria Bela",
    });
  });

  it("uma mudança no endereço manda o endereço inteiro", () => {
    expect(changedPatch({ ...initial, number: "121" }, initial)).toEqual({
      address: {
        street: "Rua Aspicuelta",
        number: "121",
        neighborhood: "Vila Madalena",
        city: "São Paulo",
        state: "SP",
        zipCode: "05433-010",
      },
    });
  });

  it("a UF sai em maiúsculas", () => {
    expect(changedPatch({ ...initial, state: "rj" }, initial)).toMatchObject({
      address: { state: "RJ" },
    });
  });

  it("UF em minúscula não deixa o formulário sujo para sempre", () => {
    const initialRJ = { ...initial, state: "RJ" };
    expect(changedPatch({ ...initialRJ, state: "rj" }, initialRJ)).toEqual({});
  });

  it("recusa o que a API recusaria", () => {
    expect(validateStoreForm(initial)).toBeNull();
    expect(validateStoreForm({ ...initial, name: "  " })).toBe("Informe o nome da loja.");
    expect(validateStoreForm({ ...initial, city: "" })).toBe("Preencha o endereço completo da loja.");
    expect(validateStoreForm({ ...initial, logoUrl: "logo.png" })).toBe(
      "Cole um endereço completo de imagem, começando com https://.",
    );
    expect(validateStoreForm({ ...initial, logoUrl: "https://cdn.exemplo/logo.png" })).toBeNull();
  });
});
