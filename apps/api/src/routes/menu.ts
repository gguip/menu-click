import type { FastifyInstance } from "fastify";
import type { Address } from "../domain/restaurant.ts";
import type { Pagination } from "../domain/pagination.ts";
import { SLUG_MAX_LENGTH } from "../domain/slug.ts";
import { DELIVERY_QUOTE_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW } from "../limits.ts";
import * as deliveryService from "../services/delivery.ts";
import * as menuService from "../services/menu.ts";
import {
  addressProperties,
  addressSchema,
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
} from "./schemas.ts";
import { installRouteValidators } from "./validators.ts";

/**
 * Cardápio público — o que o QR code aponta. **Sem login.**
 *
 * O endereço é o slug, não o UUID: `/menu/tokyo-ramen-house` é o que cabe num
 * cartaz e o que alguém consegue digitar.
 *
 * Os `schema.response` daqui são escritos campo a campo e são mais enxutos que
 * os das rotas de gestão. Não é duplicação por descuido: é a diferença entre a
 * superfície aberta e a fechada, e o dia em que `products` ganhar uma coluna de
 * custo, ela não vai vazar por aqui sozinha (S10).
 */

const slugParamsSchema = {
  type: "object",
  required: ["slug"],
  properties: { slug: { type: "string", maxLength: SLUG_MAX_LENGTH } },
};

const menuRestaurantResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    slug: { type: "string" },
    name: { type: "string" },
    cuisineType: { type: "string" },
    logoUrl: { type: "string" },
    address: { type: "object", properties: addressProperties },
    // o cliente precisa saber o que dá para pedir antes de montar o carrinho
    isDelivery: { type: "boolean" },
    isTakeaway: { type: "boolean" },
    isQrcode: { type: "boolean" },
    // exatamente o que a tela precisa para anunciar "frete grátis acima de
    // R$ 50" antes do carrinho. `deliveryFixedFeeInCents` e
    // `deliveryFeeToArrange` NÃO entram: a cotação já devolve o número certo
    // para o endereço do cliente, e a segunda é política interna da loja (S10)
    deliveryFeeMode: { type: "string" },
    freeDeliveryAboveInCents: { type: "integer" },
    minimumOrderInCents: { type: "integer" },
    // a grade E a pausa, juntas: é o que decide se a tela mostra o botão
    isOpen: { type: "boolean" },
    // a pausa sozinha, para separar "fechado agora" de "a loja pausou"
    acceptingOrders: { type: "boolean" },
    // para a tela dizer QUANDO abre, em vez de só "fechado"
    openingHours: {
      type: "array",
      items: {
        type: "object",
        properties: {
          weekday: { type: "integer" },
          opensAt: { type: "string" },
          closesAt: { type: "string" },
        },
      },
    },
    // a lista pronta, não as quatro flags: o cliente escolhe entre opções,
    // não lê booleanos. `acceptsCash` e companhia NÃO entram aqui.
    paymentMethods: { type: "array", items: { type: "string" } },
    // `timezone` NÃO entra: é operação do restaurante, não do cliente. O que
    // o fuso decide já chegou traduzido no `isOpen`.
  },
};

const menuProductResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    priceInCents: { type: "integer" },
    description: { type: "string" },
    photoUrl: { type: "string" },
    // `stock` NÃO entra: quantas unidades o restaurante tem é informação dele
    available: { type: "boolean" },
    // só os ids, na ordem do produto: o conteúdo do grupo vem uma vez só, em
    // `optionGroups`, no topo da página
    optionGroupIds: { type: "array", items: { type: "string" } },
  },
};

/**
 * Um grupo de opções como o público o vê: sem opção indisponível (ela nunca
 * chega a existir nesta resposta, o serviço já filtrou).
 */
const menuOptionGroupResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    minOptions: { type: "integer" },
    maxOptions: { type: "integer" },
    priceRule: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          priceInCents: { type: "integer" },
          maxQuantity: { type: "integer" },
        },
      },
    },
  },
};

/**
 * Uma seção do cardápio. `categoryId` não aparece nos produtos daqui: eles já
 * estão **dentro** da seção, e repetir o vínculo em cada item seria dizer duas
 * vezes a mesma coisa.
 */
const menuSectionResponseSchema = {
  type: "object",
  properties: {
    // ausente no grupo "Sem categoria", que não é uma categoria de verdade
    id: { type: "string" },
    name: { type: "string" },
    products: { type: "array", items: menuProductResponseSchema },
  },
};

/**
 * O envelope de sempre, mais `optionGroups`: os grupos referenciados pelos
 * produtos desta página, cada um uma vez — nunca embutidos por produto.
 */
const menuSectionPageResponseSchema = {
  ...pageResponseSchema(menuSectionResponseSchema),
  properties: {
    ...pageResponseSchema(menuSectionResponseSchema).properties,
    optionGroups: { type: "array", items: menuOptionGroupResponseSchema },
  },
};

