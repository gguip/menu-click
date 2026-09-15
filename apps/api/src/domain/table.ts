/**
 * Modelo de mesa — o salão, e o identificador que vai dentro do QR code.
 *
 * A mesa existe porque `dine_in` não sabia DE ONDE vinha o pedido: o slug é um
 * só por restaurante, então todo QR do salão abria a mesma URL e o pedido
 * chegava com o nome do cliente e nada mais. Ela **só identifica** — não tem
 * estado, não acumula conta, não fecha total. Cada pedido segue independente,
 * com a trilha de status que já existia.
 */

import { randomBytes } from "node:crypto";

/** Campos que o restaurante envia para criar uma mesa. */
export type CreateTableInput = {
  /** "Mesa 7", "Varanda 2", "Balcão" — quem nomeia o salão trabalha nele. */
  label: string;
};

/** Edição de mesa: só o rótulo. O hash muda pela rotação, nunca por PATCH. */
export type UpdateTableInput = Partial<CreateTableInput>;

/** Mesa completa, como é guardada. */
export type Table = CreateTableInput & {
  id: string;
  restaurantId: string;
  hash: string;
  createdAt: string;
  updatedAt: string;
};

/** Mesa como a API a devolve: com a URL do QR já montada. */
export type TableWithQrUrl = Table & { qrUrl: string };

/**
 * 16 bytes sorteados, em `base64url` — 22 caracteres.
 *
 * ⚠️ NÃO vive em `tokens.ts`, e a separação é deliberada. Aquele arquivo se
 * abre dizendo que o valor sorteado "vai para o cliente **uma vez**, e o banco
 * guarda só o hash". As duas metades são falsas aqui: a mesa é reimprimível
 * por requisito, e por isso fica em claro no banco. Reaproveitar o gerador de
 * lá obrigaria a afrouxar aquela documentação, e abriria a porta para alguém
 * guardar um segredo de verdade em claro "seguindo o exemplo da mesa".
 *
 * São 16 bytes, e não os 32 de `tokens.ts`, porque o critério é outro: lá o
 * tamanho vem de "isto protege o dado de alguém", aqui vem de "isto é impresso
 * num adesivo, e cada caractere a mais adensa o QR" — QR mais denso escaneia
 * pior de longe e com luz ruim, que é a condição real de um salão. 128 bits já
 * tornam o chute impossível por qualquer medida prática.
 */
export function generateTableHash(): string {
  return randomBytes(16).toString("base64url");
}
