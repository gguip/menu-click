import type { PoolClient } from "pg";
import { withTransaction } from "../db/pool.ts";
import type { Page, Pagination } from "../domain/pagination.ts";
import type { OrderPeriod, PeriodFilter } from "../domain/period.ts";
import type { OrderSortField, SortDirection } from "../domain/order.ts";
import type { OrderSort } from "../repositories/orders.ts";
import type {
  CreatedOrder,
  CreateOrderInput,
  Order,
  OrderItemOption,
  OrderStatus,
  OrderSummary,
  OrderType,
} from "../domain/order.ts";
import type { OrderSummaryTotals } from "../domain/order.ts";
import {
  ORDER_STATUSES,
  REVENUE_STATUSES,
  canTransition,
  cancellingReturnsStock,
  isReachable,
  issuesTrackingToken,
} from "../domain/order.ts";
import type { OptionGroup, PricedGroup } from "../domain/option.ts";
import { unitPrice } from "../domain/option.ts";
import type { AcceptedPaymentFlags, PaymentMethod } from "../domain/payment.ts";
import { acceptedPaymentMethods } from "../domain/payment.ts";
import { isUuid } from "../domain/uuid.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import * as customersRepository from "../repositories/customers.ts";
import * as tablesRepository from "../repositories/tables.ts";
import * as openingHoursRepository from "../repositories/opening-hours.ts";
import * as ordersRepository from "../repositories/orders.ts";
import * as productsRepository from "../repositories/products.ts";
import type { Product } from "../domain/product.ts";
import type { Restaurant } from "../domain/restaurant.ts";
import * as optionGroupsRepository from "../repositories/option-groups.ts";
import { generateToken, hashToken } from "../tokens.ts";
import * as orderEvents from "../events/orders.ts";
import * as deliveryService from "./delivery.ts";
import * as restaurantsService from "./restaurants.ts";

/**
 * Serviço de pedidos: **a regra de negócio**.
 *
 * O que mora aqui e em nenhum outro lugar:
 *  1. o pedido congela nome e preço do produto no momento da criação — nada
 *     depois lê preço de `products` para calcular valor;
 *  2. o total é calculado no servidor, nunca aceito do cliente;
 *  3. pedido com entrega só existe em restaurante que entrega;
 *  4. criar pedido NÃO mexe em estoque (ver `confirm`, no próximo passo).
 *
 * Não há `services/customers.ts`: resolver o cliente é uma chamada só ao
 * repositório, sem regra própria, e uma camada de repasse não ganharia nada.
 */

/** Erro padrão de pedido inexistente — mesma mensagem em toda a API. */
function orderNotFound(id: string): NotFoundError {
  return new NotFoundError(`Pedido com id "${id}" não encontrado`);
}

/** Mesma mensagem do serviço de produtos, para o cliente não ver duas formas. */
function productNotFound(id: string): NotFoundError {
  return new NotFoundError(`Produto com id "${id}" não encontrado`);
}

/** Como cada modalidade se chama para quem lê a mensagem de erro. */
const NOME_DA_MODALIDADE: Record<OrderType, string> = {
  dine_in: "pedido no salão",
  takeaway: "retirada",
  delivery: "entrega",
};

/** Como cada forma de pagamento se chama para quem lê a mensagem de erro. */
const NOME_DA_FORMA: Record<PaymentMethod, string> = {
  cash: "dinheiro",
  card_on_delivery: "cartão na entrega",
  pix: "pix",
  meal_voucher: "vale-refeição",
};

/**
 * O restaurante aceita essa modalidade?
 *
 * As três flags são simétricas de propósito: sem `isTakeaway`, um restaurante
 * que só entrega passaria a aceitar retirada por omissão.
 */
function assertRestauranteAceita(
  restaurant: { isDelivery: boolean; isQrcode: boolean; isTakeaway: boolean },
  type: OrderType,
): void {
  const aceita: Record<OrderType, boolean> = {
    dine_in: restaurant.isQrcode,
    takeaway: restaurant.isTakeaway,
    delivery: restaurant.isDelivery,
  };

  if (!aceita[type]) {
    throw new ConflictError(
      `Este restaurante não aceita ${NOME_DA_MODALIDADE[type]}`,
    );
  }
}

