import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OptionGroupsPage } from "../src/features/optionGroups/OptionGroupsPage.tsx";
import { type MockHandler, mockApi } from "./api-mock.ts";
import { makeOptionGroup, panelHandlers, RESTAURANT_ID, signIn } from "./fixtures.ts";
import { renderInPanel } from "./render.tsx";

const BASE = `/restaurants/${RESTAURANT_ID}`;
const OPTIONS = `${BASE}/option-groups/grp-1/options`;
const routes = [{ path: "/grupos-de-opcoes", element: <OptionGroupsPage /> }];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Promessa resolvida à mão, para controlar quando o PATCH "volta" — ver `test/modalities-page.test.tsx`. */
function defer<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const sabores = makeOptionGroup({
  id: "grp-1",
  name: "Sabores",
  minOptions: 0,
  maxOptions: 2,
  options: [
    { id: "opt-1", name: "Margherita", priceInCents: 6200, maxQuantity: 1, available: true, position: 0 },
    { id: "opt-2", name: "Calabresa", priceInCents: 7200, maxQuantity: 1, available: true, position: 1 },
  ],
});

function setup(extra: MockHandler[]) {
  signIn();
  const api = mockApi([
    ...extra,
    { method: "GET", path: `${BASE}/option-groups`, body: { data: [sabores], limit: 100, offset: 0, total: 1 } },
    { method: "GET", path: `${BASE}/products`, body: { data: [], limit: 100, offset: 0, total: 0 } },
    ...panelHandlers(),
  ]);
  renderInPanel(routes, "/grupos-de-opcoes");
  return api;
}

describe("OptionGroupsPage (opções)", () => {
  it("editar uma linha manda o PATCH só dela, só com o que mudou", async () => {
    const api = setup([{ method: "PATCH", path: `${OPTIONS}/opt-2`, body: { ...sabores.options[1], priceInCents: 7500 } }]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Calabresa" }));
    fireEvent.change(screen.getByLabelText("Preço da opção"), { target: { value: "75,00" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar Calabresa" }));
    await waitFor(() => expect(api.calls.some((call) => call.method === "PATCH")).toBe(true));
    const patches = api.calls.filter((call) => call.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe(`${OPTIONS}/opt-2`);
    expect(patches[0].body).toEqual({ priceInCents: 7500 });
  });

  it("'Disponível' volta atrás e mostra o erro quando a API recusa", async () => {
    setup([
      { method: "PATCH", path: `${OPTIONS}/opt-2`, status: 500, body: { message: "Algo deu errado no servidor" } },
    ]);
    const toggle = (await screen.findByRole("switch", { name: "Disponível: Calabresa" })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(await screen.findByText("Algo deu errado no servidor")).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByRole("switch", { name: "Disponível: Calabresa" }) as HTMLInputElement).checked).toBe(true),
    );
  });

  it("'Disponível' muda na hora, antes da resposta da API", async () => {
    const api = setup([]);
    // Segura o PATCH de opt-2 numa promessa própria; o resto continua indo
    // para o mock normal — é o padrão de `test/modalities-page.test.tsx`.
    const original = globalThis.fetch;
    const deferred = defer<Response>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname.replace(/^\/api/, "");
      const method = init.method ?? "GET";
      if (method === "PATCH" && path === `${OPTIONS}/opt-2`) return deferred.promise;
      return original(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const toggle = (await screen.findByRole("switch", { name: "Disponível: Calabresa" })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);
    // Antes de a promessa do PATCH resolver, o interruptor já mudou — é a
    // escrita otimista de `useToggleOptionAvailable` (onMutate), não o
    // resultado do PATCH.
    await waitFor(() => expect(toggle.checked).toBe(false));
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")).toHaveLength(1);

    // Quando o PATCH resolver, o `onSettled` relê a lista — o mock passa a
    // devolver a opção já indisponível, senão o refetch traria de volta o
    // estado antigo e a checagem final não provaria nada.
    api.add({
      method: "GET",
      path: `${BASE}/option-groups`,
      body: {
        data: [{ ...sabores, options: [sabores.options[0], { ...sabores.options[1], available: false }] }],
        limit: 100,
        offset: 0,
        total: 1,
      },
    });
    deferred.resolve(jsonResponse({ ...sabores.options[1], available: false }));
    await waitFor(() => expect(toggle.checked).toBe(false));
  });

  it("opção nova com preço vazio vai como R$ 0,00", async () => {
    const api = setup([
      {
        method: "POST",
        path: OPTIONS,
        status: 201,
        body: { id: "opt-3", name: "Ao ponto", priceInCents: 0, maxQuantity: 1, available: true, position: 2 },
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar opção em Sabores" }));
    const card = within(screen.getByRole("region", { name: "Sabores" }));
    fireEvent.change(card.getByLabelText("Nome da opção"), { target: { value: "Ao ponto" } });
    fireEvent.click(card.getByRole("button", { name: "Adicionar" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "POST")?.body).toEqual({
        name: "Ao ponto",
        priceInCents: 0,
        maxQuantity: 1,
      }),
    );
  });

  it("remove a opção pela linha em edição", async () => {
    const api = setup([{ method: "DELETE", path: `${OPTIONS}/opt-1`, status: 204 }]);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Margherita" }));
    fireEvent.click(screen.getByRole("button", { name: "Remover Margherita" }));
    await waitFor(() =>
      expect(api.calls.find((call) => call.method === "DELETE")?.path).toBe(`${OPTIONS}/opt-1`),
    );
  });
});
