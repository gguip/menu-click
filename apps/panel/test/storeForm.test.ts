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
      brandColor: "",
      street: "Rua Aspicuelta",
      number: "120",
      neighborhood: "Vila Madalena",
      city: "São Paulo",
      state: "SP",
      zipCode: "05433-010",
    });
  });

  it("cor esvaziada vai como null; preenchida, em maiúsculas", () => {
    const withBrand = { ...initial, brandColor: "#0B7A48" };
    expect(changedPatch({ ...withBrand, brandColor: "" }, withBrand)).toEqual({ brandColor: null });
    expect(changedPatch({ ...initial, brandColor: "#0b7a48" }, initial)).toEqual({ brandColor: "#0B7A48" });
  });

  it("cor fora de #RRGGBB não chega à API", () => {
    expect(validateStoreForm({ ...initial, brandColor: "azul" })).toBe(
      "Use a cor no formato #RRGGBB, por exemplo #1E5AE8.",
    );
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
  });
});