/**
 * Recusa pedido com a loja fechada — **409**, conflito com o estado atual.
 *
 * As duas causas têm mensagens distintas de propósito: "fora do horário" e "a
 * loja pausou" pedem reações diferentes de quem está do outro lado — esperar
 * o horário, ou tentar de novo mais tarde.
 *
 * ⚠️ Isto NÃO é redundante com o `isOpen` do cardápio. O cardápio informa; a
 * criação decide. Entre uma coisa e outra cabe o tempo de montar o carrinho, e
 * cabe um cliente que chame a API direto, sem passar por tela nenhuma.
 *
 * Vale para as três modalidades, `dine_in` inclusive: com a loja fechada não
 * há ninguém no salão para servir. Horário por modalidade é outro conceito.
 */
/**
 * Recusa entrega abaixo do pedido mínimo da loja — **409**.
 *
 * Vale só em `delivery`: o mínimo existe porque entrega tem custo de piso —
 * sai entregador, sai veículo. Retirada e salão não custam nada a mais à loja,
 * e recusar um café de R$ 5 no balcão só perderia venda.
 *
 * ⚠️ Compara com o **subtotal dos itens**, nunca com o total. O total inclui o
 * frete, e somá-lo para atingir o mínimo faria o cliente pagar mais para
 * contornar exatamente o que a loja quis evitar: sair para entregar pouca
 * mercadoria. É o mesmo critério do "grátis acima de X", e pela mesma razão.
 *
 * Zero é "sem mínimo", e cai fora por comparação normal — não precisa de caso
 * especial.
 */
function assertAtingeMinimo(
  restaurant: Restaurant,
  type: OrderType,
  subtotalInCents: number,
): void {
  if (type !== "delivery") return;
  // o limite é INCLUSIVO: exclusivo recusaria o pedido de R$ 50,00 e aceitaria
  // o de R$ 50,01, o que ninguém consegue explicar ao cliente
  if (subtotalInCents >= restaurant.minimumOrderInCents) return;

  throw new ConflictError(
    `O pedido mínimo para entrega é de ${formataReais(restaurant.minimumOrderInCents)}`,
  );
}

/** Centavos em reais, para a mensagem que o cliente lê. */
function formataReais(centavos: number): string {
  return `R$ ${(centavos / 100).toFixed(2).replace(".", ",")}`;
}

/**
 * Loja que não provou o e-mail não existe para o cliente - nem para pedir.
 *
 * 404 e não 403 pelo mesmo motivo do cardápio: do lado de fora ela tem que
 * ser indistinguível de uma loja que não existe.
 *
 * Mora aqui, e não dentro do getById, porque aquele é usado por todo o
 * painel. Filtrar lá faria vinte rotas mudarem de significado de uma vez.
 */
function assertLojaVisivel(restaurant: Restaurant, restaurantId: string): void {
  if (restaurant.emailVerifiedAt === undefined) {
    throw new NotFoundError(`Restaurante com id "${restaurantId}" não encontrado`);
  }
}

async function assertLojaAberta(restaurant: Restaurant): Promise<void> {
  if (!restaurant.acceptingOrders) {
    throw new ConflictError(
      "A loja está pausada no momento. Tente de novo mais tarde",
    );
  }
  if (!(await openingHoursRepository.isOpenNow(restaurant.id, restaurant.timezone))) {
    throw new ConflictError("A loja está fechada agora");
  }
}

/**
 * Recusa forma que o restaurante não aceita — **409**, com a mesma forma do
 * `assertRestauranteAceita` que já recusa modalidade. É a mesma pergunta
 * ("este restaurante aceita isso?") e merece o mesmo formato de resposta.
 */
function assertFormaAceita(
  restaurant: AcceptedPaymentFlags,
  paymentMethod: PaymentMethod,
): void {
  if (!acceptedPaymentMethods(restaurant).includes(paymentMethod)) {
    throw new ConflictError(
      `Este restaurante não aceita ${NOME_DA_FORMA[paymentMethod]}`,
    );
  }
}

/**
 * Recusa troco incoerente — **400**, porque é corpo malformado e não conflito
 * de estado.
 *
 * ⚠️ A comparação é com o total calculado no SERVIDOR. O corpo não tem
 * `totalInCents` (aceitá-lo deixaria quem paga escolher o preço), e comparar
 * com um número do cliente deixaria esta validação sem sentido.
 */
function assertTrocoCoerente(
  paymentMethod: PaymentMethod,
  changeForInCents: number | undefined,
  totalInCents: number,
): void {
  if (changeForInCents === undefined) return;

  if (paymentMethod !== "cash") {
    throw new ValidationError(
      "Troco só faz sentido em pagamento com dinheiro",
    );
  }
  if (changeForInCents < totalInCents) {
    throw new ValidationError(
      `O troco (${changeForInCents}) é menor que o total do pedido (${totalInCents})`,
    );
  }
}

