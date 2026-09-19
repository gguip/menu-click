import { clearSession, readSession } from "./session.ts";

const BASE_URL = import.meta.env.VITE_API_URL ?? "/api";

/** Erro com status HTTP. A `message` vem da API, já em pt-BR para quem lê. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** O servidor nem respondeu: sem internet, API fora do ar, proxy caído. */
export class NetworkError extends Error {
  constructor() {
    super("Sem conexão com o servidor.");
    this.name = "NetworkError";
  }
}

type Query = Record<string, string | number | undefined>;

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Query;
  /** `false` nas rotas públicas (login, cadastro...): não manda sessão. */
  auth?: boolean;
};

let unauthorizedHandler: (() => void) | null = null;

/** Quem reage à sessão expirada (o app redireciona para o login). */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

function toQueryString(query?: Query): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, auth = true } = options;
  const session = auth ? readSession() : null;
  const headers: Record<string, string> = {};
  if (session) headers.Authorization = `Bearer ${session.token}`;
  // O Fastify responde 400 a `Content-Type: application/json` com corpo
  // vazio, então o header só vai quando há corpo.
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(BASE_URL + path + toQueryString(query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // 401 só é "sessão expirada" quando havia sessão: no login, 401 é senha
    // errada e não pode mandar ninguém para lugar nenhum.
    if (response.status === 401 && session) {
      clearSession();
      unauthorizedHandler?.();
    }
    const message =
      payload !== null && typeof payload === "object" && "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Algo deu errado. Tente de novo.";
    const retryAfter = response.headers.get("retry-after");
    throw new ApiError(response.status, message, retryAfter === null ? null : Number(retryAfter));
  }
  return payload as T;
}

/** Texto de erro para a tela. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    // A mensagem do rate limit vem em inglês do plugin; as outras a API
    // escreve em pt-BR para o cliente ler.
    if (error.status === 429) return "Muitas tentativas seguidas. Aguarde um instante e tente de novo.";
    return error.message;
  }
  if (error instanceof NetworkError) {
    return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  }
  return "Algo deu errado. Tente de novo.";
}
