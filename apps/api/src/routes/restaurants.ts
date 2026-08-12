import type { FastifyInstance, FastifyReply } from "fastify";
import { createRequire } from "node:module";
import { pool, withTransaction } from "../db/pool.ts";

// ajv e ajv-formats são pacotes CJS com `export default`. Sob NodeNext +
// verbatimModuleSyntax o import default não fica construível no type-check,
// então carregamos via require (CJS no runtime) e tipamos pelo próprio módulo.
const nodeRequire = createRequire(import.meta.url);
const Ajv = nodeRequire("ajv") as typeof import("ajv")["default"];
const addFormats = nodeRequire(
  "ajv-formats",
) as typeof import("ajv-formats")["default"];

/**
 * Validador estrito usado SÓ nas rotas de produtos (sub-escopo abaixo).
 * Diferença para o padrão do Fastify: `coerceTypes: false`, então uma string
 * como "1500" NÃO é convertida em número — é rejeitada com 400. Isso garante
 * que `priceInCents` só aceite inteiro de verdade. Mantemos `removeAdditional`,
 * `useDefaults` e os formats (uri) para o comportamento ficar igual ao resto.
 */
const strictAjv = new Ajv({
  coerceTypes: false,
  useDefaults: true,
  removeAdditional: true,
  allErrors: false,
});
addFormats(strictAjv);

// ===================== Tipos =====================

/** Endereço de um restaurante. */
type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};

/**
 * Campos que o cliente envia para criar um restaurante.
 * `id`, `createdAt` e `updatedAt` NÃO entram aqui — são gerados pelo servidor.
 */
type CreateRestaurantInput = {
  name: string;
  cuisineType: string;
  logoUrl?: string;
  address: Address;
  isDelivery: boolean;
  isQrcode: boolean;
};

/** Edição parcial: qualquer subconjunto dos campos de criação. */
type UpdateRestaurantInput = Partial<CreateRestaurantInput>;

/** Restaurante completo, como é guardado e devolvido na resposta. */
type Restaurant = CreateRestaurantInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Campos que o cliente envia para criar um produto.
 * `restaurantId` vem da rota; `id`/`createdAt`/`updatedAt` são do servidor.
 */
type CreateProductInput = {
  name: string;
  category: string;
  priceInCents: number; // inteiro (centavos) — nunca float
  description?: string;
  photoUrl?: string;
};

/** Edição parcial de produto. */
type UpdateProductInput = Partial<CreateProductInput>;

/** Produto completo, como é guardado e devolvido na resposta. */
type Product = CreateProductInput & {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
};

// ===================== Acesso ao banco =====================
//
// Soft delete: nada é apagado de verdade. `deleted_at` NULL = registro vivo;
// preenchido = removido. TODA consulta precisa filtrar `deleted_at is null`,
// e o DELETE da API vira `update ... set deleted_at = now()`.
// Ver `.claude/rules/database.md`.