/**
 * Endereço é obrigatório na entrega e proibido nas outras duas.
 *
 * É 400 e não 409: não é o estado do sistema que impede, é o corpo da
 * requisição que não faz sentido. O banco tem o mesmo check — aqui a checagem
 * existe para o cliente receber uma mensagem em vez de um 500 de constraint.
 */
function assertEnderecoCoerente(input: CreateOrderInput): void {
  const temEndereco = input.deliveryAddress !== undefined;

  if (input.type === "delivery" && !temEndereco) {
    throw new ValidationError("Pedido de entrega exige `deliveryAddress`");
  }
  if (input.type !== "delivery" && temEndereco) {
    throw new ValidationError(
      `Pedido de ${NOME_DA_MODALIDADE[input.type]} não leva \`deliveryAddress\``,
    );
  }
}

/**
 * Resolve o hash que veio do QR code para a mesa — e recusa o que não faz
 * sentido. **400**, nunca 404: é a montagem do pedido que falha, não um
 * recurso ausente, a mesma categoria das violações de opção.
 *
 * ⚠️ Ausência de `tableHash` é VÁLIDA em `dine_in`, e isso é a garantia mais
 * frágil desta feature. Todo QR code impresso antes dela aponta para `/slug`
 * sem hash nenhum; exigir a mesa faria, no deploy, todo adesivo já colado
 * parar de funcionar. Quem "limpar" esta opcionalidade um dia quebra o salão
 * inteiro de quem ainda não trocou os adesivos — há teste prendendo isto.
 *
 * A mesa é buscada **escopada pelo restaurante da rota** (S23): sem isso um
 * hash legítimo etiquetaria pedido em loja alheia.
 */
async function resolverMesa(
  restaurantId: string,
  input: CreateOrderInput,
): Promise<{ id: string; label: string } | undefined> {
  if (input.tableHash === undefined) return undefined;

  if (input.type !== "dine_in") {
    throw new ValidationError(
      `Pedido de ${NOME_DA_MODALIDADE[input.type]} não leva \`tableHash\`: mesa é do salão`,
    );
  }

  const table = await tablesRepository.findByHash(
    restaurantId,
    input.tableHash,
  );
  if (table === null) {
    throw new ValidationError("Mesa não encontrada neste restaurante");
  }
  // só o que vai ser CONGELADO no pedido — o hash não entra, ele muda na
  // rotação e o pedido não pode mudar junto
  return { id: table.id, label: table.label };
}

/**
 * A chave de fusão de linhas.
 *
 * Era só o `productId`. Com opções isso passou a estar errado: "um hambúrguer
 * com bacon" e "um sem bacon" viravam "dois hambúrgueres", e o cliente recebia
 * dois iguais. A chave passa a incluir as escolhas, normalizadas — ordenadas
 * por id para que a mesma seleção em ordem diferente continue fundindo.
 */
function chaveDeFusao(
  productId: string,
  escolhas: Map<string, number>,
): string {
  const partes = [...escolhas.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([optionId, quantity]) => `${optionId}:${quantity}`);
  return [productId, ...partes].join("|");
}

/** Uma linha em montagem, antes de virar `InsertOrderItemData`. */
type LinhaEmMontagem = {
  productId: string;
  quantity: number;
  escolhas: Map<string, number>;
};

/**
 * Confere as escolhas de um item contra os grupos ligados ao produto e devolve
 * o que precisa ser congelado.
 *
 * Tudo aqui é 400 (`ValidationError`), não 404: o corpo do pedido é uma
 * montagem que o cliente fez a partir do cardápio, então o que falha é a
 * montagem, não um recurso ausente.
 */