/**
 * Corpo da cotação: endereço completo (value object, ver `addressSchema`) e o
 * subtotal dos itens.
 *
 * ⚠️ O endereço vai no CORPO, nunca na querystring: URL entra em log de
 * acesso, de proxy e no histórico do navegador, e endereço de cliente não deve
 * morar lá — o mesmo raciocínio do S21 sobre credencial em URL.
 */
const deliveryQuoteBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["address", "subtotalInCents"],
  properties: {
    address: addressSchema,
    // só o subtotal dos itens, nunca o total: o frete ainda está sendo
    // decidido, então ele não pode entrar na própria conta
    subtotalInCents: { type: "integer", minimum: 0 },
  },
};

/**
 * Exatamente os cinco campos que a tela precisa — nem um a mais (S10). Sem
 * `servedNeighborhoods` ela não teria como oferecer o seletor de bairro; com
 * mais do que isso, vazaria detalhe de configuração que não é do cliente.
 */
const deliveryQuoteResponseSchema = {
  type: "object",
  properties: {
    deliversTo: { type: "boolean" },
    // null quando não entrega ou quando é "a combinar"; 0 é grátis
    feeInCents: { type: "integer", nullable: true },
    isFree: { type: "boolean" },
    toArrange: { type: "boolean" },
    // só populada no modo `neighborhood` — nos demais modos vem vazia
    servedNeighborhoods: { type: "array", items: { type: "string" } },
  },
};

export async function menuRoutes(app: FastifyInstance) {
  // O validador ESTRITO para o corpo. Sem ele vale o Ajv padrão do Fastify,
  // que coage tipo: `subtotalInCents: null` na cotação viraria 0, e a decisão
  // de "grátis acima de X" sairia calculada sobre um pedido de valor zero.
  installRouteValidators(app);

  app.get<{ Params: { slug: string } }>(
    "/menu/:slug",
    {
      // o cardápio é a superfície aberta: quem escaneia o QR não tem conta
      config: { public: true },
      schema: {
        tags: ["Cardápio público"],
        operationId: "getPublicMenu",
        summary: "Restaurante pelo slug público",
        description:
          "O endereço para onde o QR code aponta. O `slug` entra no lugar do id porque um UUID não é endereço que alguém digita ou imprime num cartaz.",
        params: slugParamsSchema,
        response: {
          200: menuRestaurantResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return menuService.getRestaurant(request.params.slug);
    },
  );

  app.get<{ Params: { slug: string }; Querystring: Pagination }>(
    "/menu/:slug/products",
    {
      config: { public: true },
      schema: {
        tags: ["Cardápio público"],
        operationId: "listPublicMenuProducts",
        summary: "Cardápio do restaurante, por seção",
        description:
          "Agrupado por categoria, na ordem que o restaurante definiu. **Quem pagina são as categorias, não os produtos** — assim nenhuma seção vem partida entre duas páginas, e `total` é o número de categorias do cardápio. Os produtos sem seção vêm num grupo final chamado `Sem categoria`, que aparece na última página e não conta no `total`. Não devolve `stock`: quantas unidades o restaurante tem é informação dele. O cliente recebe `available`, que diz só se dá para pedir — e que agora também leva em conta os grupos de opções obrigatórios do produto. Os grupos referenciados pelos produtos desta página vêm uma vez cada em `optionGroups`, no topo; cada produto aponta para eles por `optionGroupIds`. Opção indisponível não aparece.",
        params: slugParamsSchema,
        querystring: paginationQuerystringSchema,
        response: {
          200: menuSectionPageResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return menuService.listProducts(request.params.slug, request.query);
    },
  );

  app.post<{
    Params: { slug: string };
    Body: { address: Address; subtotalInCents: number };
  }>(
    "/menu/:slug/delivery-quote",
    {
      // pública como o resto do cardápio: entre cotar e pedir cabe o tempo de
      // montar um carrinho, e o cliente precisa saber antes disso
      config: {
        public: true,
        // teto próprio, bem abaixo do global — ver DELIVERY_QUOTE_RATE_LIMIT_MAX
        rateLimit: {
          max: DELIVERY_QUOTE_RATE_LIMIT_MAX,
          timeWindow: RATE_LIMIT_WINDOW,
        },
      },
      schema: {
        tags: ["Entrega"],
        operationId: "quoteMenuDelivery",
        summary: "Cota o frete antes de montar o pedido",
        description:
          "Informa se a loja entrega no endereço e por quanto, ANTES de o cliente montar o carrinho. Não decide nada: a criação do pedido confere de novo no servidor. O endereço vai no corpo, nunca na querystring, pelo mesmo motivo do S21 sobre credencial em URL.",
        params: slugParamsSchema,
        body: deliveryQuoteBodySchema,
        response: {
          200: deliveryQuoteResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => {
      return deliveryService.quote(
        request.params.slug,
        request.body.address,
        request.body.subtotalInCents,
      );
    },
  );
}
