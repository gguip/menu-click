import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTodaySummary } from "../src/features/orders/useSummary.ts";
import { StoreDataPage } from "../src/features/settings/StoreDataPage.tsx";
import { mockApi } from "./api-mock.ts";
import { makeRestaurant, panelHandlers, RESTAURANT_ID, signIn, UPLOADED_URL, uploadHandlers } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const routes = [{ path: "/dados-da-loja", element: <StoreDataPage /> }];

/** Fica ao lado da tela, do mesmo jeito que o header do painel ficaria. */
function SummaryProbe() {
  useTodaySummary(RESTAURANT_ID);
  return null;
}

describe("StoreDataPage", () => {
  it("mostra o slug, desabilitado, com o porquê", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    const slug = (await screen.findByLabelText("Endereço público")) as HTMLInputElement;
    expect(slug.disabled).toBe(true);
    expect(slug.value).toContain("trattoria-bella");
    expect(
      screen.getByText("É a URL dentro do QR code impresso — por isso não muda por aqui."),
    ).toBeTruthy();
  });

  it("salva só o que mudou", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ name: "Trattoria Bela" }) },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), {
      target: { value: "Trattoria Bela" },
    });
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({
        name: "Trattoria Bela",
      }),
    );
    expect(await screen.findByText("Alterações salvas")).toBeTruthy();
  });

  it("salvar que falha não avisa que salvou", async () => {
    signIn();
    mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, status: 500, body: { message: "Algo deu errado no servidor" } },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), { target: { value: "Trattoria Bela" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    expect(await screen.findByText("Algo deu errado no servidor")).toBeTruthy();
    expect(screen.queryByText("Alterações salvas")).toBeNull();
  });

  it("o fuso é uma lista fechada, com o aviso do que ele decide", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    const timezone = await screen.findByLabelText("Fuso horário");
    expect(timezone.tagName).toBe("SELECT");
    expect(screen.getByText("É ele que decide onde o dia começa: “pedidos de hoje” e o faturamento do topo mudam junto.")).toBeTruthy();
  });

  it("fuso fora da lista aparece como opção '(atual)', selecionada", async () => {
    signIn();
    mockApi(panelHandlers({ restaurant: { timezone: "Brazil/East" } }));
    renderInPanel(routes, "/dados-da-loja");
    const timezone = (await screen.findByLabelText("Fuso horário")) as HTMLSelectElement;
    expect(timezone.value).toBe("Brazil/East");
    expect(screen.getByText("Brazil/East (atual)")).toBeTruthy();
  });

  it("campo obrigatório vazio nem chega à API", async () => {
    signIn();
    const api = mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));
    expect(screen.getByText("Informe o nome da loja.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("um refetch que falha não troca o editor pela mensagem, e o que foi digitado continua lá", async () => {
    signIn();
    const api = mockApi(panelHandlers());
    const { queryClient } = renderInPanel(routes, "/dados-da-loja");
    const nome = (await screen.findByLabelText("Nome da loja")) as HTMLInputElement;
    fireEvent.change(nome, { target: { value: "Trattoria Bela" } });

    api.add({
      method: "GET",
      path: `/restaurants/${RESTAURANT_ID}`,
      status: 503,
      body: { statusCode: 503, error: "Service Unavailable", message: "Fora do ar" },
      once: true,
    });
    await queryClient.refetchQueries({ queryKey: ["restaurant", RESTAURANT_ID] });

    expect(await screen.findByLabelText("Nome da loja")).toBeTruthy();
    expect((screen.getByLabelText("Nome da loja") as HTMLInputElement).value).toBe("Trattoria Bela");
    expect(screen.queryByText("Fora do ar")).toBeNull();
  });

  it("trocar o fuso invalida as queries de pedidos, para o header atualizar na hora", async () => {
    signIn();
    const api = mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        body: makeRestaurant({ timezone: "America/Bahia" }),
      },
      ...panelHandlers(),
    ]);
    renderInPanel(
      [{ path: "/dados-da-loja", element: <><StoreDataPage /><SummaryProbe /></> }],
      "/dados-da-loja",
    );
    const timezone = await screen.findByLabelText("Fuso horário");
    const summaryCallsBefore = api.calls.filter(
      (call) => call.method === "GET" && call.path.endsWith("/orders/summary"),
    ).length;

    fireEvent.change(timezone, { target: { value: "America/Bahia" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    await waitFor(() =>
      expect(
        api.calls.filter((call) => call.method === "GET" && call.path.endsWith("/orders/summary")).length,
      ).toBeGreaterThan(summaryCallsBefore),
    );
  });

  it("trocar o fuso refaz o restaurante: o 'fecha 23:30' do rail muda de fuso", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ timezone: "America/Bahia" }) },
      ...panelHandlers(),
    ]);
    renderInPanel([{ path: "/dados-da-loja", element: <StoreDataPage /> }], "/dados-da-loja");
    const timezone = await screen.findByLabelText("Fuso horário");
    const restaurantGets = () =>
      api.calls.filter((call) => call.method === "GET" && call.path === `/restaurants/${RESTAURANT_ID}`).length;
    const before = restaurantGets();

    fireEvent.change(timezone, { target: { value: "America/Bahia" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() => expect(restaurantGets()).toBeGreaterThan(before));
  });

  const SAVED_LOGO = `https://res.cloudinary.com/nuvem/image/upload/v1/menuclick/${RESTAURANT_ID}/logo.jpg`;
  const pickLogo = async () =>
    fireEvent.change(await screen.findByLabelText("Logo"), {
      target: { files: [new File(["x"], "logo.jpg", { type: "image/jpeg" })] },
    });

  it("não tem mais campo de URL de imagem", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    await screen.findByLabelText("Nome da loja");
    expect(screen.queryByLabelText("URL do logo")).toBeNull();
    expect(screen.queryByLabelText("Capa do cardápio (URL)")).toBeNull();
    expect(screen.getByLabelText("Logo")).toBeTruthy();
    expect(screen.getByLabelText("Capa do cardápio")).toBeTruthy();
  });

  it("trocar o logo: escolher suja o formulário, e salvar assina, envia e grava a secure_url", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ logoUrl: UPLOADED_URL }) },
      ...uploadHandlers(),
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
    // escolher não envia nada
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ logoUrl: UPLOADED_URL }),
    );
    const posts = api.calls.filter((call) => call.method === "POST");
    expect(posts.map((call) => call.host)).toEqual(["localhost", "api.cloudinary.com"]);
    expect(posts[0].body).toEqual({ target: "logo" });
    await waitFor(() => expect(screen.queryByText("Alterações não salvas")).toBeNull());
  });

  it("a capa é assinada como capa", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant() },
      ...uploadHandlers(),
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Capa do cardápio"), {
      target: { files: [new File(["x"], "capa.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(api.calls.find((call) => call.method === "POST" && call.host === "localhost")?.body).toEqual({
      target: "cover",
    });
    expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ coverUrl: UPLOADED_URL });
  });

  it("envio que falha mostra o motivo, não chama o PATCH e deixa o formulário sujo", async () => {
    signIn();
    const api = mockApi([...uploadHandlers({ uploadStatus: 401 }), ...panelHandlers()]);
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    expect(await screen.findByText("O envio da imagem falhou. Tente de novo.")).toBeTruthy();
    expect(api.calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(screen.getByText("Alterações não salvas")).toBeTruthy();
  });

  it("Remover manda null, sem enviar nada", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant() },
      ...panelHandlers({ restaurant: { logoUrl: SAVED_LOGO } }),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.click(await screen.findByRole("button", { name: "Remover Logo" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ logoUrl: null }),
    );
    expect(api.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("mudar só o nome não manda campo de imagem", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ name: "Trattoria Bela" }) },
      ...panelHandlers({ restaurant: { logoUrl: SAVED_LOGO } }),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    fireEvent.change(await screen.findByLabelText("Nome da loja"), { target: { value: "Trattoria Bela" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar dados" }));

    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "PATCH")?.body).toEqual({ name: "Trattoria Bela" }),
    );
  });

  it("Cancelar desfaz a imagem escolhida", async () => {
    signIn();
    mockApi(panelHandlers());
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("Alterações não salvas")).toBeNull();
    expect(screen.getAllByText("Sem imagem")).toHaveLength(2);
  });

  it("dois cliques em Salvar durante o envio fazem um envio só", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ logoUrl: UPLOADED_URL }) },
      ...uploadHandlers(),
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    const save = screen.getByRole("button", { name: "Salvar dados" });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(api.calls.filter((call) => call.host === "api.cloudinary.com")).toHaveLength(1);
    expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });

  it("dois cliques no mesmo instante fazem um envio só", async () => {
    signIn();
    const api = mockApi([
      { method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ logoUrl: UPLOADED_URL }) },
      ...uploadHandlers(),
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/dados-da-loja");
    await pickLogo();
    const save = screen.getByRole("button", { name: "Salvar dados" });
    act(() => {
      save.click();
      save.click();
    });

    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(api.calls.filter((call) => call.host === "api.cloudinary.com")).toHaveLength(1);
    expect(api.calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });
});