function validarEscolhas(
  produto: Product,
  grupos: OptionGroup[],
  escolhas: Map<string, number>,
): { congeladas: OrderItemOption[]; grupos: PricedGroup[] } {
  const opcaoPorId = new Map(
    grupos.flatMap((grupo) =>
      grupo.options.map((opcao) => [opcao.id, { grupo, opcao }] as const),
    ),
  );

  for (const [optionId, quantity] of escolhas) {
    const achado = opcaoPorId.get(optionId);
    if (achado === undefined) {
      throw new ValidationError(
        `A opção "${optionId}" não pertence ao produto "${produto.name}"`,
      );
    }
    if (!achado.opcao.available) {
      throw new ValidationError(`A opção "${achado.opcao.name}" está indisponível`);
    }
    if (quantity > achado.opcao.maxQuantity) {
      throw new ValidationError(
        `"${achado.opcao.name}" aceita no máximo ${achado.opcao.maxQuantity} por item`,
      );
    }
  }

  const congeladas: OrderItemOption[] = [];
  const precificados: PricedGroup[] = [];

  for (const grupo of grupos) {
    const doGrupo = grupo.options
      .filter((opcao) => escolhas.has(opcao.id))
      .map((opcao) => ({
        opcao,
        quantity: escolhas.get(opcao.id) as number,
      }));

    if (doGrupo.length < grupo.minOptions) {
      throw new ValidationError(
        `"${grupo.name}" exige ao menos ${grupo.minOptions} escolha(s)`,
      );
    }
    if (doGrupo.length > grupo.maxOptions) {
      throw new ValidationError(
        `"${grupo.name}" aceita no máximo ${grupo.maxOptions} opção(ões)`,
      );
    }

    for (const { opcao, quantity } of doGrupo) {
      congeladas.push({
        optionId: opcao.id,
        groupName: grupo.name,
        name: opcao.name,
        priceInCents: opcao.priceInCents,
        quantity,
      });
    }

    precificados.push({
      priceRule: grupo.priceRule,
      choices: doGrupo.map(({ opcao, quantity }) => ({
        priceInCents: opcao.priceInCents,
        quantity,
      })),
    });
  }

  return { congeladas, grupos: precificados };
}

/**
 * Cria o pedido inteiro numa transação: cliente, pedido e itens valem juntos ou
 * nenhum vale. Sem ela, um erro na gravação dos itens deixaria um pedido órfão
 * com total já calculado e nenhuma linha.
 */