/** Linha da tabela `restaurants`, em snake_case como vem do Postgres. */
type RestaurantRow = {
  id: string;
  name: string;
  cuisine_type: string;
  logo_url: string | null;
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  is_delivery: boolean;
  is_qrcode: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase devolvido pela API. */
function toRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    name: row.name,
    cuisineType: row.cuisine_type,
    // logoUrl é opcional: quando é NULL no banco, a chave nem entra na resposta.
    ...(row.logo_url === null ? {} : { logoUrl: row.logo_url }),
    address: {
      street: row.street,
      number: row.number,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      zipCode: row.zip_code,
    },
    isDelivery: row.is_delivery,
    isQrcode: row.is_qrcode,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos simples editáveis via PATCH → coluna correspondente na tabela. */
const restaurantColumns = {
  name: "name",
  cuisineType: "cuisine_type",
  logoUrl: "logo_url",
  isDelivery: "is_delivery",
  isQrcode: "is_qrcode",
} as const;

/** O endereço mora em colunas planas: campo do value object → coluna. */
const addressColumns = {
  street: "street",
  number: "number",
  neighborhood: "neighborhood",
  city: "city",
  state: "state",
  zipCode: "zip_code",
} as const;

/** Linha da tabela `products`, em snake_case como vem do Postgres. */
type ProductRow = {
  id: string;
  restaurant_id: string;
  name: string;
  category: string;
  price_in_cents: number;
  description: string | null;
  photo_url: string | null;
  created_at: Date;
  updated_at: Date;
};

/** Converte a linha do banco no formato camelCase devolvido pela API. */
function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    category: row.category,
    priceInCents: row.price_in_cents,
    // opcionais: quando são NULL no banco, a chave nem entra na resposta.
    ...(row.description === null ? {} : { description: row.description }),
    ...(row.photo_url === null ? {} : { photoUrl: row.photo_url }),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Campos editáveis via PATCH → coluna correspondente na tabela. */
const productColumns = {
  name: "name",
  category: "category",
  priceInCents: "price_in_cents",
  description: "description",
  photoUrl: "photo_url",
} as const;

/**
 * `id` é uma coluna `uuid`: mandar uma string fora do formato faz o Postgres
 * estourar `invalid input syntax for type uuid`, o que viraria 500. A API
 * sempre respondeu 404 para id inexistente, então filtramos antes de consultar.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

/** Existe restaurante vivo com esse id? Usado pelas rotas de produtos. */
async function restaurantExists(id: string) {
  if (!isUuid(id)) return false;
  const { rowCount } = await pool.query(
    "select 1 from restaurants where id = $1 and deleted_at is null",
    [id],
  );
  return rowCount === 1;
}

// ===================== JSON Schemas =====================
// Validação da entrada (F9) e serialização da saída (F10).

const addressProperties = {
  street: { type: "string", minLength: 1 },
  number: { type: "string", minLength: 1 },
  neighborhood: { type: "string", minLength: 1 },
  city: { type: "string", minLength: 1 },
  state: { type: "string", minLength: 1 },
  zipCode: { type: "string", minLength: 1 },
};

// Endereço é um "value object": quando enviado, vem completo.
const addressSchema = {
  type: "object",
  additionalProperties: false,
  required: ["street", "number", "neighborhood", "city", "state", "zipCode"],
  properties: addressProperties,
};

const createRestaurantBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "cuisineType", "address", "isDelivery", "isQrcode"],
  properties: {
    name: { type: "string", minLength: 1 },
    cuisineType: { type: "string", minLength: 1 },
    logoUrl: { type: "string", format: "uri" },
    address: addressSchema,
    isDelivery: { type: "boolean" },
    isQrcode: { type: "boolean" },
  },
};

const updateRestaurantBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    cuisineType: { type: "string", minLength: 1 },
    logoUrl: { type: "string", format: "uri" },
    address: addressSchema,
    isDelivery: { type: "boolean" },
    isQrcode: { type: "boolean" },
  },
};

const restaurantResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    cuisineType: { type: "string" },
    logoUrl: { type: "string" },
    address: { type: "object", properties: addressProperties },
    isDelivery: { type: "boolean" },
    isQrcode: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const restaurantListResponseSchema = {
  type: "array",
  items: restaurantResponseSchema,
};

// ---- Produtos ----

const createProductBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "category", "priceInCents"],
  properties: {
    name: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    priceInCents: { type: "integer", minimum: 0 },
    description: { type: "string" },
    photoUrl: { type: "string", format: "uri" },
  },
};

const updateProductBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    priceInCents: { type: "integer", minimum: 0 },
    description: { type: "string" },
    photoUrl: { type: "string", format: "uri" },
  },
};

const productResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string" },
    category: { type: "string" },
    priceInCents: { type: "integer" },
    description: { type: "string" },
    photoUrl: { type: "string" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};

const productListResponseSchema = {
  type: "array",
  items: productResponseSchema,
};

// ---- Params compartilhados ----

const idParamsSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
};

const restaurantIdParamsSchema = {
  type: "object",
  required: ["restaurantId"],
  properties: { restaurantId: { type: "string" } },
};

const productParamsSchema = {
  type: "object",
  required: ["restaurantId", "id"],
  properties: {
    restaurantId: { type: "string" },
    id: { type: "string" },
  },
};

const notFoundResponseSchema = {
  type: "object",
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: { type: "string" },
  },
};

// ===================== Helpers de 404 =====================

function restaurantNotFound(reply: FastifyReply, id: string) {
  reply.code(404);
  return {
    statusCode: 404,
    error: "Not Found",
    message: `Restaurante com id "${id}" não encontrado`,
  };
}

function productNotFound(reply: FastifyReply, id: string) {
  reply.code(404);
  return {
    statusCode: 404,
    error: "Not Found",
    message: `Produto com id "${id}" não encontrado`,
  };
}

// ===================== Rotas =====================

