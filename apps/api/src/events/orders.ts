import { EventEmitter } from "node:events";
import type { Order } from "../domain/order.ts";

/**
 * O canal interno por onde uma mudança de status chega às conexões abertas.
 *
 * O nome do evento é o **id do pedido**, e não um evento único com filtro: é o
 * próprio `EventEmitter` que faz o roteamento por assunto, então uma conexão
 * jamais recebe o pedido de outra pessoa. Fosse um evento só, essa separação
 * viraria um `if` dentro de cada listener — e um `if` esquecido ali vaza o
 * pedido de um cliente para todos os outros conectados.
 *
 * ⚠️ **O emissor é do processo.** Com duas instâncias da API, um cliente
 * conectado na A não recebe o evento publicado na B — e a falha é silenciosa: a
 * tela simplesmente não atualiza. É a mesma limitação do contador de rate
 * limit, e a mesma solução (pub/sub no Redis). Está escrito aqui para não ser
 * descoberto em produção.
 */
const emitter = new EventEmitter();

/**
 * Anuncia o novo estado do pedido.
 *
 * **Só pode ser chamado depois do commit.** Publicar de dentro da transação
 * anuncia um estado que ainda pode sofrer rollback — e o cliente veria "saiu
 * para entrega" de um pedido que continuou em preparo.
 */
export function publish(order: Order): void {
  emitter.emit(order.id, order);
}

/**
 * Escuta as mudanças de um pedido. Devolve a função que cancela a inscrição.
 *
 * Chamar o retorno no `close` do socket não é opcional: sem isso os listeners
 * se acumulam por conexão que caiu, e o emissor segura a referência do socket
 * morto para sempre. O `EventEmitter` apaga a entrada quando o último listener
 * daquele id sai, então a limpeza é completa — não sobra a chave.
 *
 * O limite padrão de 10 listeners por evento fica como está: mais de dez
 * conexões vivas no MESMO pedido é sintoma de inscrição não cancelada, e o
 * aviso do Node é justamente o alarme que queremos.
 */
export function subscribe(
  orderId: string,
  listener: (order: Order) => void,
): () => void {
  emitter.on(orderId, listener);
  return () => {
    emitter.off(orderId, listener);
  };
}