export async function create(
  restaurantId: string,
  input: CreateOrderInput,
): Promise<CreatedOrder> {
  const restaurant = await restaurantsService.getById(restaurantId);
  assertLojaVisivel(restaurant, restaurantId);
  await assertLojaAberta(restaurant);
  assertRestauranteAceita(restaurant, input.type);
  assertFormaAceita(restaurant, input.paymentMethod);
  assertEnderecoCoerente(input);
  const table = await resolverMesa(restaurantId, input);

  // Duas linhas iguais (mesmo produto, mesmas opções) viram uma com a
  // quantidade somada. É o que um carrinho faz, e apaga de vez o caso em que a
  // confirmação teria que travar e debitar o mesmo produto duas vezes na mesma
  // transação. A chave de fusão NÃO é mais só o productId — ver `chaveDeFusao`.
  const linhas = new Map<string, LinhaEmMontagem>();
  for (const item of input.items) {
    // S9: id fora do formato viraria `invalid input syntax for type uuid` (500)
    if (!isUuid(item.productId)) throw productNotFound(item.productId);

    // opções repetidas no MESMO item somam a quantidade antes de qualquer
    // checagem de teto — igual já acontece com produto repetido no corpo
    const escolhas = new Map<string, number>();
    for (const escolha of item.options ?? []) {
      const atual = escolhas.get(escolha.optionId) ?? 0;
      escolhas.set(escolha.optionId, atual + escolha.quantity);
    }

    const chave = chaveDeFusao(item.productId, escolhas);
    const linha = linhas.get(chave);
    if (linha === undefined) {
      linhas.set(chave, {
        productId: item.productId,
        quantity: item.quantity,
        escolhas,
      });
    } else {
      linha.quantity += item.quantity;
    }
  }

  const productIds = [...new Set([...linhas.values()].map((l) => l.productId))];

  // Quem acompanha o pedido recebe um token; quem está no salão, não. É por
  // não existir credencial que o pedido de mesa não tem como ser acompanhado —
  // e não por uma checagem que alguém possa remover.
  const trackingToken = issuesTrackingToken(input.type) ? generateToken() : null;

  return withTransaction(async (client) => {
    const products = await productsRepository.findManyByIds(
      restaurantId,
      productIds,
      client,
    );
    const byId = new Map(products.map((product) => [product.id, product]));

    // uma consulta só para o pedido inteiro — nunca uma por item (Task 5)
    const gruposByProduct = await optionGroupsRepository.findGroupsByProductIds(
      restaurantId,
      productIds,
      client,
    );

    const items = [...linhas.values()].map((linha) => {
      const product = byId.get(linha.productId);
      // some do cardápio (ou nunca foi deste restaurante) = não dá pra pedir
      if (product === undefined) throw productNotFound(linha.productId);

      const { congeladas, grupos } = validarEscolhas(
        product,
        gruposByProduct.get(linha.productId) ?? [],
        linha.escolhas,
      );

      return {
        productId: linha.productId,
        // cópias congeladas: daqui pra frente o pedido não depende de `products`
        name: product.name,
        priceInCents: product.priceInCents,
        unitPriceInCents: unitPrice(product.priceInCents, grupos),
        quantity: linha.quantity,
        options: congeladas,
      };
    });

    // subtotal sempre calculado aqui — aceitar do cliente seria deixar o
    // preço ser escolhido por quem paga. É o unitário (já com opções) vezes a
    // quantidade: nunca soma-se contribuição de opção já arredondada. Chama-se
    // "subtotal" porque em `delivery` ainda falta somar o frete — ver abaixo.
    const subtotalInCents = items.reduce(
      (sum, item) => sum + item.unitPriceInCents * item.quantity,
      0,
    );

    // Antes da cotação de propósito: o mínimo depende só do subtotal, então
    // falha mais cedo e sem ir ao banco buscar bairro.
    assertAtingeMinimo(restaurant, input.type, subtotalInCents);

    // O frete sai da mesma cotação que o endpoint público usa, recalculada
    // aqui: aquele endpoint informa, esta criação decide. Entre cotar e pedir
    // cabe o tempo de montar o carrinho, e cabe um cliente batendo direto na
    // API sem nunca ter chamado a cotação.
    const frete = await deliveryService.quoteForOrder(
      restaurant,
      input.type,
      input.deliveryAddress,
      subtotalInCents,
      client,
    );

    if (!frete.deliversTo) {
      throw new ConflictError("A loja não entrega neste endereço");
    }

    // null quando é "a combinar" ou quando não é entrega: não há o que somar
    const totalInCents = subtotalInCents + (frete.feeInCents ?? 0);
    assertTrocoCoerente(input.paymentMethod, input.changeForInCents, totalInCents);

    const customer = await customersRepository.upsertByPhone(
      input.customer,
      client,
    );

    const orderId = await ordersRepository.insertOrder(
      restaurantId,
      {
        customerId: customer.id,
        type: input.type,
        totalInCents,
        // congelado no momento da criação; nunca recalculado a partir do
        // cadastro atual do restaurante numa leitura futura
        deliveryFeeInCents: frete.feeInCents,
        deliveryAddress: input.deliveryAddress,
        trackingTokenHash:
          trackingToken === null ? null : hashToken(trackingToken),
        paymentMethod: input.paymentMethod,
        changeForInCents: input.changeForInCents,
        table,
      },
      client,
    );
    const itemIds = await ordersRepository.insertItems(orderId, items, client);

    // Guarda contra o único jeito realista de o mapeamento por posição
    // (comentado em `insertItems`) quebrar hoje: uma linha OMITIDA do
    // `RETURNING`. Isso não prova que a ordem está certa — só transforma uma
    // omissão silenciosa (que atribuiria a opção paga ao item errado) num
    // erro alto, em vez de um pedido gravado errado sem ninguém notar.
    if (itemIds.length !== items.length) {
      throw new Error(
        `insertItems devolveu ${itemIds.length} id(s) para ${items.length} item(ns) — ` +
          "RETURNING veio mais curto que VALUES, o mapeamento por posição não é seguro",
      );
    }

    // `itemIds[index]` depende de `insertItems` devolver uma linha do
    // `RETURNING` por tupla do `VALUES`, na mesma ordem — ver o comentário lá.
    const optionRows = items.flatMap((item, index) =>
      item.options.map((option) => ({
        orderItemId: itemIds[index],
        optionId: option.optionId,
        groupName: option.groupName,
        name: option.name,
        priceInCents: option.priceInCents,
        quantity: option.quantity,
      })),
    );
    await ordersRepository.insertItemOptions(optionRows, client);

    // relido pela mesma conexão da transação, então enxerga o que acabou de ser
    // gravado (e sai já no formato da resposta, com cliente e itens)
    const order = await ordersRepository.findById(restaurantId, orderId, client);

    // única vez que o token existe fora do cliente; o banco só tem o hash
    return {
      ...(order as Order),
      ...(trackingToken === null ? {} : { trackingToken }),
    };
  });
}

/** Pedidos de um restaurante, opcionalmente filtrados por status. */
/** O que a querystring do painel pode trazer além da paginação. */
export type OrderListFilters = {
  status?: OrderStatus;
  period?: OrderPeriod;
  from?: string;
  to?: string;
  sort?: OrderSortField;
  order?: SortDirection;
  /** Só os pedidos de uma mesa — "o que a mesa 7 pediu hoje?". */
  tableId?: string;
};