/** Rotas do domínio de restaurantes (plugin encapsulado — F2/F4). */
export async function restaurantRoutes(app: FastifyInstance) {
  // Criar
  app.post<{ Body: CreateRestaurantInput }>(
    "/restaurants",
    {
      schema: {
        body: createRestaurantBodySchema,
        response: { 201: restaurantResponseSchema },
      },
    },
    async (request, reply) => {
      const { name, cuisineType, logoUrl, address, isDelivery, isQrcode } =
        request.body;

      // id/createdAt/updatedAt saem dos defaults da tabela — daí o RETURNING *.
      const { rows } = await pool.query<RestaurantRow>(
        `insert into restaurants
           (name, cuisine_type, logo_url,
            street, number, neighborhood, city, state, zip_code,
            is_delivery, is_qrcode)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         returning *`,
        [
          name,
          cuisineType,
          logoUrl ?? null,
          address.street,
          address.number,
          address.neighborhood,
          address.city,
          address.state,
          address.zipCode,
          isDelivery,
          isQrcode,
        ],
      );

      reply.code(201);
      return toRestaurant(rows[0]);
    },
  );

  // Listar todos (array vazio é resposta válida → 200)
  app.get(
    "/restaurants",
    { schema: { response: { 200: restaurantListResponseSchema } } },
    async () => {
      // ordem de criação, como era com o array em memória
      const { rows } = await pool.query<RestaurantRow>(
        `select * from restaurants
          where deleted_at is null
          order by created_at, id`,
      );
      return rows.map(toRestaurant);
    },
  );

  // Buscar por id
  app.get<{ Params: { id: string } }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 200: restaurantResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return restaurantNotFound(reply, id);

      const { rows } = await pool.query<RestaurantRow>(
        "select * from restaurants where id = $1 and deleted_at is null",
        [id],
      );
      if (rows.length === 0) return restaurantNotFound(reply, id);
      return toRestaurant(rows[0]);
    },
  );

  // Edição parcial
  app.patch<{ Params: { id: string }; Body: UpdateRestaurantInput }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        body: updateRestaurantBodySchema,
        response: { 200: restaurantResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return restaurantNotFound(reply, id);

      // SET dinâmico com só os campos enviados. Percorremos o mapa de colunas
      // (nunca as chaves do body) para nada vindo do cliente virar SQL, e os
      // valores vão sempre como parâmetro $n.
      const assignments: string[] = [];
      const values: unknown[] = [];

      function assign(column: string, value: unknown) {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }

      for (const [field, column] of Object.entries(restaurantColumns)) {
        const value = request.body[field as keyof typeof restaurantColumns];
        if (value === undefined) continue;
        assign(column, value);
      }

      // Endereço é value object: quando vem no PATCH vem inteiro, então as seis
      // colunas são atualizadas de uma vez.
      const { address } = request.body;
      if (address !== undefined) {
        for (const [field, column] of Object.entries(addressColumns)) {
          assign(column, address[field as keyof Address]);
        }
      }

      // updatedAt renova em todo PATCH; id e createdAt ficam intocados.
      assignments.push("updated_at = now()");
      values.push(id);

      const { rows } = await pool.query<RestaurantRow>(
        `update restaurants
            set ${assignments.join(", ")}
          where id = $${values.length} and deleted_at is null
          returning *`,
        values,
      );
      if (rows.length === 0) return restaurantNotFound(reply, id);
      return toRestaurant(rows[0]);
    },
  );

  // Remover (cascata: apaga os produtos do restaurante junto)
  app.delete<{ Params: { id: string } }>(
    "/restaurants/:id",
    {
      schema: {
        params: idParamsSchema,
        response: { 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      if (!isUuid(id)) return restaurantNotFound(reply, id);

      // Soft delete: o restaurante e os produtos dele saem de cena juntos, na
      // mesma transação — nada é apagado, só marcado com deleted_at.
      const removed = await withTransaction(async (client) => {
        const { rowCount } = await client.query(
          `update restaurants set deleted_at = now()
            where id = $1 and deleted_at is null`,
          [id],
        );
        if (rowCount === 0) return false;

        await client.query(
          `update products set deleted_at = now()
            where restaurant_id = $1 and deleted_at is null`,
          [id],
        );
        return true;
      });

      if (!removed) return restaurantNotFound(reply, id);
      return reply.code(204).send();
    },
  );

  // Sub-escopo de produtos, com validador estrito (coercion off) para
  // rejeitar string/float em priceInCents sem afetar as rotas acima.
  await app.register(productRoutes);
}

/** Rotas aninhadas de produtos (escopo com validação estrita). */
async function productRoutes(app: FastifyInstance) {
  app.setValidatorCompiler(({ schema }) => strictAjv.compile(schema as object));

  // Criar produto no restaurante
  app.post<{ Params: { restaurantId: string }; Body: CreateProductInput }>(
    "/restaurants/:restaurantId/products",
    {
      schema: {
        params: restaurantIdParamsSchema,
        body: createProductBodySchema,
        response: { 201: productResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId } = request.params;
      if (!(await restaurantExists(restaurantId))) {
        return restaurantNotFound(reply, restaurantId);
      }

      const { name, category, priceInCents, description, photoUrl } =
        request.body;

      const { rows } = await pool.query<ProductRow>(
        `insert into products
           (restaurant_id, name, category, price_in_cents, description, photo_url)
         values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [
          restaurantId,
          name,
          category,
          priceInCents,
          description ?? null,
          photoUrl ?? null,
        ],
      );

      reply.code(201);
      return toProduct(rows[0]);
    },
  );

  // Listar produtos do restaurante (sem produtos → 200 [])
  app.get<{ Params: { restaurantId: string } }>(
    "/restaurants/:restaurantId/products",
    {
      schema: {
        params: restaurantIdParamsSchema,
        response: {
          200: productListResponseSchema,
          404: notFoundResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { restaurantId } = request.params;
      if (!(await restaurantExists(restaurantId))) {
        return restaurantNotFound(reply, restaurantId);
      }
      const { rows } = await pool.query<ProductRow>(
        `select * from products
          where restaurant_id = $1 and deleted_at is null
          order by created_at, id`,
        [restaurantId],
      );
      return rows.map(toProduct);
    },
  );

  // Buscar produto específico (escopado pelo restaurante da URL)
  app.get<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        response: { 200: productResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      if (!(await restaurantExists(restaurantId))) {
        return restaurantNotFound(reply, restaurantId);
      }
      if (!isUuid(id)) return productNotFound(reply, id);

      const { rows } = await pool.query<ProductRow>(
        `select * from products
          where id = $1 and restaurant_id = $2 and deleted_at is null`,
        [id, restaurantId],
      );
      if (rows.length === 0) return productNotFound(reply, id);
      return toProduct(rows[0]);
    },
  );

  // Edição parcial (protege id/createdAt/restaurantId, renova updatedAt)
  app.patch<{
    Params: { restaurantId: string; id: string };
    Body: UpdateProductInput;
  }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        body: updateProductBodySchema,
        response: { 200: productResponseSchema, 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      if (!(await restaurantExists(restaurantId))) {
        return restaurantNotFound(reply, restaurantId);
      }
      if (!isUuid(id)) return productNotFound(reply, id);

      // Mesmo SET dinâmico do PATCH de restaurante: só os campos enviados,
      // percorrendo o mapa de colunas (nunca as chaves do body).
      const assignments: string[] = [];
      const values: unknown[] = [];

      for (const [field, column] of Object.entries(productColumns)) {
        const value = request.body[field as keyof typeof productColumns];
        if (value === undefined) continue;
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }

      // id, restaurantId e createdAt ficam intocados; updatedAt renova.
      assignments.push("updated_at = now()");
      values.push(id, restaurantId);

      const { rows } = await pool.query<ProductRow>(
        `update products
            set ${assignments.join(", ")}
          where id = $${values.length - 1}
            and restaurant_id = $${values.length}
            and deleted_at is null
          returning *`,
        values,
      );
      if (rows.length === 0) return productNotFound(reply, id);
      return toProduct(rows[0]);
    },
  );

  // Remover produto
  app.delete<{ Params: { restaurantId: string; id: string } }>(
    "/restaurants/:restaurantId/products/:id",
    {
      schema: {
        params: productParamsSchema,
        response: { 404: notFoundResponseSchema },
      },
    },
    async (request, reply) => {
      const { restaurantId, id } = request.params;
      if (!(await restaurantExists(restaurantId))) {
        return restaurantNotFound(reply, restaurantId);
      }
      if (!isUuid(id)) return productNotFound(reply, id);

      // Soft delete: marca a saída em vez de apagar a linha.
      const { rowCount } = await pool.query(
        `update products set deleted_at = now()
          where id = $1 and restaurant_id = $2 and deleted_at is null`,
        [id, restaurantId],
      );
      if (rowCount === 0) return productNotFound(reply, id);

      return reply.code(204).send();
    },
  );
}
