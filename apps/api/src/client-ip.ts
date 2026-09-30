import { normalizeIP } from "@fastify/rate-limit";
import type { FastifyRequest } from "fastify";

/**
 * O prefixo IPv6 que conta como um cliente só — o mesmo /64 do gerador de
 * chave padrão do `@fastify/rate-limit`. Uma conexão IPv6 residencial ou
 * móvel controla um /64 inteiro: sem agrupar, dá para trocar de endereço a
 * cada tentativa de login e nunca chegar ao 429.
 */
const IPV6_SUBNET = 64;

/**
 * A chave do limite de requisições: o header configurado (ver
 * `parseClientIpHeader`), e o `request.ip` quando ele não veio — em dev, nos
 * testes, e em qualquer requisição que não passou pelo proxy. Nos dois casos
 * o endereço passa pelo mesmo `normalizeIP` do plugin (IPv6 agrupado por /64).
 */
export function clientIpKey(header: string | null) {
  return (request: FastifyRequest): string => {
    if (header !== null) {
      const value = request.headers[header];
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string" && first.trim() !== "") return normalizeIP(first.trim(), IPV6_SUBNET);
    }
    return normalizeIP(request.ip, IPV6_SUBNET);
  };
}