/**
 * A ordenação padrão: **o mais novo primeiro**.
 *
 * Inverteu o que era antes, e por causa do painel: ele existe para ver o
 * pedido que acabou de chegar, e na ordem crescente ele estava na última
 * página. Quem quer a ordem da cozinha pede `?order=asc`.
 */
const DEFAULT_SORT: OrderSort = { field: "createdAt", direction: "desc" };

/**
 * Traduz a querystring no recorte de tempo, ou recusa a combinação com 400.
 *
 * As duas formas atendem controles diferentes na tela (os botões e o seletor
 * de datas), e mandar as duas juntas não tem resposta certa: não existe "hoje,
 * de 1 a 5 de agosto". Aceitar em silêncio, ignorando uma delas, devolveria um
 * número que não é o que ninguém pediu — e num painel de faturamento isso é
 * pior do que um erro.
 */
export function resolvePeriodFilter({
  period,
  from,
  to,
}: Pick<OrderListFilters, "period" | "from" | "to">): PeriodFilter | undefined {
  const temIntervalo = from !== undefined || to !== undefined;

  if (period !== undefined && temIntervalo) {
    throw new ValidationError(
      'Use "period" ou "from"/"to", não os dois na mesma requisição',
    );
  }

  if (period !== undefined) return { kind: "named", name: period };
  if (!temIntervalo) return undefined;

  // Comparação de string funciona aqui porque o formato é YYYY-MM-DD, validado
  // por `format: "date"` no schema — nele, ordem lexicográfica é ordem
  // cronológica. Não vale para data em qualquer outro formato.
  if (from !== undefined && to !== undefined && from > to) {
    throw new ValidationError(`O período começa depois de terminar: ${from} > ${to}`);
  }

  return { kind: "range", from, to };
}

/**
 * Pedidos do restaurante, com os filtros do painel.
 *
 * Carrega o restaurante inteiro (e não só confirma que ele existe) porque o
 * recorte de tempo é resolvido **no fuso dele**: sem o fuso, "hoje" seria o do
 * servidor, e um restaurante em Manaus veria o dia trocar uma hora antes.
 */
export async function listByRestaurant(
  restaurantId: string,
  pagination: Pagination,
  filters: OrderListFilters = {},
): Promise<Page<OrderSummary>> {
  const period = resolvePeriodFilter(filters);
  const restaurant = await restaurantsService.getById(restaurantId);

  const { rows, total } = await ordersRepository.findByRestaurant(
    restaurantId,
    pagination,
    { status: filters.status, period, tableId: filters.tableId },
    {
      field: filters.sort ?? DEFAULT_SORT.field,
      direction: filters.order ?? DEFAULT_SORT.direction,
    },
    restaurant.timezone,
  );
  return { data: rows, ...pagination, total };
}

/**
 * O resumo do painel: quantos pedidos em cada status, o faturamento e o ticket
 * médio do período.
 *
 * É rota separada da listagem de propósito. O painel troca de página e de
 * filtro o tempo todo, e recalcular os contadores a cada virada de página é
 * trabalho jogado fora; além disso, os contadores falam do **período inteiro**
 * enquanto o `total` da listagem fala da consulta paginada — duas noções de
 * "quantos" no mesmo corpo, com nomes parecidos, é convite a somar errado.
 *
 * Quem decide o que é faturamento é o domínio (`REVENUE_STATUSES`), não o SQL:
 * o repositório devolve a contagem crua por status e a regra é aplicada aqui.
 */
export async function summary(
  restaurantId: string,
  filters: Pick<OrderListFilters, "period" | "from" | "to"> = {},
): Promise<OrderSummaryTotals> {
  const period = resolvePeriodFilter(filters);
  const restaurant = await restaurantsService.getById(restaurantId);

  const [tallies, bounds] = await Promise.all([
    ordersRepository.tallyByStatus(restaurantId, period, restaurant.timezone),
    ordersRepository.selectPeriodBounds(period, restaurant.timezone),
  ]);

  // Todos os status aparecem, zerados ou não: uma tela que só recebe as chaves
  // presentes teria que saber a lista para desenhar os zeros — e ela ficaria
  // desatualizada no dia em que a máquina de status ganhasse um estado.
  const counts = Object.fromEntries(
    ORDER_STATUSES.map((status) => [status, 0]),
  ) as Record<OrderStatus, number>;
  for (const tally of tallies) counts[tally.status] = tally.count;

  const faturamento = tallies.filter((tally) =>
    (REVENUE_STATUSES as readonly OrderStatus[]).includes(tally.status),
  );
  const revenueInCents = faturamento.reduce((soma, t) => soma + t.totalInCents, 0);
  const revenueOrderCount = faturamento.reduce((soma, t) => soma + t.count, 0);

  return {
    period: {
      ...(bounds.from === null ? {} : { from: bounds.from.toISOString() }),
      ...(bounds.to === null ? {} : { to: bounds.to.toISOString() }),
    },
    counts,
    revenueInCents,
    revenueOrderCount,
    // divisão por zero viraria NaN, que o serializador transformaria em null
    averageTicketInCents:
      revenueOrderCount === 0
        ? 0
        : Math.round(revenueInCents / revenueOrderCount),
  };
}

