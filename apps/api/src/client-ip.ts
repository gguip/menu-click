import type { FastifyRequest } from "fastify";

/**
 * A chave do limite de requisições: o header configurado (ver
 * `parseClientIpHeader`), e o `request.ip` quando ele não veio — em dev, nos
 * testes, e em qualquer requisição que não passou pelo proxy.
 */
export function clientIpKey(header: string | null) {
  return (request: FastifyRequest): string => {
    if (header !== null) {
      const value = request.headers[header];
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string" && first.trim() !== "") return first.trim();
    }
    return request.ip;
  };
}
