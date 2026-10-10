import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductFormPage } from "../src/features/products/ProductFormPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import {
  makeCategory,
  makeOptionGroup,
  makeProduct,
  makeUploadSignature,
  panelHandlers,
  RESTAURANT_ID,
  signIn,
  UPLOADED_URL,
  uploadHandlers,
} from "./fixtures.ts";
import { LocationProbe, renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;

const reference: MockHandler[] = [
  {
    method: "GET",
    path: `${BASE}/categories`,
    body: { data: [makeCategory({ id: "cat-1", name: "Pizzas" })], limit: 100, offset: 0, total: 1 },
  },
  {
    method: "GET",
    path: `${BASE}/option-groups`,
    body: {
      data: [
        makeOptionGroup({ id: "grp-1", name: "Sabores", priceRule: "highest", minOptions: 1, maxOptions: 2 }),
        makeOptionGroup({ id: "grp-2", name: "Borda", priceRule: "sum", minOptions: 0, maxOptions: 1 }),
      ],
      limit: 100,
      offset: 0,
      total: 2,
    },
  },
];

const routes = [
  { path: "/produtos/novo", element: <ProductFormPage /> },
  { path: "/produtos/:productId", element: <ProductFormPage /> },
  { path: "/produtos", element: <LocationProbe /> },
];

function setup(handlers: MockHandler[], path: string) {
  signIn();
  const api = mockApi([...handlers, ...reference, ...panelHandlers()]);
  renderInPanel(routes, path);
  return api;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ProductFormPage", () => {
  it("cria o produto e depois grava os grupos na ordem escolhida", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        { method: "PUT", path: `${BASE}/products/prod-9/option-groups`, body: { optionGroups: [] } },
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    type("Estoque", "12");
    await screen.findByRole("option", { name: "Pizzas" });
    type("Seção", "cat-1");
    await screen.findByRole("option", { name: "Sabores" });
    type("Adicionar grupo já cadastrado", "grp-1");
    type("Adicionar grupo já cadastrado", "grp-2");
    expect(screen.getByText("Mais caro")).toBeTruthy();
    expect(screen.getByText("Margherita R$ 62 + Calabresa R$ 72 → R$ 72,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Subir Borda" }));
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "Pizza Grande",
      priceInCents: 4590,
      stock: 12,
      isSuggested: false,
      categoryId: "cat-1",
    });
    expect(api.calls.find((call) => call.method === "PUT")?.body).toEqual({ optionGroupIds: ["grp-2", "grp-1"] });
    // trocar os grupos do produto muda o "usado em N produtos" de cada um
    // (a listagem de grupos é buscada de novo: uma vez na tela, outra depois)
    expect(api.calls.filter((call) => call.method === "GET" && call.path === `${BASE}/option-groups`)).toHaveLength(2);
    expect(await screen.findByText("Alterações salvas")).toBeTruthy();
  });

  it("editar sem mexer nos grupos não regrava os grupos; 'Sem seção' manda null", async () => {
    const api = setup(
      [
        {
          method: "GET",
          path: `${BASE}/products/prod-1`,
          body: makeProduct({ id: "prod-1", optionGroupIds: ["grp-1"] }),
        },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
      ],
      "/produtos/prod-1",
    );
    expect(((await screen.findByLabelText("Preço (R$)")) as HTMLInputElement).value).toBe("45,90");
    type("Seção", "");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    await screen.findByTestId("location");
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      categoryId: null,
      priceInCents: 4590,
    });
    expect(api.calls.some((call) => call.method === "PUT")).toBe(false);
  });

  it("grupos que falham não escondem que o produto foi salvo", async () => {
    setup(
      [
        {
          method: "GET",
          path: `${BASE}/products/prod-1`,
          body: makeProduct({ id: "prod-1", optionGroupIds: ["grp-1"] }),
        },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
        {
          method: "PUT",
          path: `${BASE}/products/prod-1/option-groups`,
          status: 400,
          body: { message: "Grupo de opções inexistente" },
        },
      ],
      "/produtos/prod-1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remover Sabores" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(
      await screen.findByText("O produto foi salvo, mas os grupos de opções não: Grupo de opções inexistente"),
    ).toBeTruthy();
    expect(screen.queryByText("Alterações salvas")).toBeNull();
  });

  it("produto recém-criado troca para edição quando os grupos falham, e salvar de novo não duplica", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        {
          method: "PUT",
          path: `${BASE}/products/prod-9/option-groups`,
          status: 400,
          body: { message: "Grupo de opções inexistente" },
        },
        { method: "GET", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
        { method: "PATCH", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    type("Estoque", "12");
    await screen.findByRole("option", { name: "Sabores" });
    type("Adicionar grupo já cadastrado", "grp-1");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect(
      await screen.findByText("O produto foi salvo, mas os grupos de opções não: Grupo de opções inexistente"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    expect(api.calls.some((call) => call.method === "PATCH" && call.path === `${BASE}/products/prod-9`)).toBe(
      true,
    );
    expect(api.calls.filter((call) => call.method === "POST" && call.path === `${BASE}/products`)).toHaveLength(1);
  });

  it("preço inválido não chega à API", async () => {
    const api = setup([], "/produtos/novo");
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza");
    type("Preço (R$)", "45,999");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));
    expect(screen.getByText("Informe o preço no formato 12,50.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  const pickPhoto = async () =>
    fireEvent.change(await screen.findByLabelText("Foto"), {
      target: { files: [new File(["x"], "pizza.jpg", { type: "image/jpeg" })] },
    });
  const SAVED_PHOTO = `https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/${RESTAURANT_ID}/products/prod-1.jpg`;

  it("não tem mais campo de URL da foto", async () => {
    setup([], "/produtos/novo");
    await screen.findByLabelText("Nome");
    expect(screen.queryByLabelText("URL da foto")).toBeNull();
    expect(screen.getByLabelText("Foto")).toBeTruthy();
  });

  it("produto novo com foto: cria, assina com o id novo, envia e grava a foto", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        { method: "PATCH", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
        ...uploadHandlers(),
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect((await screen.findByTestId("location")).textContent).toBe("/produtos");
    const writes = api.calls.filter((call) => call.method !== "GET");
    expect(writes.map((call) => `${call.method} ${call.host}${call.path}`)).toEqual([
      `POST localhost${BASE}/products`,
      `POST localhost${BASE}/uploads/signature`,
      "POST api.cloudinary.com/v1_1/nuvem/image/upload",
      `PATCH localhost${BASE}/products/prod-9`,
    ]);
    // a criação não leva foto: o endereço da imagem depende do id
    expect(writes[0].body).toEqual({
      name: "Pizza Grande",
      priceInCents: 4590,
      stock: 0,
      isSuggested: false,
    });
    expect(writes[1].body).toEqual({ target: "product", productId: "prod-9" });
    expect(writes[3].body).toEqual({ photoUrl: UPLOADED_URL });
  });

  it("produto novo cuja foto não sobe: fica criado e a tela vira a de edição, com o aviso", async () => {
    const api = setup(
      [
        { method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) },
        { method: "GET", path: `${BASE}/products/prod-9`, body: makeProduct({ id: "prod-9" }) },
        ...uploadHandlers({ uploadStatus: 401 }),
      ],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect(await screen.findByText("Produto criado, mas a foto não subiu. Tente de novo.")).toBeTruthy();
    // é a edição do produto criado: salvar de novo não cria um segundo
    await waitFor(() =>
      expect(api.calls.some((call) => call.method === "GET" && call.path === `${BASE}/products/prod-9`)).toBe(true),
    );
    expect(api.calls.filter((call) => call.method === "POST" && call.path === `${BASE}/products`)).toHaveLength(1);
  });

  it("editar e trocar a foto: envia antes, e a foto vai no mesmo PATCH", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1", photoUrl: SAVED_PHOTO }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
        {
          method: "POST",
          path: `${BASE}/uploads/signature`,
          body: makeUploadSignature({ publicId: `menuclick/${RESTAURANT_ID}/products/prod-1` }),
        },
        ...uploadHandlers(),
      ],
      "/produtos/prod-1",
    );
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByTestId("location");
    const patches = api.calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toMatchObject({ name: "Pizza Grande", photoUrl: UPLOADED_URL });
    expect(api.calls.find((call) => call.path === `${BASE}/uploads/signature`)?.body).toEqual({
      target: "product",
      productId: "prod-1",
    });
  });

  it("editar sem mexer na foto não manda photoUrl", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1", photoUrl: SAVED_PHOTO }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
      ],
      "/produtos/prod-1",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Gigante");
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByTestId("location");
    const body = api.calls.find((call) => call.method === "PATCH")?.body as Record<string, unknown>;
    expect("photoUrl" in body).toBe(false);
  });

  it("Remover a foto manda photoUrl null", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1", photoUrl: SAVED_PHOTO }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
      ],
      "/produtos/prod-1",
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remover Foto" }));
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    await screen.findByTestId("location");
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ photoUrl: null });
  });

  it("dois cliques em Salvar num produto novo criam um produto só", async () => {
    const api = setup(
      [{ method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) }],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    const save = screen.getByRole("button", { name: "Salvar produto" });
    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByTestId("location");
    expect(api.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("editar: envio que falha mostra o motivo e não grava nada", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ id: "prod-1" }) },
        ...uploadHandlers({ uploadStatus: 401 }),
      ],
      "/produtos/prod-1",
    );
    await pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    expect(await screen.findByText("O envio da imagem falhou. Tente de novo.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  // dois cliques no MESMO instante, antes de a tela redesenhar: o botão em
  // carregamento ainda não existe, só a trava do próprio salvar segura
  it("dois cliques no mesmo instante num produto novo criam um produto só", async () => {
    const api = setup(
      [{ method: "POST", path: `${BASE}/products`, status: 201, body: makeProduct({ id: "prod-9" }) }],
      "/produtos/novo",
    );
    await screen.findByLabelText("Nome");
    type("Nome", "Pizza Grande");
    type("Preço (R$)", "45,90");
    const save = screen.getByRole("button", { name: "Salvar produto" });
    act(() => {
      save.click();
      save.click();
    });

    await screen.findByTestId("location");
    expect(api.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("o interruptor de sugestão reflete o produto e sai no PATCH", async () => {
    const api = setup(
      [
        { method: "GET", path: `${BASE}/products/prod-1`, body: makeProduct({ isSuggested: false }) },
        { method: "PATCH", path: `${BASE}/products/prod-1`, body: makeProduct({ isSuggested: true }) },
      ],
      "/produtos/prod-1",
    );
    const toggle = (await screen.findByRole("switch", { name: "Sugerir no carrinho" })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    screen.getByText('Aparece em "Que tal adicionar?" quando o cliente abre o carrinho.');

    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Salvar produto" }));

    const patches = () => api.calls.filter((call) => call.method === "PATCH" && call.path === `${BASE}/products/prod-1`);
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0].body).toMatchObject({ isSuggested: true });
  });
});