/**
 * Resolve um token de acompanhamento no pedido correspondente, ou `null`.
 *
 * Não recebe `restaurantId`: quem acompanha é o cliente, que não sabe (nem
 * precisa saber) em qual restaurante pediu. Quem escopa é o token — ele vale
 * para um pedido e só um.
 */
export async function findByTrackingToken(
  token: string,
): Promise<Order | null> {
  const found = await ordersRepository.findByTrackingTokenHash(
    hashToken(token),
  );
  if (found === null) return null;

  return ordersRepository.findById(found.restaurantId, found.id);
}

/**
 * O pedido, autorizado pelo **token de acompanhamento** em vez de por sessão.
 *
 * O `orderId` da URL é conferido contra o pedido que o token resolve: sem
 * isso, um token legítimo leria qualquer pedido, e a credencial deixaria de
 * valer para um pedido só.
 *
 * A resposta é a mesma para token inexistente e token de outro pedido — a
 * diferença entre as duas diria a quem tenta se aquele pedido existe.
 */
export async function getByTrackingToken(
  orderId: string,
  token: string,
): Promise<Order> {
  const order = await findByTrackingToken(token);
  if (order === null || order.id !== orderId) {
    throw new NotFoundError("Pedido não encontrado");
  }
  return order;
}

export async function getById(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(orderId)) throw orderNotFound(orderId);

  const order = await ordersRepository.findById(restaurantId, orderId);
  if (order === null) throw orderNotFound(orderId);
  return order;
}

/**
 * Debita o estoque de todos os itens do pedido. Só a confirmação chama.
 *
 * Confere TODOS antes de debitar QUALQUER um: o rollback resolveria de
 * qualquer jeito, mas conferir antes deixa a regra explícita em vez de
 * depender do desfazer.
 */
async function debitarEstoque(
  orderId: string,
  client: PoolClient,
): Promise<void> {
  const items = await ordersRepository.findItems(orderId, client);
  const stocks = await productsRepository.selectStocksForUpdate(
    items.map((item) => item.productId),
    client,
  );
  const stockById = new Map(stocks.map((row) => [row.id, row.stock]));

  // Soma as linhas do mesmo produto ANTES de conferir. Desde que o pedido pode
  // ter mais de uma linha do mesmo produto (opções diferentes), conferir linha
  // a linha deixaria cada uma enxergar o estoque inteiro — e duas linhas de 3
  // passariam por uma checagem de "tem 4?" que ambas consideram suficiente.
  //
  // O débito abaixo continua por linha, e isso está certo: as linhas rodam na
  // mesma transação, com a linha do produto já travada.
  const pedidoPorProduto = new Map<string, number>();
  for (const item of items) {
    pedidoPorProduto.set(
      item.productId,
      (pedidoPorProduto.get(item.productId) ?? 0) + item.quantity,
    );
  }

  for (const item of items) {
    const stock = stockById.get(item.productId);
    // produto removido do cardápio entre o pedido e a confirmação
    if (stock === undefined) {
      throw new ConflictError(
        `O produto "${item.name}" saiu do cardápio e o pedido não pode ser confirmado`,
      );
    }
    const pedido = pedidoPorProduto.get(item.productId) as number;
    if (stock < pedido) {
      throw new ConflictError(
        `Estoque insuficiente de "${item.name}": ${pedido} pedidos, ${stock} disponíveis`,
      );
    }
  }

  for (const item of items) {
    await productsRepository.decrementStock(
      item.productId,
      item.quantity,
      client,
    );
  }
}

