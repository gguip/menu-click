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

const menuSectionPageResponseSchema = pageResponseSchema(
  menuSectionResponseSchema,
);

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
          "Agrupado por categoria, na ordem que o restaurante definiu. **Quem pagina são as categorias, não os produtos** — assim nenhuma seção vem partida entre duas páginas, e `total` é o número de categorias do cardápio. Os produtos sem seção vêm num grupo final chamado `Sem categoria`, que aparece na última página e não conta no `total`. Não devolve `stock`: quantas unidades o restaurante tem é informação dele. O cliente recebe `available`, que diz só se dá para pedir.",
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
