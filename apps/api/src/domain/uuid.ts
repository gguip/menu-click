/**
 * `id` é uma coluna `uuid`: mandar uma string fora do formato faz o Postgres
 * estourar `invalid input syntax for type uuid`, o que viraria 500. A API
 * sempre respondeu 404 para id inexistente, então os serviços checam o formato
 * antes de chamar o repositório (S9).
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}