/**
 * Devolve ao estoque o que o pedido tinha debitado.
 *
 * Trava as mesmas linhas, na mesma ordem por id, pelo mesmo motivo do débito —
 * sem o lock, dois cancelamentos concorrentes do mesmo pedido devolveriam as
 * unidades duas vezes.
 *
 * Produto que saiu do cardápio no meio do caminho é ignorado em silêncio: não
 * há linha viva para devolver, e barrar o cancelamento por isso deixaria o
 * pedido preso num estado que ninguém pediu.
 */
async function devolverEstoque(
  orderId: string,
  client: PoolClient,
): Promise<void> {
  const items = await ordersRepository.findItems(orderId, client);
  const stocks = await productsRepository.selectStocksForUpdate(
    items.map((item) => item.productId),
    client,
  );
  const vivos = new Set(stocks.map((row) => row.id));

  for (const item of items) {
    if (!vivos.has(item.productId)) continue;
    await productsRepository.incrementStock(
      item.productId,
      item.quantity,
      client,
    );
  }
}

/**
 * A transição de status, e o único caminho por onde o pedido muda de estado.
 *
 * Tudo numa transação, com o pedido travado desde a leitura: sem isso duas
 * transições simultâneas leem o mesmo estado, as duas se acham legais, e as
 * duas gravam — o que na confirmação significaria debitar estoque duas vezes.
 *
 * As regras de quem pode ir para onde moram no mapa de `domain/order.ts`. Aqui
 * só se aplica o mapa e se decide o efeito colateral de cada destino.
 */
async function transitionTo(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
): Promise<Order> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(orderId)) throw orderNotFound(orderId);

  return withTransaction(async (client) => {
    const atual = await ordersRepository.selectForUpdate(
      restaurantId,
      orderId,
      client,
    );
    if (atual === null) throw orderNotFound(orderId);

    if (!canTransition(atual.type, atual.status, to)) {
      // duas mensagens diferentes porque as causas são diferentes, e dizer
      // "não pode ir de preparing para out_for_delivery" num pedido de
      // retirada esconderia que o problema é a modalidade, não o estado
      throw new ConflictError(
        isReachable(atual.type, to)
          ? `Pedido não pode ir para "${to}": está em "${atual.status}"`
          : `Pedido de ${NOME_DA_MODALIDADE[atual.type]} não passa por "${to}"`,
      );
    }

    if (to === "confirmed") {
      await debitarEstoque(orderId, client);
    }
    if (to === "cancelled" && cancellingReturnsStock(atual.status)) {
      await devolverEstoque(orderId, client);
    }

    await ordersRepository.updateStatus(orderId, to, client);

    const order = await ordersRepository.findById(restaurantId, orderId, client);
    return order as Order;
  });
}

/**
 * Aplica a transição e anuncia o novo estado.
 *
 * O `publish` acontece **fora** do `withTransaction`, e isso não é estilo: de
 * dentro dele o evento sairia antes do commit, e um rollback deixaria o cliente
 * vendo um estado que não aconteceu.
 */
async function transitionAndPublish(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
): Promise<Order> {
  const order = await transitionTo(restaurantId, orderId, to);
  orderEvents.publish(order);
  return order;
}

/**
 * Aceita o pedido e debita o estoque — o único ponto do sistema que tira
 * unidade de `products.stock`.
 *
 * Consequência de debitar só aqui: pedido `pending` não é reserva. Dois pedidos
 * podem existir para a última unidade — o primeiro a confirmar leva, o segundo
 * recebe 409. É o custo escolhido para não segurar estoque de pedido que talvez
 * nunca seja confirmado.
 */
export async function confirm(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "confirmed");
}

/** Manda o pedido para a cozinha. Não mexe em estoque. */
export async function startPreparing(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "preparing");
}

/** Saiu para entrega. Só existe na trilha de `delivery`. */
export async function dispatch(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "out_for_delivery");
}

/** Pronto no balcão. Só existe na trilha de `takeaway`. */
export async function markReady(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "ready_for_pickup");
}

/** Fim do ciclo: entregue, retirado ou servido, conforme a modalidade. */
export async function complete(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "completed");
}

/**
 * Cancela o pedido, devolvendo o estoque quando ainda faz sentido.
 *
 * O corte é "a comida já existe": em `confirmed` e `preparing` as unidades
 * voltam, em `out_for_delivery` e `ready_for_pickup` não — o prato foi feito, e
 * devolvê-lo ao estoque seria mentir sobre o que há na cozinha. A regra mora em
 * `cancellingReturnsStock`, no domínio.
 */
export async function cancel(
  restaurantId: string,
  orderId: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "cancelled");
}
