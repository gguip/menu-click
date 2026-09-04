import type { FastifyInstance } from "fastify";
import type { Pagination } from "../domain/pagination.ts";
import { SLUG_MAX_LENGTH } from "../domain/slug.ts";
import * as menuService from "../services/menu.ts";
import {
  addressProperties,
  errorResponseSchema,
  pageResponseSchema,
  paginationQuerystringSchema,
} from "./schemas.ts";

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

export async function menuRoutes(app: FastifyInstance) {
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
}
