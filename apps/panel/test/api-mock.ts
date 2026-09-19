import { vi } from "vitest";

export type MockHandler = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Casado contra o caminho SEM o prefixo /api e sem querystring. */
  path: string | RegExp;
  /** Se presente, cada chave precisa bater com a querystring. */
  query?: Record<string, string>;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Responde uma vez e sai da lista (para simular "antes" e "depois"). */
  once?: boolean;
};

export type MockCall = {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
};

/**
 * Substitui o `fetch` global. O primeiro handler que casa responde — então
 * ponha os específicos (com `query` ou `once`) antes dos genéricos. Chamada
 * sem handler vira 500 com a mensagem "Chamada sem mock: ...", que aparece na
 * tela e denuncia o esquecimento.
 */
export function mockApi(initial: MockHandler[]) {
  const handlers = [...initial];
  const calls: MockCall[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace(/^\/api/, "");
    const query = Object.fromEntries(url.searchParams);
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, query, body, headers });

    const index = handlers.findIndex(
      (handler) =>
        handler.method === method &&
        (typeof handler.path === "string" ? handler.path === path : handler.path.test(path)) &&
        Object.entries(handler.query ?? {}).every(([key, value]) => query[key] === value),
    );
    if (index === -1) {
      return new Response(
        JSON.stringify({ statusCode: 500, error: "Mock", message: `Chamada sem mock: ${method} ${path}` }),
        { status: 500, headers: { "content-type": "application/json" } },
      );
    }
    const handler = handlers[index];
    if (handler.once) handlers.splice(index, 1);
    const status = handler.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(handler.body ?? {}), {
      status,
      headers: { "content-type": "application/json", ...handler.headers },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    /** Acrescenta um handler na FRENTE da lista (passa a ter prioridade). */
    add: (handler: MockHandler) => handlers.unshift(handler),
  };
}
