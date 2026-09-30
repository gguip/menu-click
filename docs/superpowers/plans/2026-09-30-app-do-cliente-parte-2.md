# App do cliente, parte 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pedido por entrega e retirada pelo link do cardápio, com acompanhamento em tempo real — mais o que a API e o painel precisam para isso.

**Architecture:** A API ganha complemento do endereço, motivo do cancelamento, tempos estimados (e a previsão calculada no acompanhamento), o histórico de status no acompanhamento público e os bairros atendidos no cardápio público. O painel ganha o motivo ao cancelar e o formulário de tempos. O app ganha o modo link: carrinho com aviso de mínimo, finalizar em passos (modalidade, dados, endereço com cotação, pagamento com troco), tela de enviado com o link, página de acompanhamento com WebSocket e recuo para consulta, e o pedido em andamento guardado no aparelho.

**Tech Stack:** Fastify + `pg` + node-pg-migrate (API, TypeScript nativo do Node); Vite + React 19 + Mantine 9 + TanStack Query 5 (painel); Next.js 16 App Router + Tailwind 4 + React 19 (app); Vitest em tudo.

**Spec:** `docs/superpowers/specs/2026-09-30-app-do-cliente-parte-2-design.md`

## Global Constraints

- Node >= 23.6; API sem bundler: imports locais com `.ts`, só sintaxe apagável, `import type` (CLAUDE.md).
- Rode `unset -f node pnpm npm npx nvm 2>/dev/null;` antes de todo comando `node`/`pnpm` (as funções do nvm recursam em shell não interativo).
- Sem dependência nova em nenhum pacote.
- Migration só por `pnpm --filter @menuclick/api migrate:create <nome>`, SQL puro, `Down` que desfaz de verdade, sem `if not exists` (D16–D21).
- Soft delete: nenhum `delete from`; toda leitura filtra `deleted_at is null` (D1–D2).
- Todo valor do cliente vai como `$n` (S1–S5); campo novo em superfície pública só por decisão, nos três lugares — tipo, mapper e `schema.response` (S10).
- Nulável que pode ser desligado usa `nullable: true`, nunca `anyOf` (F12).
- Rota nova ou alterada: `tags`, `summary`, `description`, `operationId`; depois `pnpm --filter @menuclick/api openapi:generate` e commitar o `openapi.json`.
- Painel: cor só por `var(--mc-*)`; toda chamada por `apiRequest`; chaves de pedido começam em `"orders"`.
- App: campo de texto usa `FIELD_BOX`/`FIELD_FOCUS`/`FIELD_TEXT` de `components/field.ts`, texto em 16px; cor de ação `bg-action`; alvos de toque >= 44 px; leia `apps/menu/node_modules/next/dist/docs/` antes de escrever rota ou config do Next (AGENTS.md).
- Copy do app em pt-BR, literal da spec (seções "App" e "Erros").
- Commits: `<tipo>(<escopo>): <emoji> <mensagem>` em pt-BR, presente, minúscula, sem ponto, sem rodapé de atribuição (`.claude/rules/commits.md`). Commit só com testes e lint verdes pelo código de saída.

## Review Focus

1. **Cotação fora de ordem:** a pessoa troca o bairro enquanto a cotação anterior ainda está no ar; a resposta velha chegando depois não pode sobrescrever a nova (frete errado na tela). → teste na Task 10.
2. **Troco contra o total com frete:** "Troco para R$ 50" num pedido de R$ 45 de itens + R$ 9 de entrega tem que ser recusado (o total é R$ 54). → teste na Task 9.
3. **Acompanhamento de pedido já terminado:** abrir o link de um pedido `completed`/`cancelled` mostra o estado final e **não** fica reconectando socket nem consultando. → teste na Task 13.
4. **Pedido em andamento velho ou de outra loja:** o guardado de outra loja não aparece nesta; o de mais de 24 h, o terminado e o 404 saem do aparelho. → teste na Task 8 e na Task 14.
5. **Loja muda entre o carrinho e o envio** (pausa, desliga a entrega, mínimo): o 409 mostra a mensagem, o carrinho fica intacto e o botão volta a funcionar. → teste na Task 11.

---
### Task 1: Complemento do endereço (API)

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-order-complement.sql` (via `migrate:create add-order-complement`)
- Modify: `apps/api/src/domain/order.ts` (tipos do endereço do pedido)
- Modify: `apps/api/src/repositories/orders.ts` (`OrderRow`, `toAddress`, `InsertOrderData`, `insertOrder`)
- Modify: `apps/api/src/services/orders.ts` (normaliza o complemento antes de gravar)
- Modify: `apps/api/src/routes/orders.ts` (corpo da criação e `deliveryAddress` das respostas)
- Modify: `apps/api/src/routes/tracking.ts` (`deliveryAddress` do acompanhamento)
- Test: `apps/api/test/orders-complement.test.ts`

**Interfaces:**
- Produces: `DeliveryAddress = Address & { complement: string | null }` em `domain/order.ts`; `OrderSummary.deliveryAddress: DeliveryAddress | null`; `CreateOrderInput.deliveryAddress?: Address & { complement?: string }`. Na API: `deliveryAddress.complement` (entrada opcional, até 120; saída `string | null`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/orders-complement.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant, validDeliveryAddress } from "./helpers.ts";

/** "Apto 42, bloco B": o complemento, congelado com o resto do endereço. */
describe("complemento do endereço", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function delivery(complement?: string) {
    const r = await createRestaurant(app, { isDelivery: true });
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], {
      type: "delivery",
      deliveryAddress: { ...validDeliveryAddress, ...(complement === undefined ? {} : { complement }) },
    });
    return { r, order };
  }

  it("congela o complemento e devolve na criação, no detalhe, na listagem e no acompanhamento", async () => {
    const { r, order } = await delivery("  apto 42, bloco B  ");
    expect(order.deliveryAddress.complement).toBe("apto 42, bloco B");

    const detail = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders/${order.id}`, headers: r.headers });
    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(detail.json().deliveryAddress.complement).toBe("apto 42, bloco B");
    expect(list.json().data[0].deliveryAddress.complement).toBe("apto 42, bloco B");
    expect(tracked.json().deliveryAddress.complement).toBe("apto 42, bloco B");
  });

  it("sem complemento, ou só com espaços, sai null", async () => {
    expect((await delivery()).order.deliveryAddress.complement).toBeNull();
    expect((await delivery("   ")).order.deliveryAddress.complement).toBeNull();
  });

  it("mais de 120 caracteres é 400", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    const p = await createProduct(app, r, { stock: 10 });
    const res = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders`,
      payload: {
        type: "delivery",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: p.id, quantity: 1 }],
        paymentMethod: "pix",
        deliveryAddress: { ...validDeliveryAddress, complement: "x".repeat(121) },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // o value object compartilhado não ganhou o campo: cadastro e cotação continuam recusando
  it("o complemento não vaza para o endereço do restaurante nem para a cotação", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    const patch = await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { address: { ...validDeliveryAddress, complement: "sala 3" } },
    });
    expect(patch.statusCode).toBe(400);
    const quote = await app.inject({
      method: "POST",
      url: `/menu/${r.slug}/delivery-quote`,
      payload: { address: { ...validDeliveryAddress, complement: "sala 3" }, subtotalInCents: 1000 },
    });
    expect(quote.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/orders-complement.test.ts`
Expected: FAIL — `complement` é recusado pelo `additionalProperties: false` (400 no lugar de 201), e `deliveryAddress.complement` é `undefined`.

- [ ] **Step 3: Create the migration**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api migrate:create add-order-complement`

Conteúdo do arquivo criado em `apps/api/migrations/`:

```sql
-- Up Migration

-- "Apto 42, bloco B": o complemento do endereço de entrega. Congelado com o
-- resto do endereço, e só existe junto dele — a rede de segurança do serviço,
-- como o `orders_address_check`.
alter table orders add column complement text;
alter table orders
  add constraint orders_complement_check check (
    complement is null or (street is not null and char_length(complement) <= 120)
  );

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: os complementos dos pedidos feitos desde o Up.
alter table orders drop constraint orders_complement_check;
alter table orders drop column complement;
```

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api migrate:up && pnpm --filter @menuclick/api migrate:down && pnpm --filter @menuclick/api migrate:up`
Expected: as três terminam sem erro (Up, Down e Up de novo).

- [ ] **Step 4: Tipos do domínio**

Em `apps/api/src/domain/order.ts`, logo depois dos imports, declare o endereço do pedido; troque o tipo de `CreateOrderInput.deliveryAddress` e de `OrderSummary.deliveryAddress`:

```ts
/**
 * O endereço de entrega **do pedido**: o value object `Address` mais o
 * complemento. O complemento mora só aqui — o `Address` é compartilhado com o
 * cadastro da loja e a cotação, e lá ele não significa nada.
 */
export type DeliveryAddress = Address & { complement: string | null };
```

```ts
// em CreateOrderInput
  deliveryAddress?: Address & { complement?: string };
```

```ts
// em OrderSummary
  deliveryAddress: DeliveryAddress | null;
```

- [ ] **Step 5: Repositório**

Em `apps/api/src/repositories/orders.ts`:

```ts
// OrderRow: depois de zip_code
  /** "Apto 42"; só existe com endereço (check `orders_complement_check`). */
  complement: string | null;
```

```ts
function toAddress(row: OrderRow): DeliveryAddress | null {
  // o check `orders_address_check` garante tudo-ou-nada; testar uma coluna basta
  if (row.street === null) return null;
  return {
    street: row.street,
    number: row.number as string,
    neighborhood: row.neighborhood as string,
    city: row.city as string,
    state: row.state as string,
    zipCode: row.zip_code as string,
    complement: row.complement,
  };
}
```

`InsertOrderData.deliveryAddress?: Address` passa a ser `deliveryAddress?: Address & { complement: string | null };` e o `insertOrder` grava a coluna nova como `$18`:

```ts
    `insert into orders
       (restaurant_id, customer_id, type, total_in_cents, delivery_fee_in_cents,
        tracking_token_hash, street, number, neighborhood, city, state, zip_code,
        payment_method, change_for_in_cents, table_id, table_label, order_number,
        complement)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     returning id`,
```

e, no fim do array de parâmetros, depois de `data.orderNumber`:

```ts
      address?.complement ?? null,
```

Importe `DeliveryAddress` junto dos outros tipos de `../domain/order.ts`.

- [ ] **Step 6: Serviço**

Em `apps/api/src/services/orders.ts`, na montagem do `InsertOrderData` (hoje `deliveryAddress: input.deliveryAddress,`, perto da linha 539), troque por:

```ts
        // o complemento é aparado e "só espaços" vira null — a mesma regra da
        // observação do item: o que não diz nada não é gravado
        deliveryAddress:
          input.deliveryAddress === undefined
            ? undefined
            : { ...input.deliveryAddress, complement: normalizeText(input.deliveryAddress.complement) },
```

e declare, junto das funções auxiliares do arquivo:

```ts
/** Texto livre do cliente: aparado, e vazio vira `null`. */
function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
```

Se o arquivo já tiver uma função equivalente para a observação do item, use-a em vez de criar outra.

- [ ] **Step 7: Schemas das rotas**

Em `apps/api/src/routes/orders.ts`, declare o endereço de entrada do pedido e use-o no corpo da criação (hoje `deliveryAddress: addressSchema,`):

```ts
/**
 * O endereço de entrega do PEDIDO: o value object compartilhado mais o
 * complemento. Schema próprio, e não uma mudança no `addressSchema`: aquele é
 * também o do cadastro da loja e o da cotação, onde complemento não existe.
 */
const orderAddressSchema = {
  ...addressSchema,
  properties: {
    ...addressProperties,
    complement: { type: "string", maxLength: 120 },
  },
};
```

```ts
    deliveryAddress: orderAddressSchema,
```

e, na resposta (`orderSummaryProperties.deliveryAddress`):

```ts
  deliveryAddress: {
    type: "object",
    nullable: true,
    properties: {
      ...addressProperties,
      // `nullable` (F12): sempre presente no endereço, `null` = sem complemento
      complement: { type: "string", nullable: true },
    },
  },
```

Em `apps/api/src/routes/tracking.ts`, o mesmo na resposta:

```ts
    deliveryAddress: {
      type: "object",
      properties: { ...addressProperties, complement: { type: "string", nullable: true } },
    },
```

- [ ] **Step 8: Run test to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/orders-complement.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Suíte, OpenAPI e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test && pnpm lint && pnpm build`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(orders): ✨ adiciona o complemento ao endereço de entrega"
```

### Task 2: Motivo do cancelamento (API)

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-order-cancellation-reason.sql`
- Modify: `apps/api/src/domain/order.ts` (`OrderSummary.cancellationReason`)
- Modify: `apps/api/src/repositories/orders.ts` (`OrderRow`, `toOrderSummary`, `updateStatus`)
- Modify: `apps/api/src/services/orders.ts` (`transitionTo`, `transitionAndPublish`, `cancel`)
- Modify: `apps/api/src/routes/orders.ts` (corpo do `cancel`, schema do detalhe)
- Modify: `apps/api/src/routes/tracking.ts` (schema do acompanhamento)
- Test: `apps/api/test/orders-cancel-reason.test.ts`

**Interfaces:**
- Produces: `OrderSummary.cancellationReason: string | null`; `ordersService.cancel(restaurantId, orderId, reason?: string)`; `POST .../cancel` com corpo opcional `{ reason?: string }` (até 200); `cancellationReason` no detalhe do painel e no acompanhamento, **não** na listagem nem na resposta das transições.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/orders-cancel-reason.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

describe("motivo do cancelamento", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function takeaway() {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });
    return { r, order };
  }

  function cancel(r: { id: string; headers: Record<string, string> }, orderId: string, payload?: unknown) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders/${orderId}/cancel`,
      headers: r.headers,
      ...(payload === undefined ? {} : { payload }),
    });
  }

  it("grava o motivo e mostra no detalhe e no acompanhamento, não na listagem", async () => {
    const { r, order } = await takeaway();
    expect((await cancel(r, order.id, { reason: "  Acabou o salmão  " })).statusCode).toBe(200);

    const detail = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders/${order.id}`, headers: r.headers });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    expect(detail.json().cancellationReason).toBe("Acabou o salmão");
    expect(tracked.json().cancellationReason).toBe("Acabou o salmão");
    expect(list.json().data[0]).not.toHaveProperty("cancellationReason");
  });

  it("sem corpo continua cancelando, e o motivo sai null", async () => {
    const { r, order } = await takeaway();
    expect((await cancel(r, order.id)).statusCode).toBe(200);
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(tracked.json().cancellationReason).toBeNull();
  });

  it("motivo só com espaços é nenhum motivo; mais de 200 caracteres é 400", async () => {
    const a = await takeaway();
    await cancel(a.r, a.order.id, { reason: "   " });
    const tracked = await app.inject({ method: "GET", url: `/orders/${a.order.id}?token=${a.order.trackingToken}` });
    expect(tracked.json().cancellationReason).toBeNull();

    const b = await takeaway();
    expect((await cancel(b.r, b.order.id, { reason: "x".repeat(201) })).statusCode).toBe(400);
  });

  it("pedido em andamento tem motivo null", async () => {
    const { order } = await takeaway();
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });
    expect(tracked.json().cancellationReason).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/orders-cancel-reason.test.ts`
Expected: FAIL — o `cancel` com corpo responde 400 (a rota não declara `body`) e `cancellationReason` é `undefined`.

- [ ] **Step 3: Migration**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api migrate:create add-order-cancellation-reason`

```sql
-- Up Migration

-- O porquê do cancelamento, escrito pela loja para o cliente ler no
-- acompanhamento. Só existe em pedido cancelado.
alter table orders add column cancellation_reason text;
alter table orders
  add constraint orders_cancellation_reason_check check (
    cancellation_reason is null
    or (status = 'cancelled' and char_length(cancellation_reason) <= 200)
  );

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: os motivos dos cancelamentos feitos desde o Up.
alter table orders drop constraint orders_cancellation_reason_check;
alter table orders drop column cancellation_reason;
```

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api migrate:up && pnpm --filter @menuclick/api migrate:down && pnpm --filter @menuclick/api migrate:up`
Expected: sem erro.

- [ ] **Step 4: Domínio e repositório**

`apps/api/src/domain/order.ts`, em `OrderSummary`:

```ts
  /** O porquê do cancelamento, para o cliente ler; `null` fora de `cancelled` ou sem motivo. */
  cancellationReason: string | null;
```

`apps/api/src/repositories/orders.ts`: em `OrderRow`, `cancellation_reason: string | null;`; em `toOrderSummary`, `cancellationReason: row.cancellation_reason,`; e o `updateStatus` recebe o motivo:

```ts
/** Grava a transição de status. Quem valida a transição é o serviço. */
export async function updateStatus(
  orderId: string,
  status: OrderStatus,
  client: PoolClient,
  cancellationReason: string | null = null,
): Promise<void> {
  // o motivo só vale no cancelamento; o check do banco recusa em outro status
  await client.query(
    `update orders set status = $1, cancellation_reason = $3, updated_at = now()
      where id = $2 and deleted_at is null`,
    [status, orderId, status === "cancelled" ? cancellationReason : null],
  );
  // o evento vai na mesma transação da mudança: rollback desfaz os dois
  await insertStatusEvent(orderId, status, client);
}
```

- [ ] **Step 5: Serviço**

Em `apps/api/src/services/orders.ts`, `transitionTo` e `transitionAndPublish` ganham um quarto parâmetro opcional e o repassam:

```ts
async function transitionTo(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
  cancellationReason: string | null = null,
): Promise<Order> {
```

```ts
    await ordersRepository.updateStatus(orderId, to, client, cancellationReason);
```

```ts
async function transitionAndPublish(
  restaurantId: string,
  orderId: string,
  to: OrderStatus,
  cancellationReason: string | null = null,
): Promise<Order> {
  const order = await transitionTo(restaurantId, orderId, to, cancellationReason);
```

```ts
export async function cancel(
  restaurantId: string,
  orderId: string,
  reason?: string,
): Promise<Order> {
  return transitionAndPublish(restaurantId, orderId, "cancelled", normalizeText(reason));
}
```

(`normalizeText` é a da Task 1.)

- [ ] **Step 6: Rotas**

`apps/api/src/routes/orders.ts`, na rota `cancel`: tipo `Body: { reason?: string } | undefined`, e no `schema`:

```ts
        body: {
          type: "object",
          // ⚠️ `nullable` é o que deixa o POST SEM corpo passar: o Fastify
          // valida corpo ausente como `null` (`validateParam` em
          // `fastify/lib/validation.js`), e sem isto o "Recusar" do painel de
          // hoje, que não manda corpo, viraria 400
          nullable: true,
          additionalProperties: false,
          properties: {
            // o cliente lê no acompanhamento; sem motivo, a tela usa um texto genérico
            reason: { type: "string", maxLength: 200 },
          },
        },
```

o tipo do corpo no genérico da rota é `Body: { reason?: string } | null`, a `description` ganha a frase: "Aceita `reason` opcional (até 200 caracteres), que o cliente lê no acompanhamento; sem corpo, cancela sem motivo." e o handler:

```ts
    async (request) => {
      const { restaurantId, orderId } = request.params;
      return ordersService.cancel(restaurantId, orderId, request.body?.reason);
    },
```

⚠️ O `apiRequest` do painel manda `POST` sem corpo e sem `Content-Type`. O teste "sem corpo continua cancelando" prende o `nullable: true` acima: tire-o e confirme que o teste cai com 400.

No `orderDetailResponseSchema`, junto de `statusHistory`:

```ts
    // só o detalhe e o acompanhamento; a listagem não precisa (S10)
    cancellationReason: { type: "string", nullable: true },
```

Em `apps/api/src/routes/tracking.ts`, em `trackedOrderResponseSchema.properties`:

```ts
    // o porquê do cancelamento, escrito pela loja para quem pediu
    cancellationReason: { type: "string", nullable: true },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/orders-cancel-reason.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Suíte, OpenAPI e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test && pnpm lint && pnpm build`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(orders): ✨ aceita o motivo do cancelamento e mostra no acompanhamento"
```

### Task 3: Tempos estimados da loja (API)

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-restaurant-times.sql`
- Modify: `apps/api/src/domain/restaurant.ts` (`Restaurant`, `UpdateRestaurantInput`)
- Modify: `apps/api/src/repositories/restaurants.ts` (`RestaurantRow`, `toRestaurant`, `restaurantColumns`)
- Modify: `apps/api/src/routes/schemas.ts` (`updateRestaurantBodySchema`, `restaurantResponseSchema`)
- Modify: `apps/api/src/services/restaurants.ts` (`update`)
- Test: `apps/api/test/restaurants.times.test.ts`

**Interfaces:**
- Produces: `Restaurant.prepTimeMinutes?`, `Restaurant.deliveryTimeMinMinutes?`, `Restaurant.deliveryTimeMaxMinutes?` (`number`, ausentes quando nulos); `UpdateRestaurantInput` com os três `number | null`. `PATCH /restaurants/:restaurantId` aceita os três (1–240, `null` desliga; os dois de entrega juntos). Não saem no cardápio público.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/restaurants.times.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant } from "./helpers.ts";

describe("tempos estimados da loja", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function patch(payload: Record<string, unknown>) {
    const r = await createRestaurant(app);
    const res = await app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload });
    return { r, res };
  }

  it("grava preparo e faixa de entrega, e devolve no restaurante", async () => {
    const { res } = await patch({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
  });

  it("null desliga: a chave some da resposta", async () => {
    const { r } = await patch({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
    const res = await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { prepTimeMinutes: null, deliveryTimeMinMinutes: null, deliveryTimeMaxMinutes: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty("prepTimeMinutes");
    expect(res.json()).not.toHaveProperty("deliveryTimeMinMinutes");
  });

  it("recusa fora de 1–240, mínimo maior que máximo, e só um dos dois de entrega", async () => {
    expect((await patch({ prepTimeMinutes: 0 })).res.statusCode).toBe(400);
    expect((await patch({ prepTimeMinutes: 241 })).res.statusCode).toBe(400);
    expect((await patch({ deliveryTimeMinMinutes: 60, deliveryTimeMaxMinutes: 40 })).res.statusCode).toBe(400);
    expect((await patch({ deliveryTimeMinMinutes: 40 })).res.statusCode).toBe(400);
    expect((await patch({ deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: null })).res.statusCode).toBe(400);
  });

  it("não sai no cardápio público", async () => {
    const { r } = await patch({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
    const menu = await app.inject({ method: "GET", url: `/menu/${r.slug}` });
    expect(menu.json()).not.toHaveProperty("prepTimeMinutes");
    expect(menu.json()).not.toHaveProperty("deliveryTimeMinMinutes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/restaurants.times.test.ts`
Expected: FAIL — o `PATCH` recusa os campos desconhecidos com 400.

- [ ] **Step 3: Migration**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api migrate:create add-restaurant-times`

```sql
-- Up Migration

-- Os tempos que a loja estima, em minutos: preparo (retirada) e a faixa de
-- entrega. Nulos = sem previsão — o acompanhamento não inventa hora.
alter table restaurants add column prep_time_minutes integer;
alter table restaurants add column delivery_time_min_minutes integer;
alter table restaurants add column delivery_time_max_minutes integer;
alter table restaurants
  add constraint restaurants_times_check check (
    (prep_time_minutes is null or prep_time_minutes between 1 and 240)
    and (
      (delivery_time_min_minutes is null and delivery_time_max_minutes is null)
      or (
        delivery_time_min_minutes between 1 and 240
        and delivery_time_max_minutes between 1 and 240
        and delivery_time_min_minutes <= delivery_time_max_minutes
      )
    )
  );

-- Down Migration

alter table restaurants drop constraint restaurants_times_check;
alter table restaurants drop column delivery_time_max_minutes;
alter table restaurants drop column delivery_time_min_minutes;
alter table restaurants drop column prep_time_minutes;
```

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api migrate:up && pnpm --filter @menuclick/api migrate:down && pnpm --filter @menuclick/api migrate:up`
Expected: sem erro.

- [ ] **Step 4: Domínio e repositório**

`apps/api/src/domain/restaurant.ts`, em `Restaurant` (junto de `coverUrl`/`brandColor`):

```ts
  /** Minutos de preparo para a retirada; ausente = sem previsão. Só por PATCH. */
  prepTimeMinutes?: number;
  /** Faixa de entrega em minutos; os dois juntos ou nenhum. Só por PATCH. */
  deliveryTimeMinMinutes?: number;
  deliveryTimeMaxMinutes?: number;
```

e em `UpdateRestaurantInput` (no bloco `& { ... }`):

```ts
  /** `null` desliga a previsão da retirada. */
  prepTimeMinutes?: number | null;
  /** `null` nos dois desliga a previsão da entrega. */
  deliveryTimeMinMinutes?: number | null;
  deliveryTimeMaxMinutes?: number | null;
```

`apps/api/src/repositories/restaurants.ts`: em `RestaurantRow`, `prep_time_minutes: number | null; delivery_time_min_minutes: number | null; delivery_time_max_minutes: number | null;`; em `toRestaurant`, depois de `brandColor`:

```ts
    ...(row.prep_time_minutes === null ? {} : { prepTimeMinutes: row.prep_time_minutes }),
    ...(row.delivery_time_min_minutes === null
      ? {}
      : {
          deliveryTimeMinMinutes: row.delivery_time_min_minutes,
          deliveryTimeMaxMinutes: row.delivery_time_max_minutes as number,
        }),
```

e em `restaurantColumns`:

```ts
  prepTimeMinutes: "prep_time_minutes",
  deliveryTimeMinMinutes: "delivery_time_min_minutes",
  deliveryTimeMaxMinutes: "delivery_time_max_minutes",
```

- [ ] **Step 5: Schemas**

`apps/api/src/routes/schemas.ts`, em `updateRestaurantBodySchema.properties`:

```ts
    // os tempos estimados; `null` desliga a previsão (F12). Não saem no
    // cardápio público: viram a previsão calculada no acompanhamento
    prepTimeMinutes: { type: "integer", minimum: 1, maximum: 240, nullable: true },
    deliveryTimeMinMinutes: { type: "integer", minimum: 1, maximum: 240, nullable: true },
    deliveryTimeMaxMinutes: { type: "integer", minimum: 1, maximum: 240, nullable: true },
```

e, no mesmo objeto (irmão de `properties`), a faixa de entrega só vem em par:

```ts
  // a faixa de entrega é um par: mandar só a ponta de baixo deixaria uma faixa
  // sem teto, e o banco recusaria com erro de constraint em vez de 400
  dependencies: {
    deliveryTimeMinMinutes: ["deliveryTimeMaxMinutes"],
    deliveryTimeMaxMinutes: ["deliveryTimeMinMinutes"],
  },
```

Em `restaurantResponseSchema.properties`:

```ts
    prepTimeMinutes: { type: "integer" },
    deliveryTimeMinMinutes: { type: "integer" },
    deliveryTimeMaxMinutes: { type: "integer" },
```

- [ ] **Step 6: Serviço**

`apps/api/src/services/restaurants.ts`, ao lado de `assertCorLegivel`:

```ts
/**
 * A faixa de entrega vem em par (o schema garante) e com sentido: nula nas
 * duas pontas, ou número nas duas com o mínimo até o máximo.
 */
function assertFaixaDeEntrega(input: UpdateRestaurantInput): void {
  const { deliveryTimeMinMinutes: min, deliveryTimeMaxMinutes: max } = input;
  if (min === undefined && max === undefined) return;
  if ((min === null) !== (max === null)) {
    throw new ValidationError("Informe o tempo mínimo e o máximo da entrega, ou nenhum dos dois");
  }
  if (typeof min === "number" && typeof max === "number" && min > max) {
    throw new ValidationError("O tempo mínimo da entrega não pode passar do máximo");
  }
}
```

e chame em `update`, depois de `assertCorLegivel(input.brandColor);`:

```ts
  assertFaixaDeEntrega(input);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/restaurants.times.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Suíte, OpenAPI e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test && pnpm lint && pnpm build`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(restaurants): ✨ adiciona os tempos estimados de preparo e de entrega"
```

### Task 4: Previsão e horários no acompanhamento público (API)

**Files:**
- Create: `apps/api/src/domain/estimate.ts`
- Modify: `apps/api/src/domain/order.ts` (`TrackedOrder`)
- Modify: `apps/api/src/services/orders.ts` (`getByTrackingToken`)
- Modify: `apps/api/src/routes/tracking.ts` (`trackedOrderResponseSchema`, `description`)
- Test: `apps/api/test/estimate.unit.test.ts`, `apps/api/test/orders-tracking-estimate.test.ts`

**Interfaces:**
- Consumes: `Restaurant.prepTimeMinutes?/deliveryTimeMinMinutes?/deliveryTimeMaxMinutes?` (Task 3); `ordersRepository.findStatusHistory(orderId)`; `restaurantsRepository.findById(id)`.
- Produces: `Estimate = { readyAt: string } | { from: string; to: string }`; `estimateFor(order: { type: OrderType; status: OrderStatus }, history: OrderStatusEvent[], times: EstimateTimes): Estimate | null`; `TrackedOrder = Order & { statusHistory: OrderStatusEvent[]; estimate: Estimate | null }`. `GET /orders/:orderId?token=` devolve `statusHistory` e `estimate` (sempre presente, `null` quando não há o que prever).

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/api/test/estimate.unit.test.ts
import { describe, expect, it } from "vitest";
import { estimateFor } from "../src/domain/estimate.ts";

const confirmed = [
  { status: "pending" as const, at: "2026-09-30T21:00:00.000Z" },
  { status: "confirmed" as const, at: "2026-09-30T21:02:00.000Z" },
];
const times = { prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 };

describe("previsão a partir da confirmação", () => {
  it("retirada: pronto em confirmado + preparo", () => {
    expect(estimateFor({ type: "takeaway", status: "preparing" }, confirmed, times)).toEqual({
      readyAt: "2026-09-30T21:27:00.000Z",
    });
  });

  it("entrega: a faixa a partir da confirmação", () => {
    expect(estimateFor({ type: "delivery", status: "out_for_delivery" }, confirmed, times)).toEqual({
      from: "2026-09-30T21:42:00.000Z",
      to: "2026-09-30T21:57:00.000Z",
    });
  });

  it("sem previsão: antes de confirmar, terminado, salão ou sem tempo configurado", () => {
    expect(estimateFor({ type: "takeaway", status: "pending" }, confirmed.slice(0, 1), times)).toBeNull();
    expect(estimateFor({ type: "takeaway", status: "completed" }, confirmed, times)).toBeNull();
    expect(estimateFor({ type: "delivery", status: "cancelled" }, confirmed, times)).toBeNull();
    expect(estimateFor({ type: "dine_in", status: "preparing" }, confirmed, times)).toBeNull();
    expect(estimateFor({ type: "takeaway", status: "preparing" }, confirmed, {})).toBeNull();
    expect(estimateFor({ type: "delivery", status: "preparing" }, confirmed, { prepTimeMinutes: 25 })).toBeNull();
  });

  // pedido anterior ao registro de status tem só a chegada: sem "confirmed", sem conta
  it("confirmado sem evento de confirmação: sem previsão", () => {
    expect(estimateFor({ type: "takeaway", status: "preparing" }, confirmed.slice(0, 1), times)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/estimate.unit.test.ts`
Expected: FAIL — `Failed to resolve import "../src/domain/estimate.ts"`.

- [ ] **Step 3: Implement `domain/estimate.ts`**

```ts
// apps/api/src/domain/estimate.ts
import type { OrderStatus, OrderStatusEvent, OrderType } from "./order.ts";

/** Retirada: a hora em que fica pronto. Entrega: a faixa de chegada. */
export type Estimate = { readyAt: string } | { from: string; to: string };

export type EstimateTimes = {
  prepTimeMinutes?: number;
  deliveryTimeMinMinutes?: number;
  deliveryTimeMaxMinutes?: number;
};

const MINUTE_MS = 60_000;
const FINISHED: readonly OrderStatus[] = ["completed", "cancelled"];

/**
 * A previsão conta a partir de quando a LOJA ACEITOU (o evento `confirmed`),
 * não de quando o pedido chegou: um pedido esquecido dez minutos em "Novos"
 * não pode prometer que já está quase pronto. Antes da confirmação, depois do
 * fim, no salão, sem o evento (pedido anterior ao histórico) ou sem tempo
 * configurado: `null` — a tela não inventa hora.
 *
 * Os tempos são os de AGORA, não congelados no pedido: previsão é estimativa,
 * e a loja que muda o tempo no meio do almoço quer que ele valha já.
 */
export function estimateFor(
  order: { type: OrderType; status: OrderStatus },
  history: OrderStatusEvent[],
  times: EstimateTimes,
): Estimate | null {
  if (FINISHED.includes(order.status)) return null;
  const confirmedAt = history.find((event) => event.status === "confirmed")?.at;
  if (confirmedAt === undefined) return null;
  const base = Date.parse(confirmedAt);
  const plus = (minutes: number) => new Date(base + minutes * MINUTE_MS).toISOString();

  if (order.type === "takeaway" && times.prepTimeMinutes !== undefined) {
    return { readyAt: plus(times.prepTimeMinutes) };
  }
  if (
    order.type === "delivery" &&
    times.deliveryTimeMinMinutes !== undefined &&
    times.deliveryTimeMaxMinutes !== undefined
  ) {
    return { from: plus(times.deliveryTimeMinMinutes), to: plus(times.deliveryTimeMaxMinutes) };
  }
  return null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/estimate.unit.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing integration test**

```ts
// apps/api/test/orders-tracking-estimate.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

describe("acompanhamento: horários e previsão", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("devolve o histórico de status e a previsão depois de confirmado", async () => {
    const r = await createRestaurant(app);
    await app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload: { prepTimeMinutes: 25 } });
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });
    const track = () => app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });

    const antes = (await track()).json();
    expect(antes.statusHistory.map((e: { status: string }) => e.status)).toEqual(["pending"]);
    expect(antes.estimate).toBeNull();

    await app.inject({ method: "POST", url: `/restaurants/${r.id}/orders/${order.id}/confirm`, headers: r.headers });
    const depois = (await track()).json();
    const confirmedAt = depois.statusHistory.find((e: { status: string }) => e.status === "confirmed").at;
    expect(depois.estimate).toEqual({
      readyAt: new Date(Date.parse(confirmedAt) + 25 * 60_000).toISOString(),
    });
  });

  it("sem tempo configurado, a previsão é null (e a chave existe)", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });
    await app.inject({ method: "POST", url: `/restaurants/${r.id}/orders/${order.id}/confirm`, headers: r.headers });
    const body = (await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` })).json();
    expect(body).toHaveProperty("estimate", null);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/orders-tracking-estimate.test.ts`
Expected: FAIL — `statusHistory` e `estimate` são `undefined` (o schema os filtra e o serviço não os calcula).

- [ ] **Step 7: Tipo, serviço e schema**

`apps/api/src/domain/order.ts`, depois de `OrderDetail`:

```ts
/**
 * O pedido como quem o fez vê pelo acompanhamento: os horários de cada etapa
 * (os do próprio pedido, nada da loja) e a previsão calculada.
 */
export type TrackedOrder = Order & { statusHistory: OrderStatusEvent[]; estimate: Estimate | null };
```

(importe `Estimate` com `import type { Estimate } from "./estimate.ts";`.)

`apps/api/src/services/orders.ts`, `getByTrackingToken` passa a devolver `TrackedOrder`:

```ts
export async function getByTrackingToken(
  orderId: string,
  token: string,
): Promise<TrackedOrder> {
  const order = await findByTrackingToken(token);
  if (order === null || order.id !== orderId) {
    throw new NotFoundError("Pedido não encontrado");
  }
  const [statusHistory, restaurant] = await Promise.all([
    ordersRepository.findStatusHistory(order.id),
    // restaurante removido não derruba o acompanhamento: pedido é histórico
    // (sem cascata), só fica sem previsão
    restaurantsRepository.findById(order.restaurantId),
  ]);
  return {
    ...order,
    statusHistory,
    estimate: restaurant === null ? null : estimateFor(order, statusHistory, restaurant),
  };
}
```

Importe `estimateFor` de `../domain/estimate.ts`, `TrackedOrder` de `../domain/order.ts` e, se o arquivo ainda não importa, `* as restaurantsRepository from "../repositories/restaurants.ts"`. (O `findByTrackingToken` exportado continua devolvendo `Order`: é o que o WebSocket usa.)

`apps/api/src/routes/tracking.ts`, em `trackedOrderResponseSchema.properties`:

```ts
    // os horários de cada etapa do PRÓPRIO pedido — a trilha do acompanhamento
    statusHistory: {
      type: "array",
      items: { type: "object", properties: { status: { type: "string" }, at: { type: "string" } } },
    },
    // `null` antes da loja aceitar, depois do fim ou sem tempo configurado:
    // a tela não inventa hora. Retirada traz `readyAt`; entrega, `from`/`to`
    estimate: {
      type: "object",
      nullable: true,
      properties: { readyAt: { type: "string" }, from: { type: "string" }, to: { type: "string" } },
    },
```

e acrescente à `description` do `getTrackedOrder`: "Traz `statusHistory` (a hora de cada etapa) e `estimate` (a previsão a partir da confirmação, com os tempos configurados pela loja; `null` quando não há o que prever)."

- [ ] **Step 8: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/estimate.unit.test.ts test/orders-tracking-estimate.test.ts test/orders-tracking-http.test.ts`
Expected: PASS.

- [ ] **Step 9: Suíte, OpenAPI e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test && pnpm lint && pnpm build`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(orders): ✨ devolve horários e previsão no acompanhamento público"
```

### Task 5: Bairros atendidos no cardápio público (API)

**Files:**
- Modify: `apps/api/src/domain/menu.ts` (`MenuRestaurant.deliveryNeighborhoods`)
- Modify: `apps/api/src/services/menu.ts` (`toMenuRestaurant`, `getRestaurant`)
- Modify: `apps/api/src/routes/menu.ts` (`menuRestaurantResponseSchema`)
- Test: `apps/api/test/menu-neighborhoods.test.ts`

**Interfaces:**
- Consumes: `deliveryNeighborhoodsRepository.findByRestaurant(restaurantId): Promise<{ name: string; feeInCents: number }[]>`.
- Produces: `GET /menu/:slug` com `deliveryNeighborhoods: string[]` (nomes, em ordem alfabética; `[]` fora do modo `neighborhood`). O `address` da loja **já sai** hoje (confirmado no levantamento) — esta tarefa só o prende por teste.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/menu-neighborhoods.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createRestaurant, setDeliveryNeighborhoods } from "./helpers.ts";

describe("cardápio público: bairros atendidos e endereço da loja", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("no modo por bairro, só os nomes — nunca os valores", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    await setDeliveryNeighborhoods(app, r, [
      { name: "Jardins", feeInCents: 0 },
      { name: "Centro", feeInCents: 900 },
    ]);
    await app.inject({ method: "PATCH", url: `/restaurants/${r.id}`, headers: r.headers, payload: { deliveryFeeMode: "neighborhood" } });
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.deliveryNeighborhoods).toEqual(["Centro", "Jardins"]);
    expect(JSON.stringify(menu)).not.toContain("feeInCents");
  });

  it("fora do modo por bairro, a lista vem vazia", async () => {
    const r = await createRestaurant(app, { isDelivery: true });
    await setDeliveryNeighborhoods(app, r, [{ name: "Centro", feeInCents: 900 }]);
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.deliveryNeighborhoods).toEqual([]);
  });

  // a retirada precisa dizer onde buscar
  it("traz o endereço da loja", async () => {
    const r = await createRestaurant(app);
    const menu = (await app.inject({ method: "GET", url: `/menu/${r.slug}` })).json();
    expect(menu.address).toMatchObject({ street: expect.any(String), number: expect.any(String), city: expect.any(String) });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/menu-neighborhoods.test.ts`
Expected: FAIL nos dois primeiros (`deliveryNeighborhoods` é `undefined`); o do endereço passa.

- [ ] **Step 3: Implement**

`apps/api/src/domain/menu.ts`, no bloco `& { ... }` de `MenuRestaurant`:

```ts
  /**
   * Os NOMES dos bairros atendidos, no modo por bairro — para a tela oferecer
   * um seletor antes de a pessoa digitar o endereço. Os valores continuam
   * saindo só pela cotação, para o endereço de cada um (S10). Vazia nos outros
   * modos.
   */
  deliveryNeighborhoods: string[];
```

`apps/api/src/services/menu.ts`: `toMenuRestaurant` ganha um quinto parâmetro `deliveryNeighborhoods: string[]` e o devolve (`deliveryNeighborhoods,` depois de `paymentMethods`); `getRestaurant`:

```ts
export async function getRestaurant(slug: string): Promise<MenuRestaurant> {
  const restaurant = await restaurantsService.getBySlug(slug);

  const [status, grade, neighborhoods] = await Promise.all([
    openingHoursRepository.findOpeningStatus(restaurant.id, restaurant.timezone),
    openingHoursRepository.findByRestaurant(restaurant.id),
    // só o modo por bairro tem lista a oferecer; nos outros, nem consulta
    restaurant.deliveryFeeMode === "neighborhood"
      ? deliveryNeighborhoodsRepository.findByRestaurant(restaurant.id)
      : Promise.resolve([]),
  ]);

  // a loja só está aberta se a grade permite E ninguém pausou; a mesma conta
  // do painel (`findOpeningStatus`, com a fusão das faixas encostadas)
  return toMenuRestaurant(
    restaurant,
    status.isOpen && restaurant.acceptingOrders,
    grade,
    status,
    neighborhoods.map((n) => n.name),
  );
}
```

com `import * as deliveryNeighborhoodsRepository from "../repositories/delivery-neighborhoods.ts";`.

`apps/api/src/routes/menu.ts`, em `menuRestaurantResponseSchema.properties`:

```ts
    // os nomes dos bairros atendidos, para o seletor do endereço; os valores
    // saem só pela cotação (S10)
    deliveryNeighborhoods: { type: "array", items: { type: "string" } },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api exec vitest run test/menu-neighborhoods.test.ts test/menu-public.test.ts`
Expected: PASS.

- [ ] **Step 5: Suíte, OpenAPI e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test && pnpm lint && pnpm build`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(menu): ✨ lista os bairros atendidos no cardápio público"
```

### Task 6: Motivo ao cancelar, complemento e motivo no detalhe (painel)

**Files:**
- Modify: `apps/panel/src/api/types.ts` (`Address.complement`, `OrderDetail.cancellationReason`)
- Modify: `apps/panel/src/api/orders.ts` (`transitionOrder` com corpo opcional)
- Modify: `apps/panel/src/ui/ConfirmDialog.tsx` (slot `children` entre o texto e os botões)
- Modify: `apps/panel/src/features/orders/orderActionFlow.tsx` (campo de motivo no cancelar)
- Modify: `apps/panel/src/features/orders/presentation.ts` (`whereLabel` com complemento)
- Modify: `apps/panel/src/features/orders/OrderDrawer.tsx` (motivo no pedido cancelado)
- Modify: `apps/panel/test/fixtures.ts` (defaults dos campos novos)
- Test: `apps/panel/test/order-actions.test.tsx`, `apps/panel/test/presentation.test.ts` (criar se não existir)

**Interfaces:**
- Consumes: `POST .../cancel` com `{ reason?: string }` (Task 2); `deliveryAddress.complement` (Task 1); `cancellationReason` no detalhe (Task 2).
- Produces: `transitionOrder(restaurantId, orderId, transition, body?: { reason?: string })`; `ConfirmDialog` aceita `children?: ReactNode`.

- [ ] **Step 1: Write the failing tests**

Em `apps/panel/test/order-actions.test.tsx`, dentro do `describe("ações do pedido")`:

```tsx
  it("cancelar manda o motivo que a loja escreveu, aparado; vazio não manda corpo", async () => {
    signIn();
    const api = mockApi([
      { method: "POST", path: `${LIST}/${ID}/cancel`, body: makeOrderDetail({ id: ID, number: 1042, status: "cancelled" }) },
      listHandler([makeOrder({ id: ID, number: 1042, status: "pending" })]),
      noTables,
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/pedidos");
    fireEvent.click(within(await cardOf("#1042")).getByRole("button", { name: "Recusar" }));
    const dialog = await screen.findByRole("dialog", { name: "Recusar o pedido #1042?" });
    fireEvent.change(within(dialog).getByLabelText("Motivo (o cliente vê)"), {
      target: { value: "  Acabou o salmão  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Recusar pedido" }));
    await waitFor(() => {
      const call = api.calls.find((c) => c.path === `${LIST}/${ID}/cancel`);
      expect(call?.body).toEqual({ reason: "Acabou o salmão" });
    });
  });
```

e, no teste já existente "recusar pedido novo pede confirmação…", depois do `waitFor` final:

```tsx
    expect(api.calls.find((c) => c.path === `${LIST}/${ID}/cancel`)?.body).toBeUndefined();
```

Crie (ou estenda) `apps/panel/test/presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { whereLabel } from "../src/features/orders/presentation.ts";

describe("onde o pedido vai", () => {
  const address = { street: "Rua Augusta", number: "1500", neighborhood: "Consolação", city: "São Paulo", state: "SP", zipCode: "01304-001" };

  it("entrega com complemento mostra o complemento depois do número", () => {
    expect(whereLabel({ type: "delivery", table: null, deliveryAddress: { ...address, complement: "apto 42" } })).toBe(
      "Rua Augusta, 1500 (apto 42) — Consolação, São Paulo",
    );
  });

  it("sem complemento fica como antes", () => {
    expect(whereLabel({ type: "delivery", table: null, deliveryAddress: { ...address, complement: null } })).toBe(
      "Rua Augusta, 1500 — Consolação, São Paulo",
    );
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/order-actions.test.tsx test/presentation.test.ts`
Expected: FAIL — não existe o campo "Motivo (o cliente vê)", e o `whereLabel` ignora o complemento.

- [ ] **Step 3: Tipos e cliente**

`apps/panel/src/api/types.ts`:

```ts
export type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  /** Só no endereço de entrega do pedido; `null` = sem complemento. */
  complement?: string | null;
};
```

e em `OrderDetail` (o tipo do detalhe, que já tem `statusHistory`):

```ts
  /** O que a loja escreveu ao cancelar; `null` fora de cancelado ou sem motivo. */
  cancellationReason?: string | null;
```

`apps/panel/src/api/orders.ts`:

```ts
export function transitionOrder(
  restaurantId: string,
  orderId: string,
  transition: OrderTransition,
  body?: { reason?: string },
): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(
    `/restaurants/${restaurantId}/orders/${orderId}/${ENDPOINT[transition]}`,
    { method: "POST", ...(body === undefined ? {} : { body }) },
  );
}
```

Em `apps/panel/test/fixtures.ts`, `makeOrderDetail` ganha `cancellationReason: null,` no objeto padrão.

- [ ] **Step 4: `ConfirmDialog` com conteúdo extra**

```tsx
export function ConfirmDialog({
  copy,
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  copy: ConfirmCopy | null;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Campo extra entre o texto e os botões (o motivo do cancelamento). */
  children?: ReactNode;
}) {
```

e, dentro de `classes.body`, logo depois do `{copy.warn && …}`:

```tsx
          {children}
```

(`import type { ReactNode } from "react";`)

- [ ] **Step 5: O motivo no fluxo de ações**

Em `apps/panel/src/features/orders/orderActionFlow.tsx`:

```tsx
type ActionRequest = { order: Order; transition: OrderTransition; reason?: string };
```

```tsx
  const [reason, setReason] = useState("");
```

no `mutationFn`, o ramo que não é `accept`:

```tsx
      if (transition !== "accept") {
        const trimmed = reason?.trim() ?? "";
        await transitionOrder(
          restaurantId,
          order.id,
          transition,
          transition === "cancel" && trimmed !== "" ? { reason: trimmed } : undefined,
        );
        return;
      }
```

(o `mutationFn` passa a desestruturar `{ order, transition, reason }`); em `request`, zere o texto ao abrir um cancelamento:

```tsx
    if (transition === "accept" || transition === "cancel") {
      setReason("");
      setConfirming({ order, transition });
    }
```

no `onConfirm` do `ConfirmDialog`:

```tsx
          if (confirming !== null) mutation.mutate({ ...confirming, reason });
```

e o campo, como filho do `ConfirmDialog`, só no cancelamento:

```tsx
      <ConfirmDialog
        copy={copy}
        busy={mutation.isPending}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming !== null) mutation.mutate({ ...confirming, reason });
        }}
      >
        {confirming?.transition === "cancel" && (
          <Textarea
            label="Motivo (o cliente vê)"
            placeholder="Ex.: acabou o salmão"
            maxLength={200}
            autosize
            minRows={2}
            value={reason}
            disabled={mutation.isPending}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        )}
      </ConfirmDialog>
```

(`Textarea` vem de `@mantine/core`.)

- [ ] **Step 6: Complemento e motivo na tela**

`apps/panel/src/features/orders/presentation.ts`:

```ts
export function whereLabel(order: Pick<Order, "type" | "deliveryAddress" | "table">): string {
  if (order.type === "delivery" && order.deliveryAddress) {
    const a = order.deliveryAddress;
    const complement = a.complement ? ` (${a.complement})` : "";
    return `${a.street}, ${a.number}${complement} — ${a.neighborhood}, ${a.city}`;
  }
  if (order.type === "dine_in") return order.table ? order.table.label : "Salão · sem mesa";
  return "Retirada no balcão";
}
```

`apps/panel/src/features/orders/OrderDrawer.tsx`, logo depois do bloco `togglePaid.isError`:

```tsx
        {order.status === "cancelled" && order.cancellationReason && (
          <p className={classes.payment}>Motivo do cancelamento: {order.cancellationReason}</p>
        )}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm lint && pnpm --filter @menuclick/panel build`
Expected: verde.

```bash
git add apps/panel
git commit -m "feat(panel): ✨ pede o motivo ao cancelar e mostra o complemento do endereço"
```

### Task 7: Tempos estimados na tela de Modalidades (painel)

**Files:**
- Create: `apps/panel/src/features/settings/times.ts` (regra, sem React)
- Create: `apps/panel/src/features/settings/TimesCard.tsx`
- Modify: `apps/panel/src/features/settings/ModalitiesPage.tsx`
- Modify: `apps/panel/src/api/types.ts` (`Restaurant`), `apps/panel/src/api/restaurant.ts` (`RestaurantPatch`)
- Test: `apps/panel/test/times.test.ts`, `apps/panel/test/modalities-page.test.tsx`

**Interfaces:**
- Consumes: `PATCH /restaurants/:restaurantId` com `prepTimeMinutes`, `deliveryTimeMinMinutes`, `deliveryTimeMaxMinutes` (Task 3); `useUpdateRestaurant(id)`; `SaveBar`.
- Produces: `TimesForm = { prep: string; min: string; max: string }`; `timesFromRestaurant(r)`, `validateTimes(form): string | null`, `timesPatch(form, initial): RestaurantPatch`.

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/panel/test/times.test.ts
import { describe, expect, it } from "vitest";
import { timesFromRestaurant, timesPatch, validateTimes } from "../src/features/settings/times.ts";

describe("tempos estimados", () => {
  it("lê do restaurante; ausente vira campo vazio", () => {
    expect(timesFromRestaurant({ prepTimeMinutes: 25 })).toEqual({ prep: "25", min: "", max: "" });
    expect(timesFromRestaurant({ deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 })).toEqual({ prep: "", min: "40", max: "55" });
  });

  it("valida 1–240, mínimo até o máximo, e a faixa em par", () => {
    expect(validateTimes({ prep: "25", min: "40", max: "55" })).toBeNull();
    expect(validateTimes({ prep: "", min: "", max: "" })).toBeNull();
    expect(validateTimes({ prep: "0", min: "", max: "" })).toBe("Use minutos entre 1 e 240.");
    expect(validateTimes({ prep: "abc", min: "", max: "" })).toBe("Use minutos entre 1 e 240.");
    expect(validateTimes({ prep: "", min: "60", max: "40" })).toBe("O tempo mínimo da entrega não pode passar do máximo.");
    expect(validateTimes({ prep: "", min: "40", max: "" })).toBe("Preencha os dois tempos da entrega, ou deixe os dois vazios.");
  });

  it("manda só o que mudou; vazio vai como null", () => {
    const initial = { prep: "25", min: "40", max: "55" };
    expect(timesPatch({ prep: "30", min: "40", max: "55" }, initial)).toEqual({ prepTimeMinutes: 30 });
    expect(timesPatch({ prep: "", min: "40", max: "55" }, initial)).toEqual({ prepTimeMinutes: null });
    // a faixa vai sempre em par: a API exige os dois juntos
    expect(timesPatch({ prep: "25", min: "45", max: "55" }, initial)).toEqual({ deliveryTimeMinMinutes: 45, deliveryTimeMaxMinutes: 55 });
    expect(timesPatch({ prep: "25", min: "", max: "" }, initial)).toEqual({ deliveryTimeMinMinutes: null, deliveryTimeMaxMinutes: null });
    expect(timesPatch(initial, initial)).toEqual({});
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/times.test.ts`
Expected: FAIL — `times.ts` não existe.

- [ ] **Step 3: Implement `times.ts` and the types**

`apps/panel/src/api/types.ts`, em `Restaurant`:

```ts
  /** Minutos de preparo para a retirada; ausente = sem previsão. */
  prepTimeMinutes?: number;
  /** Faixa de entrega em minutos; os dois juntos ou nenhum. */
  deliveryTimeMinMinutes?: number;
  deliveryTimeMaxMinutes?: number;
```

`apps/panel/src/api/restaurant.ts`, em `RestaurantPatch`:

```ts
  prepTimeMinutes: number | null;
  deliveryTimeMinMinutes: number | null;
  deliveryTimeMaxMinutes: number | null;
```

```ts
// apps/panel/src/features/settings/times.ts
import type { RestaurantPatch } from "../../api/restaurant.ts";
import type { Restaurant } from "../../api/types.ts";

/** Os tempos como a tela os edita: texto, e vazio é "sem previsão". */
export type TimesForm = { prep: string; min: string; max: string };

type Times = Pick<Restaurant, "prepTimeMinutes" | "deliveryTimeMinMinutes" | "deliveryTimeMaxMinutes">;

const text = (value: number | undefined) => (value === undefined ? "" : String(value));

export function timesFromRestaurant(r: Times): TimesForm {
  return { prep: text(r.prepTimeMinutes), min: text(r.deliveryTimeMinMinutes), max: text(r.deliveryTimeMaxMinutes) };
}

/** `null` = vazio; `NaN` = inválido. */
function minutes(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const valid = (n: number | null) => n === null || (n >= 1 && n <= 240);

/** A mesma regra da API, para o erro aparecer antes de salvar. */
export function validateTimes(form: TimesForm): string | null {
  const [prep, min, max] = [minutes(form.prep), minutes(form.min), minutes(form.max)];
  if (![prep, min, max].every(valid)) return "Use minutos entre 1 e 240.";
  if ((min === null) !== (max === null)) return "Preencha os dois tempos da entrega, ou deixe os dois vazios.";
  if (min !== null && max !== null && min > max) return "O tempo mínimo da entrega não pode passar do máximo.";
  return null;
}

/** Só o que mudou. A faixa de entrega vai sempre em par — a API exige. */
export function timesPatch(form: TimesForm, initial: TimesForm): RestaurantPatch {
  const patch: RestaurantPatch = {};
  if (form.prep.trim() !== initial.prep) patch.prepTimeMinutes = minutes(form.prep);
  if (form.min.trim() !== initial.min || form.max.trim() !== initial.max) {
    patch.deliveryTimeMinMinutes = minutes(form.min);
    patch.deliveryTimeMaxMinutes = minutes(form.max);
  }
  return patch;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/times.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing page test**

Em `apps/panel/test/modalities-page.test.tsx`, dentro do `describe("ModalitiesPage")`:

```tsx
  it("salva os tempos estimados, mandando a faixa de entrega em par", async () => {
    signIn();
    const api = mockApi([
      {
        method: "PATCH",
        path: `/restaurants/${RESTAURANT_ID}`,
        body: makeRestaurant({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 }),
      },
      ...panelHandlers(),
    ]);
    renderInPanel(routes, "/modalidades");
    fireEvent.change(await screen.findByLabelText("Preparo para retirada (min)"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("Entrega a partir de (min)"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Entrega até (min)"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tempos" }));
    await waitFor(() => {
      const call = api.calls.find((c) => c.method === "PATCH");
      expect(call?.body).toEqual({ prepTimeMinutes: 25, deliveryTimeMinMinutes: 40, deliveryTimeMaxMinutes: 55 });
    });
  });

  it("não salva faixa de entrega pela metade, e diz por quê", async () => {
    signIn();
    const api = mockApi([...panelHandlers()]);
    renderInPanel(routes, "/modalidades");
    fireEvent.change(await screen.findByLabelText("Entrega a partir de (min)"), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar tempos" }));
    expect(await screen.findByText("Preencha os dois tempos da entrega, ou deixe os dois vazios.")).toBeTruthy();
    expect(api.calls.some((c) => c.method === "PATCH")).toBe(false);
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel exec vitest run test/modalities-page.test.tsx`
Expected: FAIL — os campos não existem.

- [ ] **Step 7: Implement `TimesCard` and mount it**

```tsx
// apps/panel/src/features/settings/TimesCard.tsx
import { TextInput } from "@mantine/core";
import { useState } from "react";
import type { Restaurant } from "../../api/types.ts";
import { SaveBar } from "../../ui/SaveBar.tsx";
import { useUpdateRestaurant } from "../restaurant/useRestaurant.ts";
import classes from "./ModalitiesPage.module.css";
import { timesFromRestaurant, timesPatch, validateTimes } from "./times.ts";

/**
 * Os tempos que viram a previsão do acompanhamento. Formulário com barra de
 * salvar própria — os interruptores acima continuam salvando sozinhos, mas um
 * número pela metade ("4" de "45") não pode virar previsão enquanto se digita.
 * Montado com `key` no `updatedAt` do restaurante: salvar recomeça do salvo.
 */
export function TimesCard({ restaurant }: { restaurant: Restaurant }) {
  const initial = timesFromRestaurant(restaurant);
  const [form, setForm] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateRestaurant(restaurant.id);
  const patch = timesPatch(form, initial);
  const dirty = Object.keys(patch).length > 0;

  const field = (name: keyof typeof form) => ({
    value: form[name],
    inputMode: "numeric" as const,
    onChange: (event: { currentTarget: { value: string } }) =>
      setForm((current) => ({ ...current, [name]: event.currentTarget.value })),
  });

  const submit = () => {
    const found = validateTimes(form);
    setProblem(found);
    if (found !== null || !dirty) return;
    update.mutate(patch);
  };

  return (
    <section className={classes.card}>
      <h2 className={classes.cardTitle}>Tempos estimados</h2>
      <p className={classes.note}>
        Viram a previsão que o cliente vê ao acompanhar o pedido, contada a partir de quando a loja aceita. Vazio = sem
        previsão.
      </p>
      <TextInput label="Preparo para retirada (min)" {...field("prep")} />
      <TextInput label="Entrega a partir de (min)" {...field("min")} />
      <TextInput label="Entrega até (min)" {...field("max")} />
      {(problem ?? (update.isError ? update.error.message : null)) && (
        <p role="alert" className={classes.error}>
          {problem ?? update.error?.message}
        </p>
      )}
      <SaveBar
        dirty={dirty}
        busy={update.isPending}
        saveLabel="Salvar tempos"
        onSave={submit}
        cancel={{ onClick: () => setForm(initial) }}
      />
    </section>
  );
}
```

Em `ModalitiesPage.tsx`, depois do card de Pagamento:

```tsx
      <TimesCard key={data.updatedAt} restaurant={data} />
```

(`import { TimesCard } from "./TimesCard.tsx";`). Se a `SaveBar` só renderizar o botão com `dirty`, o segundo teste precisa de `dirty` verdadeiro — ele tem (o campo mudou). Use `describeError(update.error)` no lugar de `update.error.message` se o arquivo já importa `describeError`, como o `FlagRow` faz.

- [ ] **Step 8: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/panel test`
Expected: tudo verde.

- [ ] **Step 9: Commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm lint && pnpm --filter @menuclick/panel build`
Expected: verde.

```bash
git add apps/panel
git commit -m "feat(panel): ✨ edita os tempos estimados de preparo e de entrega"
```

### Task 8: Bases do app — tipos, máscaras, endereço lembrado e pedido em andamento

**Files:**
- Modify: `apps/menu/src/lib/types.ts` (`Address`, `MenuRestaurant.address/deliveryFeeMode/deliveryNeighborhoods`)
- Modify: `apps/menu/test/fixtures.ts` (`makeRestaurant` com os campos novos)
- Modify: `apps/menu/src/lib/checkout.ts` (`formatZip`, `formatMoneyInput`, `centsFromMoneyInput`)
- Modify: `apps/menu/src/lib/customer.ts` (endereço lembrado)
- Create: `apps/menu/src/lib/active-order.ts`
- Test: `apps/menu/test/checkout.test.ts`, `apps/menu/test/customer.test.ts`, `apps/menu/test/active-order.test.ts`

**Interfaces:**
- Produces:
  - `Address = { street; number; neighborhood; city; state; zipCode }` e `MenuRestaurant.address: Address`, `MenuRestaurant.deliveryFeeMode: "neighborhood" | "fixed" | "distance"`, `MenuRestaurant.deliveryNeighborhoods: string[]`.
  - `formatZip(raw: string): string` (`"01304-001"`), `formatMoneyInput(raw: string): string` (`"R$ 50,00"`), `centsFromMoneyInput(text: string): number | null`.
  - `RememberedAddress = { neighborhood; street; number; complement; zip }`; `RememberedCustomer = { name; phone; address?: RememberedAddress }`; `saveCustomer` mantém o endereço já guardado quando o novo não traz endereço.
  - `ActiveOrder = { orderId: string; token: string }`; `ACTIVE_ORDER_TTL_MS`; `saveActiveOrder(slug, order, now?)`, `loadActiveOrder(slug, now?): ActiveOrder | null`, `clearActiveOrder(slug)`.

- [ ] **Step 1: Write the failing tests**

Em `apps/menu/test/checkout.test.ts` (import `formatZip, formatMoneyInput, centsFromMoneyInput` junto dos outros):

```ts
  it("máscara do CEP", () => {
    expect(formatZip("")).toBe("");
    expect(formatZip("01304")).toBe("01304");
    expect(formatZip("013040")).toBe("01304-0");
    expect(formatZip("01304001999")).toBe("01304-001");
    expect(formatZip("01304-001")).toBe("01304-001");
  });

  it("valor em reais enquanto digita, e de volta para centavos", () => {
    expect(formatMoneyInput("")).toBe("");
    expect(formatMoneyInput("5")).toBe("R$ 0,05");
    expect(formatMoneyInput("5000")).toBe("R$ 50,00");
    expect(formatMoneyInput("R$ 50,00")).toBe("R$ 50,00");
    expect(centsFromMoneyInput("R$ 50,00")).toBe(5000);
    expect(centsFromMoneyInput("")).toBeNull();
  });
```

Em `apps/menu/test/customer.test.ts`:

```ts
  const ADDRESS = { neighborhood: "Centro", street: "Rua A", number: "10", complement: "apto 2", zip: "01304-001" };

  it("guarda o endereço junto, e um pedido sem endereço não apaga o que havia", () => {
    saveCustomer({ name: "Ana", phone: "(11) 98888-7777", address: ADDRESS }, NOW);
    saveCustomer({ name: "Ana", phone: "(11) 98888-7777" }, NOW + 1000);
    expect(loadCustomer(NOW + 2000)).toEqual({ name: "Ana", phone: "(11) 98888-7777", address: ADDRESS });
  });

  it("endereço adulterado é descartado, sem perder nome e telefone", () => {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify({ name: "Ana", phone: "1", savedAt: NOW, address: { street: 42 } }));
    expect(loadCustomer(NOW)).toEqual({ name: "Ana", phone: "1" });
  });
```

Crie `apps/menu/test/active-order.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACTIVE_ORDER_TTL_MS, clearActiveOrder, loadActiveOrder, saveActiveOrder } from "../src/lib/active-order.ts";

const NOW = Date.parse("2026-09-30T19:00:00Z");
const ORDER = { orderId: "o1", token: "t1" };

// Review Focus 4: o guardado é por loja, vence em 24 h e some ao limpar
describe("pedido em andamento no aparelho", () => {
  it("guarda por loja e devolve só para a mesma loja", () => {
    saveActiveOrder("cantina", ORDER, NOW);
    expect(loadActiveOrder("cantina", NOW + 1000)).toEqual(ORDER);
    expect(loadActiveOrder("outra-loja", NOW + 1000)).toBeNull();
  });

  it("vence em 24 h, e aí sai do aparelho", () => {
    saveActiveOrder("cantina", ORDER, NOW);
    expect(loadActiveOrder("cantina", NOW + ACTIVE_ORDER_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem("order:cantina")).toBeNull();
  });

  it("limpar apaga, e valor adulterado é nada", () => {
    saveActiveOrder("cantina", ORDER, NOW);
    clearActiveOrder("cantina");
    expect(loadActiveOrder("cantina", NOW)).toBeNull();
    localStorage.setItem("order:cantina", '{"orderId":1}');
    expect(loadActiveOrder("cantina", NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/checkout.test.ts test/customer.test.ts test/active-order.test.ts`
Expected: FAIL — funções e arquivo inexistentes; o endereço não é guardado.

- [ ] **Step 3: Tipos e fixtures**

`apps/menu/src/lib/types.ts`:

```ts
export type Address = {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
};
```

e em `MenuRestaurant`:

```ts
  /** O endereço da loja: onde se retira, e de onde saem cidade e UF da entrega. */
  address: Address;
  deliveryFeeMode: "neighborhood" | "fixed" | "distance";
  /** Nomes dos bairros atendidos no modo por bairro; vazia nos outros. */
  deliveryNeighborhoods: string[];
```

`apps/menu/test/fixtures.ts`, em `makeRestaurant`, antes do `...overrides`:

```ts
    address: {
      street: "Rua do Porto",
      number: "120",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01010-000",
    },
    deliveryFeeMode: "fixed",
    deliveryNeighborhoods: [],
```

- [ ] **Step 4: Máscaras em `checkout.ts`**

```ts
/** "01304-001" enquanto digita; teto de 8 dígitos. */
export function formatZip(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * O troco como a pessoa digita: os dígitos são centavos, e a tela mostra
 * "R$ 50,00". Sete dígitos no máximo (R$ 99.999,99) — troco maior é engano.
 */
export function formatMoneyInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 7);
  return digits === "" ? "" : formatCents(Number(digits));
}

export function centsFromMoneyInput(text: string): number | null {
  const digits = text.replace(/\D/g, "");
  return digits === "" ? null : Number(digits);
}
```

(`import { formatCents } from "./money.ts";` no topo, se ainda não houver.)

- [ ] **Step 5: Endereço em `customer.ts`**

```ts
export type RememberedAddress = {
  neighborhood: string;
  street: string;
  number: string;
  complement: string;
  zip: string;
};

export type RememberedCustomer = { name: string; phone: string; address?: RememberedAddress };

function isAddress(value: unknown): value is RememberedAddress {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return ["neighborhood", "street", "number", "complement", "zip"].every((k) => typeof a[k] === "string");
}

/**
 * Pedido de retirada não traz endereço, e isso não é motivo para esquecer o
 * de quem pediu entrega na semana passada: sem endereço novo, fica o antigo.
 */
export function saveCustomer(customer: RememberedCustomer, now = Date.now()): void {
  try {
    const address = customer.address ?? loadCustomer(now)?.address;
    localStorage.setItem(
      CUSTOMER_KEY,
      JSON.stringify({ name: customer.name, phone: customer.phone, ...(address ? { address } : {}), savedAt: now }),
    );
  } catch {
    // sem storage: a pessoa digita de novo no próximo pedido
  }
}
```

e em `loadCustomer`, o retorno:

```ts
    return {
      name: saved.name as string,
      phone: saved.phone as string,
      // endereço adulterado sai sozinho; nome e telefone continuam valendo
      ...(isAddress(saved.address) ? { address: saved.address } : {}),
    };
```

- [ ] **Step 6: `active-order.ts`**

```ts
// apps/menu/src/lib/active-order.ts
/**
 * O pedido em andamento, guardado no aparelho para o link de acompanhamento
 * não se perder se a aba fechar. UM por loja (o mais recente), e só enquanto
 * está em andamento: quem o tira é quem descobre que terminou (a faixa do
 * cardápio e a página de acompanhamento), ou o prazo de 24 h. Nunca vira
 * histórico de pedidos.
 */
export const ACTIVE_ORDER_TTL_MS = 24 * 60 * 60 * 1000;

export type ActiveOrder = { orderId: string; token: string };

const key = (slug: string) => `order:${slug}`;

export function saveActiveOrder(slug: string, order: ActiveOrder, now = Date.now()): void {
  try {
    localStorage.setItem(key(slug), JSON.stringify({ ...order, savedAt: now }));
  } catch {
    // sem storage: o link da tela de enviado continua sendo o caminho
  }
}

export function loadActiveOrder(slug: string, now = Date.now()): ActiveOrder | null {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    const valid =
      typeof saved.orderId === "string" && typeof saved.token === "string" && typeof saved.savedAt === "number";
    if (!valid || now - (saved.savedAt as number) > ACTIVE_ORDER_TTL_MS) {
      clearActiveOrder(slug);
      return null;
    }
    return { orderId: saved.orderId as string, token: saved.token as string };
  } catch {
    return null;
  }
}

export function clearActiveOrder(slug: string): void {
  try {
    localStorage.removeItem(key(slug));
  } catch {
    // sem storage: não havia o que apagar
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu test && (cd apps/menu && pnpm exec tsc --noEmit)`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add apps/menu
git commit -m "feat(menu): ✨ prepara endereço, máscaras e o pedido em andamento no aparelho"
```

### Task 9: A regra do pedido pelo link (app, sem React)

**Files:**
- Create: `apps/menu/src/lib/link-order.ts`
- Modify: `apps/menu/src/lib/api.ts` (`createOrder` para as três modalidades; `OrderReceipt` com frete e token)
- Test: `apps/menu/test/link-order.test.ts`, `apps/menu/test/api.test.ts`

**Interfaces:**
- Consumes: `formatZip`, `formatCents`, `toOrderItems(lines)`, `CartLine`, `MenuRestaurant`, `Address` (Task 8).
- Produces:
  - `Modality = "delivery" | "takeaway"`; `LinkStep = "modality" | "details" | "address" | "payment"`.
  - `linkModalities(r): Modality[]`; `canOrderByLink(r): boolean`; `minimumHint(r, subtotal): string | null`; `deliveryBlock(r, subtotal): string | null`.
  - `linkSteps(available: Modality[], chosen: Modality | null): LinkStep[]`.
  - `linkPayments(accepted: PaymentMethod[], modality: Modality): { method: PaymentMethod; label: string }[]`.
  - `AddressForm = { neighborhood; street; number; complement; zip }`, `EMPTY_ADDRESS`, `addressComplete(a)`, `toQuoteAddress(a, store): Address`, `toOrderAddress(a, store)`.
  - `ChangeChoice = { exact: boolean; cents: number | null }`; `changeError(total, change): string | null`.
  - `LinkOrderDraft`, `buildLinkOrderBody(draft, store): LinkOrderBody`.
  - `NOT_SERVED_MESSAGE = "A loja não entrega neste endereço"`.
  - Em `api.ts`: `LinkOrderBody`, `createOrder(restaurantId, body: DineInOrderBody | LinkOrderBody): Promise<OrderReceipt>`; `createDineInOrder` continua existindo (chama `createOrder`); `OrderReceipt` ganha `type`, `deliveryFeeInCents: number | null` e `trackingToken?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/menu/test/link-order.test.ts
import { describe, expect, it } from "vitest";
import {
  addressComplete,
  buildLinkOrderBody,
  canOrderByLink,
  changeError,
  deliveryBlock,
  EMPTY_ADDRESS,
  linkModalities,
  linkPayments,
  linkSteps,
  minimumHint,
  toQuoteAddress,
} from "../src/lib/link-order.ts";
import { makeRestaurant } from "./fixtures.ts";

const store = makeRestaurant().address;
const ADDRESS = { neighborhood: "Centro", street: "Rua A", number: "10", complement: "apto 2", zip: "01304-001" };

describe("pedido pelo link", () => {
  it("modalidades: só as que a loja aceita; sem nenhuma, só navegar", () => {
    expect(linkModalities(makeRestaurant())).toEqual(["delivery", "takeaway"]);
    expect(linkModalities(makeRestaurant({ isDelivery: false }))).toEqual(["takeaway"]);
    expect(canOrderByLink(makeRestaurant({ isDelivery: false, isTakeaway: false }))).toBe(false);
    expect(canOrderByLink(makeRestaurant({ isOpen: false }))).toBe(false);
    expect(canOrderByLink(makeRestaurant())).toBe(true);
  });

  it("mínimo: aviso no carrinho e bloqueio só da entrega", () => {
    const r = makeRestaurant({ minimumOrderInCents: 3000 });
    expect(minimumHint(r, 2200)).toBe("Para entrega, faltam R$ 8,00 para o pedido mínimo");
    expect(minimumHint(r, 3000)).toBeNull();
    expect(minimumHint(makeRestaurant({ minimumOrderInCents: 3000, isDelivery: false }), 2200)).toBeNull();
    expect(deliveryBlock(r, 2200)).toBe("Pedido mínimo para entrega: R$ 30,00");
    expect(deliveryBlock(r, 3000)).toBeNull();
  });

  it("passos: modalidade só com duas opções; endereço só na entrega", () => {
    expect(linkSteps(["delivery", "takeaway"], null)).toEqual(["modality", "details", "address", "payment"]);
    expect(linkSteps(["delivery", "takeaway"], "takeaway")).toEqual(["modality", "details", "payment"]);
    expect(linkSteps(["takeaway"], null)).toEqual(["details", "payment"]);
    expect(linkSteps(["delivery"], null)).toEqual(["details", "address", "payment"]);
  });

  it("formas de pagamento com o texto de cada modalidade", () => {
    expect(linkPayments(["cash", "card_on_delivery", "pix", "meal_voucher"], "delivery").map((p) => p.label)).toEqual([
      "Dinheiro",
      "Cartão na entrega",
      "Pix",
      "Vale-refeição",
    ]);
    expect(linkPayments(["card_on_delivery", "pix"], "takeaway").map((p) => p.label)).toEqual(["Cartão na retirada", "Pix"]);
  });

  it("endereço completo exige bairro, rua, número e CEP de 8 dígitos; a cotação não leva complemento", () => {
    expect(addressComplete(EMPTY_ADDRESS)).toBe(false);
    expect(addressComplete({ ...ADDRESS, zip: "01304" })).toBe(false);
    expect(addressComplete({ ...ADDRESS, complement: "" })).toBe(true);
    expect(toQuoteAddress(ADDRESS, store)).toEqual({
      street: "Rua A",
      number: "10",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      zipCode: "01304-001",
    });
  });

  // Review Focus 2: o troco é conferido contra o TOTAL com frete
  it("troco menor que o total com frete é recusado", () => {
    expect(changeError(5400, { exact: false, cents: 5000 })).toBe("O troco precisa ser no mínimo R$ 54,00");
    expect(changeError(5400, { exact: false, cents: 5400 })).toBeNull();
    expect(changeError(5400, { exact: true, cents: null })).toBeNull();
    expect(changeError(5400, { exact: false, cents: null })).toBe("Informe o troco ou marque que tem o valor exato");
  });

  it("monta o corpo por modalidade: endereço só na entrega, troco só no dinheiro, frete nunca", () => {
    const lines = [{ key: "k", productId: "p1", name: "X", unitPriceInCents: 1000, quantity: 2, options: [], note: null }];
    const base = { name: " Ana ", phone: "(11) 98888-7777", lines };
    expect(
      buildLinkOrderBody({ ...base, modality: "delivery", payment: "cash", change: { exact: false, cents: 5000 }, address: ADDRESS }, store),
    ).toEqual({
      type: "delivery",
      customer: { name: "Ana", phone: "(11) 98888-7777" },
      items: [{ productId: "p1", quantity: 2 }],
      paymentMethod: "cash",
      changeForInCents: 5000,
      deliveryAddress: { ...toQuoteAddress(ADDRESS, store), complement: "apto 2" },
    });
    expect(
      buildLinkOrderBody({ ...base, modality: "takeaway", payment: "pix", change: { exact: false, cents: 5000 }, address: ADDRESS }, store),
    ).toEqual({
      type: "takeaway",
      customer: { name: "Ana", phone: "(11) 98888-7777" },
      items: [{ productId: "p1", quantity: 2 }],
      paymentMethod: "pix",
    });
  });
});
```

Em `apps/menu/test/api.test.ts`:

```ts
  it("createOrder devolve frete e token do servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ id: "o1", number: 7, type: "delivery", totalInCents: 5400, deliveryFeeInCents: 900, table: null, items: [], trackingToken: "tk" }, 201),
      ),
    );
    const receipt = await createOrder("r1", {
      type: "takeaway",
      customer: { name: "Ana", phone: "1" },
      items: [],
      paymentMethod: "pix",
    });
    expect(receipt).toMatchObject({ type: "delivery", deliveryFeeInCents: 900, trackingToken: "tk" });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/link-order.test.ts test/api.test.ts`
Expected: FAIL — `link-order.ts` e `createOrder` não existem.

- [ ] **Step 3: Implement `link-order.ts`**

```ts
// apps/menu/src/lib/link-order.ts
import type { LinkOrderBody } from "./api.ts";
import { type CartLine, toOrderItems } from "./cart.ts";
import { formatZip } from "./checkout.ts";
import { formatCents } from "./money.ts";
import type { Address, MenuRestaurant, PaymentMethod } from "./types.ts";

/**
 * O pedido pelo link (sem `?mesa=`): entrega ou retirada. Regra pura — as
 * telas do finalizar só leem daqui.
 */
export type Modality = "delivery" | "takeaway";
export type LinkStep = "modality" | "details" | "address" | "payment";

/** A mensagem exata da API quando a cotação da criação recusa o endereço. */
export const NOT_SERVED_MESSAGE = "A loja não entrega neste endereço";

export function linkModalities(r: Pick<MenuRestaurant, "isDelivery" | "isTakeaway">): Modality[] {
  return [...(r.isDelivery ? ["delivery" as const] : []), ...(r.isTakeaway ? ["takeaway" as const] : [])];
}

/** Aberta (grade e pausa) e com ao menos uma das duas modalidades do link. */
export function canOrderByLink(r: Pick<MenuRestaurant, "isOpen" | "isDelivery" | "isTakeaway">): boolean {
  return r.isOpen && linkModalities(r).length > 0;
}

/** O aviso do carrinho: o mínimo vale só na entrega, então não trava nada aqui. */
export function minimumHint(r: Pick<MenuRestaurant, "isDelivery" | "minimumOrderInCents">, subtotal: number): string | null {
  if (!r.isDelivery || r.minimumOrderInCents <= 0 || subtotal >= r.minimumOrderInCents) return null;
  return `Para entrega, faltam ${formatCents(r.minimumOrderInCents - subtotal)} para o pedido mínimo`;
}

/** Por que a opção "Entrega" está desabilitada, ou `null`. */
export function deliveryBlock(r: Pick<MenuRestaurant, "minimumOrderInCents">, subtotal: number): string | null {
  return subtotal < r.minimumOrderInCents ? `Pedido mínimo para entrega: ${formatCents(r.minimumOrderInCents)}` : null;
}

/**
 * Os passos do finalizar. Modalidade só aparece quando há escolha; endereço,
 * só na entrega. Antes da escolha, conta o endereço se a entrega existe — o
 * "Passo X de Y" mostra o caminho mais longo e encolhe ao escolher retirada.
 */
export function linkSteps(available: Modality[], chosen: Modality | null): LinkStep[] {
  const modality = chosen ?? (available.includes("delivery") ? "delivery" : available[0] ?? null);
  return [
    ...(available.length > 1 ? (["modality"] as const) : []),
    "details",
    ...(modality === "delivery" ? (["address"] as const) : []),
    "payment",
  ];
}

const PAYMENT_ORDER: readonly PaymentMethod[] = ["cash", "card_on_delivery", "pix", "meal_voucher"];
const PAYMENT_LABELS: Record<Modality, Record<PaymentMethod, string>> = {
  delivery: { cash: "Dinheiro", card_on_delivery: "Cartão na entrega", pix: "Pix", meal_voucher: "Vale-refeição" },
  takeaway: { cash: "Dinheiro", card_on_delivery: "Cartão na retirada", pix: "Pix", meal_voucher: "Vale-refeição" },
};

export function linkPayments(accepted: PaymentMethod[], modality: Modality) {
  return PAYMENT_ORDER.filter((m) => accepted.includes(m)).map((method) => ({
    method,
    label: PAYMENT_LABELS[modality][method],
  }));
}

export type AddressForm = { neighborhood: string; street: string; number: string; complement: string; zip: string };
export const EMPTY_ADDRESS: AddressForm = { neighborhood: "", street: "", number: "", complement: "", zip: "" };

export function addressComplete(a: AddressForm): boolean {
  return (
    a.neighborhood.trim() !== "" &&
    a.street.trim() !== "" &&
    a.number.trim() !== "" &&
    a.zip.replace(/\D/g, "").length === 8
  );
}

/**
 * O endereço para a COTAÇÃO: o value object da API, sem complemento (a
 * cotação o recusaria). Cidade e UF vêm da loja — a entrega é local.
 */
export function toQuoteAddress(a: AddressForm, store: Address): Address {
  return {
    street: a.street.trim(),
    number: a.number.trim(),
    neighborhood: a.neighborhood.trim(),
    city: store.city,
    state: store.state,
    zipCode: formatZip(a.zip),
  };
}

/** O endereço do PEDIDO: o da cotação mais o complemento, quando há. */
export function toOrderAddress(a: AddressForm, store: Address): Address & { complement?: string } {
  const complement = a.complement.trim();
  return { ...toQuoteAddress(a, store), ...(complement === "" ? {} : { complement }) };
}

export type ChangeChoice = { exact: boolean; cents: number | null };

/** O troco é conferido contra o TOTAL — itens mais frete. */
export function changeError(total: number, change: ChangeChoice): string | null {
  if (change.exact) return null;
  if (change.cents === null) return "Informe o troco ou marque que tem o valor exato";
  return change.cents < total ? `O troco precisa ser no mínimo ${formatCents(total)}` : null;
}

export type LinkOrderDraft = {
  modality: Modality;
  name: string;
  phone: string;
  payment: PaymentMethod;
  change: ChangeChoice;
  address: AddressForm;
  lines: CartLine[];
};

/** O corpo do POST. O frete nunca vai: a API recalcula a cotação do zero. */
export function buildLinkOrderBody(d: LinkOrderDraft, store: Address): LinkOrderBody {
  return {
    type: d.modality,
    customer: { name: d.name.trim(), phone: d.phone },
    items: toOrderItems(d.lines),
    paymentMethod: d.payment,
    ...(d.payment === "cash" && !d.change.exact && d.change.cents !== null ? { changeForInCents: d.change.cents } : {}),
    ...(d.modality === "delivery" ? { deliveryAddress: toOrderAddress(d.address, store) } : {}),
  };
}
```

- [ ] **Step 4: Generalize `api.ts`**

Acrescente em `apps/menu/src/lib/api.ts`:

```ts
export type LinkOrderBody = {
  type: "delivery" | "takeaway";
  customer: { name: string; phone: string };
  items: OrderItemBody[];
  paymentMethod: PaymentMethod;
  changeForInCents?: number;
  deliveryAddress?: Address & { complement?: string };
};
```

`OrderReceipt` ganha:

```ts
  type: "dine_in" | "takeaway" | "delivery";
  /** `null` fora da entrega e no "a combinar"; `0` = grátis. */
  deliveryFeeInCents: number | null;
  /** Só em entrega e retirada: a credencial do acompanhamento (S27). */
  trackingToken?: string;
```

Renomeie a função `createDineInOrder` para `createOrder(restaurantId: string, body: DineInOrderBody | LinkOrderBody)` e, no `return`, leia também:

```ts
    type: payload?.type ?? body.type,
    deliveryFeeInCents: payload?.deliveryFeeInCents ?? null,
    ...(payload?.trackingToken ? { trackingToken: payload.trackingToken } : {}),
```

e mantenha, logo abaixo, o nome antigo que o finalizar do salão usa:

```ts
export const createDineInOrder = (restaurantId: string, body: DineInOrderBody) => createOrder(restaurantId, body);
```

(`import type { Address, PaymentMethod } from "./types.ts";` — `PaymentMethod` já pode estar importado.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu test && (cd apps/menu && pnpm exec tsc --noEmit)`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona a regra do pedido de entrega e retirada"
```

### Task 10: Cotação de frete no app

**Files:**
- Create: `apps/menu/src/lib/quote.ts`
- Test: `apps/menu/test/quote.test.ts`

**Interfaces:**
- Consumes: `API_URL` de `api.ts`; `Address`.
- Produces:
  - `Quote = { kind: "idle" } | { kind: "loading" } | { kind: "fee"; cents: number } | { kind: "free" } | { kind: "arrange" } | { kind: "none" } | { kind: "error" }`.
  - `fetchQuote(slug, address: Address, subtotalInCents): Promise<Quote>` (nunca lança).
  - `quoteFee(q): number | null` (centavos a somar; `0` no grátis; `null` sem valor).
  - `quoteText(q): string | null`; `quoteBlocksAdvance(q): string | null`.
  - `latestOnly(): <T>(p: Promise<T>) => Promise<{ current: true; value: T } | { current: false }>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/menu/test/quote.test.ts
import { describe, expect, it, vi } from "vitest";
import { fetchQuote, latestOnly, quoteBlocksAdvance, quoteFee, quoteText } from "../src/lib/quote.ts";

const ADDRESS = { street: "Rua A", number: "10", neighborhood: "Centro", city: "São Paulo", state: "SP", zipCode: "01304-001" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("cotação de frete", () => {
  it("traduz a resposta da API nos quatro estados do handoff", async () => {
    const answers = [
      { deliversTo: true, feeInCents: 900, isFree: false, toArrange: false },
      { deliversTo: true, feeInCents: 0, isFree: true, toArrange: false },
      { deliversTo: true, feeInCents: null, isFree: false, toArrange: true },
      { deliversTo: false, feeInCents: null, isFree: false, toArrange: false },
    ];
    const kinds = [];
    for (const answer of answers) {
      vi.stubGlobal("fetch", vi.fn(async () => json({ ...answer, servedNeighborhoods: [] })));
      kinds.push(await fetchQuote("cantina", ADDRESS, 3000));
    }
    expect(kinds).toEqual([{ kind: "fee", cents: 900 }, { kind: "free" }, { kind: "arrange" }, { kind: "none" }]);
  });

  it("rede, 5xx e 429 viram erro, nunca exceção", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    expect(await fetchQuote("cantina", ADDRESS, 3000)).toEqual({ kind: "error" });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    expect(await fetchQuote("cantina", ADDRESS, 3000)).toEqual({ kind: "error" });
  });

  it("textos e bloqueios de cada estado", () => {
    expect(quoteText({ kind: "fee", cents: 900 })).toBe("Entrega: R$ 9,00");
    expect(quoteText({ kind: "free" })).toBe("Entrega grátis neste pedido");
    expect(quoteText({ kind: "arrange" })).toBe("A loja combina a entrega com você");
    expect(quoteText({ kind: "none" })).toBe("Esta loja não entrega no seu bairro");
    expect(quoteFee({ kind: "fee", cents: 900 })).toBe(900);
    expect(quoteFee({ kind: "free" })).toBe(0);
    expect(quoteFee({ kind: "arrange" })).toBeNull();
    expect(quoteBlocksAdvance({ kind: "loading" })).toBe("Calculando a entrega…");
    expect(quoteBlocksAdvance({ kind: "error" })).toBe("Tente calcular a entrega de novo");
    expect(quoteBlocksAdvance({ kind: "none" })).toBe("Esta loja não entrega no seu bairro");
    expect(quoteBlocksAdvance({ kind: "idle" })).toBe("Preencha o endereço");
    expect(quoteBlocksAdvance({ kind: "arrange" })).toBeNull();
  });

  // Review Focus 1: a cotação velha que chega depois não sobrescreve a nova
  it("só a última cotação pedida vale", async () => {
    const latest = latestOnly();
    let releaseOld!: (q: string) => void;
    const old = latest(new Promise<string>((resolve) => (releaseOld = resolve)));
    const fresh = latest(Promise.resolve("nova"));
    releaseOld("velha");
    expect(await fresh).toEqual({ current: true, value: "nova" });
    expect(await old).toEqual({ current: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/quote.test.ts`
Expected: FAIL — `quote.ts` não existe.

- [ ] **Step 3: Implement `quote.ts`**

```ts
// apps/menu/src/lib/quote.ts
import { API_URL } from "./api.ts";
import { formatCents } from "./money.ts";
import type { Address } from "./types.ts";

/**
 * A cotação informa; a criação decide (a API recalcula no POST). Por isso
 * erro de cotação não é exceção: é um estado que a tela mostra com "Tentar de
 * novo".
 */
export type Quote =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "fee"; cents: number }
  | { kind: "free" }
  | { kind: "arrange" }
  | { kind: "none" }
  | { kind: "error" };

export async function fetchQuote(slug: string, address: Address, subtotalInCents: number): Promise<Quote> {
  try {
    const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}/delivery-quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, subtotalInCents }),
    });
    if (!res.ok) return { kind: "error" };
    const q = (await res.json()) as { deliversTo: boolean; feeInCents: number | null; isFree: boolean; toArrange: boolean };
    if (!q.deliversTo) return { kind: "none" };
    if (q.toArrange) return { kind: "arrange" };
    if (q.isFree) return { kind: "free" };
    return typeof q.feeInCents === "number" ? { kind: "fee", cents: q.feeInCents } : { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

/** O que somar ao total: o frete, `0` no grátis, `null` quando não há valor. */
export function quoteFee(q: Quote): number | null {
  if (q.kind === "fee") return q.cents;
  if (q.kind === "free") return 0;
  return null;
}

export function quoteText(q: Quote): string | null {
  switch (q.kind) {
    case "fee":
      return `Entrega: ${formatCents(q.cents)}`;
    case "free":
      return "Entrega grátis neste pedido";
    case "arrange":
      return "A loja combina a entrega com você";
    case "none":
      return "Esta loja não entrega no seu bairro";
    default:
      return null;
  }
}

/** Por que o passo do endereço não avança, ou `null`. */
export function quoteBlocksAdvance(q: Quote): string | null {
  switch (q.kind) {
    case "idle":
      return "Preencha o endereço";
    case "loading":
      return "Calculando a entrega…";
    case "error":
      return "Tente calcular a entrega de novo";
    case "none":
      return "Esta loja não entrega no seu bairro";
    default:
      return null;
  }
}

/**
 * Só a última promessa entregue vale. Trocar o bairro com uma cotação ainda no
 * ar dispara outra; se a velha chegar depois, ela não pode sobrescrever o
 * frete da nova.
 */
export function latestOnly() {
  let last = 0;
  return <T>(promise: Promise<T>): Promise<{ current: true; value: T } | { current: false }> => {
    const id = ++last;
    return promise.then((value) => (id === last ? { current: true as const, value } : { current: false as const }));
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/quote.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm lint && (cd apps/menu && pnpm exec tsc --noEmit)`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ cota o frete da entrega no app"
```

### Task 11: O finalizar em passos (app)

**Files:**
- Create: `apps/menu/src/components/checkout/ChoiceList.tsx` (lista de escolha única, visual do pagamento do salão)
- Create: `apps/menu/src/components/checkout/AddressStep.tsx`
- Create: `apps/menu/src/components/checkout/PaymentStep.tsx`
- Create: `apps/menu/src/components/LinkCheckout.tsx`
- Test: `apps/menu/test/link-checkout.test.tsx`

**Interfaces:**
- Consumes: Tasks 8–10 (`link-order.ts`, `quote.ts`, `customer.ts`, `active-order.ts`, `createOrder`, `formatPhone`, `formatZip`, `formatMoneyInput`, `centsFromMoneyInput`); `ScreenHeader`; `FIELD_BOX`/`FIELD_FOCUS`/`FIELD_TEXT`.
- Produces:
  - `LinkSent = { receipt: OrderReceipt; modality: Modality }`.
  - `LinkCheckout({ restaurant, lines, step, onStep, onBack, onSent })` — `step` é o índice do passo (quem guarda é o `MenuApp`, que o põe no histórico na Task 12); `onStep(n)` pede para ir ao passo `n`; `onSent(sent)` depois de o pedido entrar. Ao dar certo, o próprio `LinkCheckout` grava o lembrado (`saveCustomer`) e o pedido em andamento (`saveActiveOrder`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/menu/test/link-checkout.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { type LinkSent, LinkCheckout } from "../src/components/LinkCheckout.tsx";
import type { CartLine } from "../src/lib/cart.ts";
import type { MenuRestaurant } from "../src/lib/types.ts";
import { makeRestaurant } from "./fixtures.ts";

const LINES: CartLine[] = [
  { key: "p-marg|note:", productId: "p-marg", name: "Margherita", unitPriceInCents: 5200, quantity: 1, options: [], note: null },
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const RECEIPT = {
  id: "o1",
  number: 42,
  type: "delivery",
  totalInCents: 6100,
  deliveryFeeInCents: 900,
  table: null,
  items: [{ name: "Margherita", quantity: 1, unitPriceInCents: 5200, note: null }],
  trackingToken: "tk-1",
};

/** Rotas falsas da API: cotação e criação, cada uma com a resposta dada. */
function api({ quote = { deliversTo: true, feeInCents: 900, isFree: false, toArrange: false }, order = json(RECEIPT, 201) }: {
  quote?: unknown;
  order?: Response;
} = {}) {
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/delivery-quote") ? json({ ...(quote as object), servedNeighborhoods: [] }) : order.clone(),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Harness({ restaurant = makeRestaurant(), onSent = () => {} }: { restaurant?: MenuRestaurant; onSent?: (s: LinkSent) => void }) {
  const [step, setStep] = useState(0);
  return (
    <LinkCheckout
      restaurant={restaurant}
      lines={LINES}
      step={step}
      onStep={setStep}
      onBack={() => setStep((s) => Math.max(0, s - 1))}
      onSent={onSent}
    />
  );
}

const cta = () => screen.getAllByRole("button").at(-1) as HTMLButtonElement;

function fillDetails() {
  fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11988887777" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

function fillAddress() {
  fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "Centro" } });
  fireEvent.change(screen.getByLabelText("Rua"), { target: { value: "Rua A" } });
  fireEvent.change(screen.getByLabelText("Número"), { target: { value: "10" } });
  fireEvent.change(screen.getByLabelText("Complemento"), { target: { value: "apto 2" } });
  fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "01304001" } });
}

describe("finalizar pelo link", () => {
  it("entrega de ponta a ponta: cotação, troco contra o total com frete, envio e o que fica no aparelho", async () => {
    const fetchMock = api();
    const onSent = vi.fn();
    render(<Harness onSent={onSent} />);

    expect(screen.getByText("Passo 1 de 4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    expect(await screen.findByText("Entrega: R$ 9,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    fireEvent.click(screen.getByRole("radio", { name: "Dinheiro" }));
    fireEvent.change(screen.getByLabelText("Troco para quanto?"), { target: { value: "5000" } });
    expect(screen.getByText("O troco precisa ser no mínimo R$ 61,00")).toBeTruthy();
    expect(cta().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Troco para quanto?"), { target: { value: "10000" } });
    expect(screen.getByText("R$ 61,00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));

    await waitFor(() => expect(onSent).toHaveBeenCalledOnce());
    const post = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.endsWith("/orders"));
    expect(JSON.parse(post?.[1].body as string)).toMatchObject({
      type: "delivery",
      paymentMethod: "cash",
      changeForInCents: 10000,
      deliveryAddress: { neighborhood: "Centro", complement: "apto 2", zipCode: "01304-001", city: "São Paulo" },
    });
    expect(JSON.parse(localStorage.getItem("customer") as string).address).toMatchObject({ street: "Rua A", zip: "01304-001" });
    expect(JSON.parse(localStorage.getItem("order:cantina-do-porto") as string)).toMatchObject({ orderId: "o1", token: "tk-1" });
  });

  it("retirada pula o endereço, e o cartão diz 'na retirada'", () => {
    api();
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    expect(screen.getByText("Passo 2 de 3")).toBeTruthy();
    fillDetails();
    expect(screen.getByRole("radio", { name: "Cartão na retirada" })).toBeTruthy();
  });

  it("uma modalidade só: o passo da modalidade some", () => {
    api();
    render(<Harness restaurant={makeRestaurant({ isDelivery: false })} />);
    expect(screen.getByText("Passo 1 de 2")).toBeTruthy();
    expect(screen.getByLabelText("Nome")).toBeTruthy();
  });

  it("abaixo do mínimo, a entrega fica desabilitada com o motivo, e a retirada segue", () => {
    api();
    render(<Harness restaurant={makeRestaurant({ minimumOrderInCents: 6000 })} />);
    expect((screen.getByRole("button", { name: /Entrega/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Pedido mínimo para entrega: R$ 60,00")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Retirada/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("não entrega no bairro: 'Trocar para retirada' leva ao pagamento da retirada", async () => {
    api({ quote: { deliversTo: false, feeInCents: null, isFree: false, toArrange: false } });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    fireEvent.click(await screen.findByRole("button", { name: "Trocar para retirada" }));
    expect(screen.getByRole("radio", { name: "Cartão na retirada" })).toBeTruthy();
  });

  it("no modo por bairro, o bairro é uma lista", () => {
    api();
    render(<Harness restaurant={makeRestaurant({ deliveryFeeMode: "neighborhood", deliveryNeighborhoods: ["Centro", "Jardins"] })} />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    const bairro = screen.getByLabelText("Bairro");
    expect(bairro.tagName).toBe("SELECT");
    expect([...(bairro as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["Selecione o bairro", "Centro", "Jardins"]);
  });

  // Review Focus 5: a loja mudou entre o carrinho e o envio
  it("409 no envio: mostra a mensagem, não chama onSent, e o botão volta", async () => {
    api({ order: json({ message: "A loja está pausada no momento. Tente de novo mais tarde" }, 409) });
    const onSent = vi.fn();
    render(<Harness onSent={onSent} />);
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    fillDetails();
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText("A loja está pausada no momento. Tente de novo mais tarde")).toBeTruthy();
    expect(onSent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Enviar pedido" })).toBeTruthy();
    expect(localStorage.getItem("order:cantina-do-porto")).toBeNull();
  });

  it("'não entrega neste endereço' na criação volta ao passo do endereço", async () => {
    api({ order: json({ message: "A loja não entrega neste endereço" }, 409) });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: /Entrega/ }));
    fillDetails();
    fillAddress();
    await screen.findByText("Entrega: R$ 9,00");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText("A loja não entrega neste endereço")).toBeTruthy();
    expect(screen.getByLabelText("Rua")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/link-checkout.test.tsx`
Expected: FAIL — `LinkCheckout.tsx` não existe.

- [ ] **Step 3: `ChoiceList`**

```tsx
// apps/menu/src/components/checkout/ChoiceList.tsx
/**
 * Escolha única em lista, o mesmo desenho do pagamento do salão: rádio
 * visualmente escondido (o rótulo inteiro é o alvo de toque) e a bolinha
 * desenhada ao lado.
 */
export function ChoiceList<T extends string>({
  label,
  name,
  options,
  value,
  onChange,
}: {
  label: string;
  name: string;
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-3 overflow-hidden rounded-card border border-paper-3">
      {options.map((option) => {
        const on = value === option.value;
        return (
          <label
            key={option.value}
            className={`flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-paper-3 px-4 last:border-b-0 ${on ? "bg-action/5" : ""}`}
          >
            <input type="radio" name={name} className="peer sr-only" checked={on} onChange={() => onChange(option.value)} />
            <span
              aria-hidden="true"
              className={`size-5 flex-none rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-action peer-focus-visible:ring-offset-2 ${
                on ? "border-[6px] border-action" : "border-[1.5px] border-line-control"
              }`}
            />
            <span className={`text-[15px] ${on ? "font-semibold" : ""}`}>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: `AddressStep`**

```tsx
// apps/menu/src/components/checkout/AddressStep.tsx
import { formatZip } from "@/lib/checkout.ts";
import type { AddressForm } from "@/lib/link-order.ts";
import { type Quote, quoteText } from "@/lib/quote.ts";
import { FIELD_BOX, FIELD_FOCUS, FIELD_TEXT } from "../field.ts";

const FIELD = `w-full px-3.5 py-3.5 ${FIELD_BOX} ${FIELD_FOCUS} ${FIELD_TEXT}`;

/**
 * "Onde entregar?". No modo por bairro o bairro é uma lista (os nomes vêm do
 * cardápio público); nos outros, texto livre. Cidade e UF não aparecem: vêm
 * do endereço da loja, porque a entrega é local.
 */
export function AddressStep({
  address,
  neighborhoods,
  quote,
  error,
  canSwitchToTakeaway,
  onChange,
  onRetryQuote,
  onSwitchToTakeaway,
}: {
  address: AddressForm;
  /** Vazia fora do modo por bairro: aí o bairro é texto livre. */
  neighborhoods: string[];
  quote: Quote;
  /** O 409 "não entrega neste endereço" da criação, trazido de volta para cá. */
  error: string | null;
  canSwitchToTakeaway: boolean;
  onChange: (next: AddressForm) => void;
  onRetryQuote: () => void;
  onSwitchToTakeaway: () => void;
}) {
  const set = (field: keyof AddressForm, value: string) => onChange({ ...address, [field]: value });
  const text = quoteText(quote);

  return (
    <section className="flex flex-col gap-4 px-4 py-5">
      <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Onde entregar?</h2>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">Bairro</span>
        {neighborhoods.length > 0 ? (
          <select value={address.neighborhood} onChange={(e) => set("neighborhood", e.currentTarget.value)} className={FIELD}>
            <option value="">Selecione o bairro</option>
            {neighborhoods.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <input value={address.neighborhood} onChange={(e) => set("neighborhood", e.currentTarget.value)} className={FIELD} />
        )}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">Rua</span>
        <input autoComplete="address-line1" value={address.street} onChange={(e) => set("street", e.currentTarget.value)} className={FIELD} />
      </label>
      <div className="grid grid-cols-[1fr_1.4fr] gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">Número</span>
          <input inputMode="numeric" placeholder="000" value={address.number} onChange={(e) => set("number", e.currentTarget.value)} className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">CEP</span>
          <input
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="00000-000"
            value={address.zip}
            onChange={(e) => set("zip", formatZip(e.currentTarget.value))}
            className={FIELD}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-semibold text-ink-2">Complemento</span>
        <input
          placeholder="apto, bloco, referência"
          maxLength={120}
          autoComplete="address-line2"
          value={address.complement}
          onChange={(e) => set("complement", e.currentTarget.value)}
          className={FIELD}
        />
      </label>

      {error && (
        <p role="alert" className="rounded-field border border-danger/30 px-3.5 py-3 text-sm text-danger">
          {error}
        </p>
      )}
      {quote.kind === "loading" && <p className="text-sm text-ink-2">Calculando a entrega…</p>}
      {quote.kind === "error" && (
        <div role="alert" className="rounded-field bg-warn-soft px-3.5 py-3 text-sm text-warn">
          <p>Não deu para calcular a entrega.</p>
          <button type="button" onClick={onRetryQuote} className="mt-1 min-h-11 font-semibold underline">
            Tentar de novo
          </button>
        </div>
      )}
      {text && quote.kind !== "none" && (
        <p role="status" className="rounded-field bg-paper-2 px-3.5 py-3 text-sm font-semibold">
          {text}
        </p>
      )}
      {quote.kind === "none" && (
        <div role="alert" className="rounded-field bg-warn-soft px-3.5 py-3 text-sm text-warn">
          <p className="font-semibold">{text}</p>
          {canSwitchToTakeaway && (
            <button type="button" onClick={onSwitchToTakeaway} className="mt-1 min-h-11 font-semibold text-action">
              Trocar para retirada
            </button>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 5: `PaymentStep`**

```tsx
// apps/menu/src/components/checkout/PaymentStep.tsx
import { centsFromMoneyInput, formatMoneyInput } from "@/lib/checkout.ts";
import { type ChangeChoice, changeError, linkPayments, type Modality } from "@/lib/link-order.ts";
import { formatCents } from "@/lib/money.ts";
import type { PaymentMethod } from "@/lib/types.ts";
import { FIELD_BOX, FIELD_FOCUS, FIELD_TEXT } from "../field.ts";
import { ChoiceList } from "./ChoiceList.tsx";

const FIELD = `w-full px-3.5 py-3.5 ${FIELD_BOX} ${FIELD_FOCUS} ${FIELD_TEXT}`;

/** "Como você paga?", o troco no dinheiro e o resumo com a entrega. */
export function PaymentStep({
  modality,
  accepted,
  payment,
  change,
  changeText,
  itemsCents,
  feeLabel,
  totalCents,
  onPayment,
  onChange,
}: {
  modality: Modality;
  accepted: PaymentMethod[];
  payment: PaymentMethod | null;
  change: ChangeChoice;
  changeText: string;
  itemsCents: number;
  /** "R$ 9,00", "Grátis" ou "A combinar"; `null` fora da entrega. */
  feeLabel: string | null;
  totalCents: number;
  onPayment: (method: PaymentMethod) => void;
  onChange: (change: ChangeChoice, text: string) => void;
}) {
  const problem = payment === "cash" ? changeError(totalCents, change) : null;
  return (
    <>
      <section className="px-4 py-5">
        <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Como você paga?</h2>
        <ChoiceList
          label="Forma de pagamento"
          name="pagamento"
          options={linkPayments(accepted, modality).map((p) => ({ value: p.method, label: p.label }))}
          value={payment}
          onChange={onPayment}
        />
        {payment === "cash" && (
          <div className="mt-4 flex flex-col gap-2.5">
            {!change.exact && (
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-ink-2">Troco para quanto?</span>
                <input
                  inputMode="numeric"
                  placeholder="R$ 0,00"
                  value={changeText}
                  onChange={(e) => {
                    const text = formatMoneyInput(e.currentTarget.value);
                    onChange({ exact: false, cents: centsFromMoneyInput(text) }, text);
                  }}
                  className={FIELD}
                />
              </label>
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
              <input
                type="checkbox"
                className="size-5 accent-[var(--brand-action)]"
                checked={change.exact}
                onChange={(e) => onChange({ exact: e.currentTarget.checked, cents: null }, "")}
              />
              Não preciso de troco, tenho o valor exato
            </label>
            {problem && change.cents !== null && (
              <p role="alert" className="text-sm text-danger">
                {problem}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 rounded-field bg-paper-2 px-3.5 py-3 text-[13px] leading-[1.45] text-ink-2">
          A loja cobra na entrega ou na retirada.
        </p>
      </section>

      <section className="border-t border-paper-3 px-4 py-5">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">Resumo</h2>
        <dl className="mt-2.5 flex flex-col gap-2 text-sm">
          <div className="flex">
            <dt className="text-ink-2">Itens</dt>
            <dd className="ml-auto font-medium tabular-nums">{formatCents(itemsCents)}</dd>
          </div>
          {feeLabel !== null && (
            <div className="flex">
              <dt className="text-ink-2">Entrega</dt>
              <dd className="ml-auto font-medium tabular-nums">{feeLabel}</dd>
            </div>
          )}
          <div className="flex border-t border-paper-3 pt-2.5">
            <dt className="text-sm font-semibold">TOTAL</dt>
            <dd className="ml-auto text-lg font-semibold tabular-nums">{formatCents(totalCents)}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
```

⚠️ O erro de troco só aparece com valor digitado (`change.cents !== null`): sem isso, marcar "Dinheiro" já mostraria erro antes de a pessoa digitar. O botão, porém, trava nos dois casos (o motivo aparece nele).

- [ ] **Step 6: `LinkCheckout`**

```tsx
// apps/menu/src/components/LinkCheckout.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { saveActiveOrder } from "@/lib/active-order.ts";
import { createOrder, OrderError, type OrderReceipt } from "@/lib/api.ts";
import { type CartLine, subtotal } from "@/lib/cart.ts";
import { formatPhone } from "@/lib/checkout.ts";
import { clearCustomer, loadCustomer, saveCustomer } from "@/lib/customer.ts";
import {
  addressComplete,
  buildLinkOrderBody,
  type ChangeChoice,
  changeError,
  deliveryBlock,
  EMPTY_ADDRESS,
  linkModalities,
  linkSteps,
  type Modality,
  NOT_SERVED_MESSAGE,
  toQuoteAddress,
} from "@/lib/link-order.ts";
import { formatCents } from "@/lib/money.ts";
import { fetchQuote, latestOnly, type Quote, quoteBlocksAdvance, quoteFee } from "@/lib/quote.ts";
import type { MenuRestaurant, PaymentMethod } from "@/lib/types.ts";
import { AddressStep } from "./checkout/AddressStep.tsx";
import { PaymentStep } from "./checkout/PaymentStep.tsx";
import { FIELD_BOX, FIELD_FOCUS, FIELD_TEXT } from "./field.ts";
import { ScreenHeader } from "./ScreenHeader.tsx";

const FIELD = `w-full px-3.5 py-3.5 ${FIELD_BOX} ${FIELD_FOCUS} ${FIELD_TEXT}`;

export type LinkSent = { receipt: OrderReceipt; modality: Modality };

/**
 * O finalizar pelo link: modalidade → dados → endereço (só entrega) →
 * pagamento. O ÍNDICE do passo vem de fora (o `MenuApp` o põe no histórico,
 * e o voltar do celular volta um passo); o que a pessoa preenche mora aqui.
 */
export function LinkCheckout({
  restaurant,
  lines,
  step,
  onStep,
  onBack,
  onSent,
}: {
  restaurant: MenuRestaurant;
  lines: CartLine[];
  step: number;
  onStep: (next: number) => void;
  onBack: () => void;
  onSent: (sent: LinkSent) => void;
}) {
  const available = linkModalities(restaurant);
  // o finalizar só existe no navegador: dá para ler o storage no estado inicial
  const [remembered, setRemembered] = useState(() => loadCustomer());
  const [modality, setModality] = useState<Modality | null>(available.length === 1 ? available[0] : null);
  const [name, setName] = useState(remembered?.name ?? "");
  const [phone, setPhone] = useState(remembered?.phone ?? "");
  const [address, setAddress] = useState(remembered?.address ?? EMPTY_ADDRESS);
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [change, setChange] = useState<ChangeChoice>({ exact: false, cents: null });
  const [changeText, setChangeText] = useState("");
  const [quote, setQuote] = useState<Quote>({ kind: "idle" });
  const [quoteRetry, setQuoteRetry] = useState(0);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; staleCart: boolean } | null>(null);
  const [sending, setSending] = useState(false);
  const latest = useRef(latestOnly()).current;

  const steps = linkSteps(available, modality);
  const index = Math.min(step, steps.length - 1);
  const current = steps[index];
  const items = subtotal(lines);
  const fee = modality === "delivery" ? quoteFee(quote) : null;
  const total = items + (fee ?? 0);

  // A cotação roda quando o endereço fica completo e a cada mudança dele; só
  // a última pedida vale (Review Focus 1).
  const quoteKey =
    modality === "delivery" && addressComplete(address) ? JSON.stringify(toQuoteAddress(address, restaurant.address)) : null;
  useEffect(() => {
    if (quoteKey === null) {
      setQuote({ kind: "idle" });
      return;
    }
    setQuote({ kind: "loading" });
    void latest(fetchQuote(restaurant.slug, JSON.parse(quoteKey), items)).then((result) => {
      if (result.current) setQuote(result.value);
    });
  }, [quoteKey, items, quoteRetry, restaurant.slug, latest]);

  const block = (): string | null => {
    switch (current) {
      case "modality":
        return modality === null ? "Escolha entrega ou retirada" : null;
      case "details":
        if (!name.trim()) return "Informe seu nome";
        return phone.replace(/\D/g, "").length < 10 ? "Informe um telefone válido" : null;
      case "address":
        return addressComplete(address) ? quoteBlocksAdvance(quote) : "Preencha o endereço";
      case "payment":
        if (payment === null) return "Escolha a forma de pagamento";
        return payment === "cash" ? changeError(total, change) : null;
    }
  };

  const send = async () => {
    if (modality === null || payment === null) return;
    setSending(true);
    setError(null);
    try {
      const receipt = await createOrder(
        restaurant.id,
        buildLinkOrderBody({ modality, name, phone, payment, change, address, lines }, restaurant.address),
      );
      saveCustomer({ name: name.trim(), phone, ...(modality === "delivery" ? { address } : {}) });
      if (receipt.trackingToken) {
        saveActiveOrder(restaurant.slug, { orderId: receipt.id, token: receipt.trackingToken });
      }
      onSent({ receipt, modality });
    } catch (cause) {
      const failure = cause instanceof OrderError ? cause : new OrderError(0, "Não deu para enviar. Tente de novo.");
      setSending(false);
      if (failure.status === 409 && failure.message === NOT_SERVED_MESSAGE) {
        setAddressError(failure.message);
        onStep(steps.indexOf("address"));
        return;
      }
      setError({
        message: failure.status === 404 ? "Algum item do seu carrinho saiu do cardápio." : failure.message,
        staleCart: failure.status === 400 || failure.status === 404,
      });
    }
  };

  const blocked = block();
  const last = index === steps.length - 1;
  const feeLabel =
    modality !== "delivery"
      ? null
      : quote.kind === "fee"
        ? formatCents(quote.cents)
        : quote.kind === "free"
          ? "Grátis"
          : "A combinar";

  return (
    <main className="pb-36">
      <ScreenHeader title="Finalizar" context={`Passo ${index + 1} de ${steps.length}`} onBack={onBack} />
      <div className="flex gap-1.5 px-4 pt-3" aria-hidden="true">
        {steps.map((s, i) => (
          <span key={s} className={`h-1 flex-1 rounded-full ${i <= index ? "bg-action" : "bg-paper-3"}`} />
        ))}
      </div>

      {current === "modality" && (
        <section className="flex flex-col gap-3 px-4 py-5">
          <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Como você quer receber?</h2>
          {available.includes("delivery") && (
            <ModalityButton
              title="Entrega"
              detail="Chega no seu endereço"
              blocked={deliveryBlock(restaurant, items)}
              onPick={() => {
                setModality("delivery");
                onStep(index + 1);
              }}
            />
          )}
          {available.includes("takeaway") && (
            <ModalityButton
              title="Retirada"
              detail={`Você busca na loja · ${restaurant.address.street}, ${restaurant.address.number}`}
              blocked={null}
              onPick={() => {
                setModality("takeaway");
                onStep(index + 1);
              }}
            />
          )}
        </section>
      )}

      {current === "details" && (
        <section className="flex flex-col gap-4 px-4 py-5">
          <div>
            <h2 className="text-[19px] font-semibold tracking-[-0.02em]">Quem está pedindo?</h2>
            <p className="mt-1 text-[13px] leading-[1.45] text-ink-2">Sem cadastro. Só o nome e o telefone para a loja te achar.</p>
          </div>
          {remembered && (
            <button
              type="button"
              onClick={() => {
                clearCustomer();
                setRemembered(null);
                setName("");
                setPhone("");
                setAddress(EMPTY_ADDRESS);
              }}
              className="-my-1.5 min-h-11 self-start text-[13px] font-semibold text-action"
            >
              Não é você? Limpar dados
            </button>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">Nome</span>
            <input autoComplete="name" placeholder="Seu nome" value={name} onChange={(e) => setName(e.currentTarget.value)} className={FIELD} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold text-ink-2">Telefone</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(11) 90000-0000"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.currentTarget.value))}
              className={FIELD}
            />
          </label>
        </section>
      )}

      {current === "address" && (
        <AddressStep
          address={address}
          neighborhoods={restaurant.deliveryFeeMode === "neighborhood" ? restaurant.deliveryNeighborhoods : []}
          quote={quote}
          error={addressError}
          canSwitchToTakeaway={available.includes("takeaway")}
          onChange={(next) => {
            setAddressError(null);
            setAddress(next);
          }}
          onRetryQuote={() => setQuoteRetry((n) => n + 1)}
          onSwitchToTakeaway={() => {
            setModality("takeaway");
            onStep(linkSteps(available, "takeaway").indexOf("payment"));
          }}
        />
      )}

      {current === "payment" && modality !== null && (
        <PaymentStep
          modality={modality}
          accepted={restaurant.paymentMethods}
          payment={payment}
          change={change}
          changeText={changeText}
          itemsCents={items}
          feeLabel={feeLabel}
          totalCents={total}
          onPayment={setPayment}
          onChange={(next, text) => {
            setChange(next);
            setChangeText(text);
          }}
        />
      )}

      {error && (
        <div role="alert" className="mx-4 rounded-field border border-danger/30 px-3.5 py-3 text-sm text-danger">
          <p>{error.message}</p>
          {error.staleCart && (
            <button type="button" onClick={() => window.location.reload()} className="mt-2 min-h-11 font-semibold underline">
              Atualizar o cardápio
            </button>
          )}
        </div>
      )}

      {current !== "modality" && (
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[480px] border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
          {blocked ? (
            <button type="button" disabled className="min-h-[52px] w-full rounded-field bg-paper-muted text-[15px] font-semibold text-ink-2">
              {blocked}
            </button>
          ) : (
            <button
              type="button"
              disabled={sending}
              onClick={() => (last ? void send() : onStep(index + 1))}
              className="min-h-[52px] w-full rounded-field bg-action text-base font-semibold text-white disabled:opacity-70"
            >
              {sending ? "Enviando…" : last ? "Enviar pedido" : "Continuar"}
            </button>
          )}
        </div>
      )}
    </main>
  );
}

function ModalityButton({
  title,
  detail,
  blocked,
  onPick,
}: {
  title: string;
  detail: string;
  blocked: string | null;
  onPick: () => void;
}) {
  return (
    <div>
      <button
        type="button"
        disabled={blocked !== null}
        onClick={onPick}
        className="flex min-h-16 w-full flex-col items-start gap-0.5 rounded-card border border-line-strong px-4 py-3.5 text-left hover:border-action disabled:opacity-50"
      >
        <span className="text-base font-semibold">{title}</span>
        <span className="text-[13px] text-ink-2">{detail}</span>
      </button>
      {blocked && <p className="mt-1.5 text-[13px] text-warn">{blocked}</p>}
    </div>
  );
}
```

⚠️ No teste, o botão final é achado por `getAllByRole("button").at(-1)`: a barra fixa é o último botão da tela. Se a ordem mudar, troque por um `data-testid` no botão da barra.

- [ ] **Step 7: Run it to verify it passes**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/link-checkout.test.tsx`
Expected: PASS (8 tests).

Mutação obrigatória: troque o `if (result.current)` do efeito da cotação por `if (true)` — nenhum teste deste arquivo cobre a ordem (o de `quote.test.ts` cobre); confira que `quote.test.ts` continua sendo a rede e desfaça. Troque também `changeError(total, change)` por `changeError(items, change)` e confirme que o primeiro teste cai (o troco de R$ 50 contra R$ 61 passaria); desfaça.

- [ ] **Step 8: Suíte e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu test && pnpm lint && (cd apps/menu && pnpm exec tsc --noEmit)`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona o finalizar em passos da entrega e da retirada"
```

### Task 12: Pedido pelo link no cardápio, no carrinho e no enviado (app)

**Files:**
- Modify: `apps/menu/src/lib/active-order.ts` (`trackingPath`)
- Modify: `apps/menu/src/components/MenuApp.tsx` (modo link, passos no histórico, `LinkCheckout`, enviado)
- Modify: `apps/menu/src/components/StoreNotice.tsx` (aviso de loja sem entrega nem retirada)
- Modify: `apps/menu/src/components/CartScreen.tsx` (rótulo "Itens" e aviso de mínimo)
- Modify: `apps/menu/src/components/SentScreen.tsx` (título, texto, frete e link por modalidade)
- Test: `apps/menu/test/link-flow.test.tsx`

**Interfaces:**
- Consumes: `LinkCheckout`, `LinkSent` (Task 11); `canOrderByLink`, `linkModalities`, `minimumHint` (Task 9); `OrderReceipt.type/deliveryFeeInCents/trackingToken` (Task 9).
- Produces: `trackingPath(slug, orderId, token): string` = `/<slug>/pedido/<orderId>?t=<token>` (a rota da Task 14); `HistoryState.step`; `SentScreen({ receipt, expectedTotal, slug, onRestart })` decide o texto pela modalidade do `receipt`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/menu/test/link-flow.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuApp } from "../src/components/MenuApp.tsx";
import { saveCart } from "../src/lib/cart.ts";
import { makeMenu } from "./fixtures.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function cartLink(unitPriceInCents = 5200) {
  saveCart("cart:cantina-do-porto:link", [
    { key: "p-marg|note:", productId: "p-marg", name: "Margherita", unitPriceInCents, quantity: 1, options: [], note: null },
  ]);
}

const RECEIPT = {
  id: "o1",
  number: 42,
  type: "takeaway",
  totalInCents: 5200,
  deliveryFeeInCents: null,
  table: null,
  items: [{ name: "Margherita", quantity: 1, unitPriceInCents: 5200, note: null }],
  trackingToken: "tk-1",
};

describe("pedido pelo link", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("o carrinho do link diz 'Itens', avisa o mínimo e não trava", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    cartLink();
    render(<MenuApp menu={makeMenu({ minimumOrderInCents: 6000 })} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    expect(screen.getByText("Itens")).toBeTruthy();
    expect(screen.getByText("Entrega ou retirada")).toBeTruthy();
    expect(screen.getByText("Para entrega, faltam R$ 8,00 para o pedido mínimo")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Finalizar pedido" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sem entrega nem retirada: só navega, e diz por quê", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    cartLink();
    render(<MenuApp menu={makeMenu({ isDelivery: false, isTakeaway: false })} />);
    expect(await screen.findByText("Esta loja não está recebendo pedidos pelo app agora.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Ver carrinho/ })).toBeNull();
  });

  it("retirada até o enviado, com o link de acompanhamento", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => (init?.method === "POST" ? json(RECEIPT, 201) : json({}, 404))),
    );
    cartLink();
    render(<MenuApp menu={makeMenu()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    fireEvent.change(screen.getByLabelText("Nome"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Telefone"), { target: { value: "11988887777" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("radio", { name: "Pix" }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar pedido" }));

    expect(await screen.findByRole("heading", { name: "Pedido enviado" })).toBeTruthy();
    expect(screen.getByText("A loja vai confirmar e avisar quando estiver pronto para retirada.")).toBeTruthy();
    expect(screen.getByText("Guarde este link — ele não se recupera")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Acompanhar pedido" }).getAttribute("href")).toBe(
      "/cantina-do-porto/pedido/o1?t=tk-1",
    );
    expect(localStorage.getItem("cart:cantina-do-porto:link")).toBeNull();
  });

  it("o voltar do celular volta um passo do finalizar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    cartLink();
    render(<MenuApp menu={makeMenu()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    fireEvent.click(screen.getByRole("button", { name: /Retirada/ }));
    expect(screen.getByText("Passo 2 de 3")).toBeTruthy();
    window.history.back();
    expect(await screen.findByText("Como você quer receber?")).toBeTruthy();
  });

  it("a loja desliga a entrega depois do cache: só a retirada aparece", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ isOpen: true, acceptingOrders: true, isQrcode: true, isDelivery: false, isTakeaway: true })),
    );
    cartLink();
    render(<MenuApp menu={makeMenu()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Ver carrinho/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Ver carrinho/ }));
    fireEvent.click(screen.getByRole("button", { name: "Finalizar pedido" }));
    await waitFor(() => expect(screen.getByLabelText("Nome")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Entrega/ })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/link-flow.test.tsx`
Expected: FAIL — o link não monta pedido hoje (sem barra "Ver carrinho").

- [ ] **Step 3: `trackingPath`**

Em `apps/menu/src/lib/active-order.ts`:

```ts
/** O caminho do acompanhamento. O token vai na querystring: é a credencial (S27). */
export function trackingPath(slug: string, orderId: string, token: string): string {
  return `/${encodeURIComponent(slug)}/pedido/${encodeURIComponent(orderId)}?t=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: `StoreNotice` e `CartScreen`**

`StoreNotice` ganha a prop `linkOff?: boolean` e, logo depois do aviso `dineInOff`:

```tsx
      {linkOff && !paused && (
        <p role="status" className="mx-4 mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          Esta loja não está recebendo pedidos pelo app agora.
        </p>
      )}
```

`CartScreen` ganha as props:

```tsx
  /** "Total" no salão (sem frete); "Itens" no link (o frete vem no finalizar). */
  totalLabel?: "Total" | "Itens";
  /** O aviso de pedido mínimo da entrega; não trava o botão. */
  hint?: string | null;
```

(com defaults `totalLabel = "Total"`, `hint = null`), o comentário do resumo passa a dizer "No salão o valor já é o total; pelo link, o frete entra no finalizar", o `<dt>` usa `{totalLabel}`, e logo depois do `<dl>`:

```tsx
      {hint && <p className="mx-4 mt-2 text-[13px] text-warn">{hint}</p>}
```

- [ ] **Step 5: `SentScreen` por modalidade**

Troque o conteúdo de `apps/menu/src/components/SentScreen.tsx` por:

```tsx
"use client";

import { useState } from "react";
import { trackingPath } from "@/lib/active-order.ts";
import type { OrderReceipt } from "@/lib/api.ts";
import { formatCents } from "@/lib/money.ts";
import { CheckIcon } from "./icons.tsx";

const BODY = {
  takeaway: "A loja vai confirmar e avisar quando estiver pronto para retirada.",
  delivery: "A loja vai confirmar o pedido e você acompanha a entrega por aqui.",
} as const;

/**
 * O fim do pedido. No salão não há acompanhamento (a mesa não recebe token);
 * pelo link, o comprovante traz o link — que "não se recupera" fora do
 * aparelho, e por isso pode ser copiado. Tudo sai do que a loja GRAVOU.
 */
export function SentScreen({
  receipt,
  expectedTotal,
  slug,
  onRestart,
}: {
  receipt: OrderReceipt;
  /** O total que o aparelho mostrou antes de enviar. */
  expectedTotal: number;
  slug: string;
  onRestart: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const dineIn = receipt.type === "dine_in";
  const path = receipt.trackingToken ? trackingPath(slug, receipt.id, receipt.trackingToken) : null;
  const fee =
    receipt.type !== "delivery"
      ? null
      : receipt.deliveryFeeInCents === null
        ? "A combinar"
        : receipt.deliveryFeeInCents === 0
          ? "Grátis"
          : formatCents(receipt.deliveryFeeInCents);

  return (
    <main className="flex min-h-dvh flex-col px-5 pb-40 pt-12">
      <span className="sent-badge relative flex size-[60px] items-center justify-center rounded-full bg-success-soft text-success" aria-hidden="true">
        <CheckIcon size={30} />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em]">
        {dineIn ? "Pedido enviado para a cozinha" : "Pedido enviado"}
      </h1>
      <p className="mt-2.5 text-[15px] leading-normal text-ink-2">
        {dineIn
          ? receipt.table
            ? `É só aguardar na ${receipt.table.label}. A comida chega até você.`
            : "É só aguardar. Avise o garçom em qual mesa você está."
          : BODY[receipt.type as keyof typeof BODY]}
      </p>

      <div className="mt-6 flex flex-col gap-2.5 rounded-card border border-paper-3 p-4">
        {receipt.items.map((item, index) => (
          <div key={index} className="flex gap-2 text-sm">
            <span className="tabular-nums text-ink-2">{item.quantity}×</span>
            <span className="min-w-0">{item.name}</span>
            <span className="ml-auto tabular-nums">{formatCents(item.unitPriceInCents * item.quantity)}</span>
          </div>
        ))}
        {fee !== null && (
          <div className="flex text-sm">
            <span className="text-ink-2">Entrega</span>
            <span className="ml-auto tabular-nums">{fee}</span>
          </div>
        )}
        <div className="flex border-t border-paper-3 pt-2.5">
          <span className="text-sm font-semibold">TOTAL</span>
          <span className="ml-auto text-lg font-semibold tabular-nums">{formatCents(receipt.totalInCents)}</span>
        </div>
      </div>

      {receipt.totalInCents !== expectedTotal && (
        <p role="status" className="mt-3 rounded-field bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn">
          O total mudou: a loja atualizou o preço de algum item. Vale o valor acima.
        </p>
      )}

      {path && (
        <div className="mt-4 rounded-card bg-paper-2 p-4">
          <p className="text-sm font-semibold">Guarde este link — ele não se recupera</p>
          <p className="mt-1 break-all text-[13px] text-ink-2">{path}</p>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}${path}`).then(() => setCopied(true));
            }}
            className="mt-1 min-h-11 text-[13px] font-semibold text-action"
          >
            {copied ? "Link copiado" : "Copiar link"}
          </button>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto flex max-w-[480px] flex-col gap-2 border-t border-paper-3 bg-paper px-4 pb-[18px] pt-3">
        {path && (
          <a href={path} className="flex min-h-[52px] w-full items-center justify-center rounded-field bg-action text-base font-semibold text-white">
            Acompanhar pedido
          </a>
        )}
        <button
          type="button"
          onClick={onRestart}
          className={
            path
              ? "min-h-11 w-full text-sm font-semibold text-ink-2"
              : "min-h-[52px] w-full rounded-field bg-action text-base font-semibold text-white"
          }
        >
          Voltar ao cardápio
        </button>
      </div>
    </main>
  );
}
```

Ajuste os testes do salão que já renderizam o enviado: o `json(...)` do POST em `dine-in-flow.test.tsx` e em `table.test.tsx` passa a trazer `type: "dine_in"` e `deliveryFeeInCents: null` no recibo (`created`/`RECEIPT` desses arquivos).

- [ ] **Step 6: `MenuApp` em modo link**

Em `apps/menu/src/components/MenuApp.tsx`:

1. `type HistoryState = { menuScreen?: Screen; productId?: string; step?: number } | null;` e o estado `const [checkoutStep, setCheckoutStep] = useState(0);`.
2. `show(next, productId?, step = 0)` chama `setCheckoutStep(step)`; `go(next, productId?)` empurra `{ menuScreen: next, productId, step: 0 }`; o `onPop` passa `state?.step ?? 0`; e um passo novo do finalizar:

```tsx
  // cada passo do finalizar é uma entrada do histórico: o voltar do celular
  // volta um passo, e o voltar da tela (history.back) faz o mesmo
  const goStep = (step: number) => {
    window.history.pushState({ menuScreen: "checkout", step } satisfies HistoryState, "");
    setCheckoutStep(step);
    window.scrollTo?.(0, 0);
  };
```

3. O status ao vivo também traz as modalidades do link:

```tsx
        isDelivery: typeof live.isDelivery === "boolean" ? live.isDelivery : current.isDelivery,
        isTakeaway: typeof live.isTakeaway === "boolean" ? live.isTakeaway : current.isTakeaway,
```

4. Quem pode pedir:

```tsx
  // mesa: o salão; link: entrega ou retirada
  const canOrder = inDineIn ? restaurant.isOpen && restaurant.isQrcode : canOrderByLink(restaurant);
```

5. `StoreNotice` recebe `linkOff={!inDineIn && linkModalities(restaurant).length === 0}`.
6. `CartScreen` recebe `context={tableLabel ?? (inDineIn ? "" : "Entrega ou retirada")}`, `totalLabel={inDineIn ? "Total" : "Itens"}` e `hint={inDineIn ? null : minimumHint(restaurant, subtotal(lines))}`.
7. A tela `checkout` escolhe o finalizar:

```tsx
      {screen === "checkout" && !inDineIn && (
        <LinkCheckout
          restaurant={restaurant}
          lines={lines}
          step={checkoutStep}
          onStep={goStep}
          onBack={back}
          onSent={({ receipt }) => finish(receipt)}
        />
      )}
```

com o `CheckoutScreen` do salão sob `screen === "checkout" && inDineIn`, e os dois `onSent` chamando a mesma função:

```tsx
  const finish = (receipt: OrderReceipt) => {
    setSent({ receipt, expectedTotal: subtotal(lines) + (receipt.deliveryFeeInCents ?? 0) });
    updateLines([]);
    // o finalizar vira o comprovante: voltar não reabre um pedido enviado
    window.history.replaceState({ menuScreen: "sent" } satisfies HistoryState, "");
    setScreen("sent");
    window.scrollTo?.(0, 0);
  };
```

8. `SentScreen` recebe `slug={menu.restaurant.slug}`.

Imports novos: `LinkCheckout` de `./LinkCheckout.tsx`; `canOrderByLink`, `linkModalities`, `minimumHint` de `@/lib/link-order.ts`; `type OrderReceipt` de `@/lib/api.ts`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu test && pnpm lint && (cd apps/menu && pnpm exec tsc --noEmit)`
Expected: tudo verde, inclusive os testes do salão.

- [ ] **Step 8: Commit**

```bash
git add apps/menu
git commit -m "feat(menu): ✨ liga o pedido de entrega e retirada ao cardápio e ao enviado"
```

### Task 13: A regra e o transporte do acompanhamento (app, sem React)

**Files:**
- Create: `apps/menu/src/lib/tracking.ts` (tipos, trilha, manchete, previsão, leitura HTTP, URL do socket)
- Create: `apps/menu/src/lib/tracker.ts` (WebSocket com recuo para consulta)
- Test: `apps/menu/test/tracking.test.ts`, `apps/menu/test/tracker.test.ts`

**Interfaces:**
- Consumes: `API_URL`; `GET /orders/:orderId?token=` com `statusHistory`, `estimate`, `cancellationReason` (Tasks 2 e 4); WebSocket `/orders/:orderId/track?token=` (`snapshot`/`status`, fecha com 1000 no fim).
- Produces:
  - `OrderStatus`, `TrackedOrder` (tipo da resposta), `isFinished(status)`, `trackSteps(order, timezone): { label; time: string | null; done: boolean }[]`, `trackHeadline(order): string`, `estimateText(order, timezone): string | null`, `fetchTrackedOrder(orderId, token): Promise<TrackedOrder | "not-found">` (lança em rede/5xx), `trackingSocketUrl(orderId, token): string`.
  - `SocketLike = { onopen; onmessage; onclose; onerror; close() }`; `POLL_MS = 20_000`; `RETRY_SOCKET_MS = 60_000`; `TrackerState = { order: TrackedOrder | null; mode: "live" | "polling"; updatedAt: number | null; notFound: boolean }`; `startTracker(deps, onChange): { stop(): void; refresh(): void }`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/menu/test/tracking.test.ts
import { describe, expect, it } from "vitest";
import { estimateText, type TrackedOrder, trackHeadline, trackSteps } from "../src/lib/tracking.ts";

const TZ = "America/Sao_Paulo";

function order(over: Partial<TrackedOrder> = {}): TrackedOrder {
  return {
    id: "o1",
    number: 42,
    type: "delivery",
    status: "preparing",
    totalInCents: 6100,
    deliveryFeeInCents: 900,
    paymentMethod: "pix",
    items: [],
    statusHistory: [
      { status: "pending", at: "2026-09-30T21:00:00.000Z" },
      { status: "confirmed", at: "2026-09-30T21:02:00.000Z" },
      { status: "preparing", at: "2026-09-30T21:05:00.000Z" },
    ],
    estimate: { from: "2026-09-30T21:42:00.000Z", to: "2026-09-30T21:57:00.000Z" },
    cancellationReason: null,
    ...over,
  };
}

describe("acompanhamento", () => {
  it("trilha da entrega com a hora de cada etapa, no fuso da loja", () => {
    expect(trackSteps(order(), TZ)).toEqual([
      { label: "Pedido aceito", time: "18:02", done: true },
      { label: "Preparando", time: "18:05", done: true },
      { label: "Saiu para entrega", time: null, done: false },
      { label: "Entregue", time: null, done: false },
    ]);
  });

  it("trilha da retirada", () => {
    expect(trackSteps(order({ type: "takeaway", status: "ready_for_pickup" }), TZ).map((s) => [s.label, s.done])).toEqual([
      ["Pedido aceito", true],
      ["Preparando", true],
      ["Pronto para retirada", true],
      ["Retirado", false],
    ]);
  });

  it("manchete: aguardando, a etapa atual, cancelado", () => {
    expect(trackHeadline(order({ status: "pending" }))).toBe("Aguardando a loja confirmar");
    expect(trackHeadline(order({ status: "out_for_delivery" }))).toBe("Saiu para entrega");
    expect(trackHeadline(order({ status: "cancelled" }))).toBe("Pedido cancelado");
  });

  it("previsão por modalidade, e nada quando a API não prevê", () => {
    expect(estimateText(order(), TZ)).toBe("Previsão de entrega: 18:42 – 18:57");
    expect(estimateText(order({ type: "takeaway", estimate: { readyAt: "2026-09-30T21:27:00.000Z" } }), TZ)).toBe(
      "Pronto por volta de 18:27",
    );
    expect(estimateText(order({ estimate: null }), TZ)).toBeNull();
  });
});
```

```ts
// apps/menu/test/tracker.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POLL_MS, RETRY_SOCKET_MS, type SocketLike, startTracker, type TrackerState } from "../src/lib/tracker.ts";
import type { TrackedOrder } from "../src/lib/tracking.ts";

function fakeSocket() {
  const socket: SocketLike & { closed: boolean } = {
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    closed: false,
    close() {
      this.closed = true;
    },
  };
  return socket;
}

const order = (status: TrackedOrder["status"]) => ({ id: "o1", status }) as TrackedOrder;

describe("transporte do acompanhamento", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(fetchOrder = vi.fn(async () => order("preparing"))) {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const states: TrackerState[] = [];
    const openSocket = vi.fn(() => {
      const s = fakeSocket();
      sockets.push(s);
      return s;
    });
    const tracker = startTracker({ fetchOrder, openSocket, now: () => Date.now() }, (s) => states.push(s));
    return { fetchOrder, openSocket, sockets, states, tracker };
  }

  it("socket aberto é tempo real; cada mensagem busca o pedido de novo", async () => {
    const { fetchOrder, sockets, states } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].onopen?.();
    expect(states.at(-1)?.mode).toBe("live");
    sockets[0].onmessage?.({ data: "{}" });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchOrder).toHaveBeenCalledTimes(2);
  });

  it("socket caiu: consulta a cada 20 s e tenta o socket de novo a cada minuto", async () => {
    const { fetchOrder, openSocket, sockets, states } = setup();
    await vi.advanceTimersByTimeAsync(0);
    sockets[0].onclose?.();
    expect(states.at(-1)?.mode).toBe("polling");
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(fetchOrder).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_SOCKET_MS - POLL_MS);
    expect(openSocket).toHaveBeenCalledTimes(2);
    sockets[1].onopen?.();
    const calls = fetchOrder.mock.calls.length;
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(fetchOrder.mock.calls.length).toBe(calls);
  });

  // Review Focus 3: pedido terminado não fica reconectando nem consultando
  it("pedido terminado: fecha o socket e para tudo", async () => {
    const { fetchOrder, openSocket, sockets } = setup(vi.fn(async () => order("completed")));
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets[0].closed).toBe(true);
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(RETRY_SOCKET_MS * 3);
    expect(fetchOrder).toHaveBeenCalledTimes(1);
    expect(openSocket).toHaveBeenCalledTimes(1);
  });

  it("404 é 'não encontrado', e para tudo", async () => {
    const { states, openSocket, sockets } = setup(vi.fn(async () => "not-found" as const));
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)?.notFound).toBe(true);
    sockets[0].onclose?.();
    await vi.advanceTimersByTimeAsync(RETRY_SOCKET_MS * 2);
    expect(openSocket).toHaveBeenCalledTimes(1);
  });

  it("sem rede na consulta: fica o último estado", async () => {
    let fail = false;
    const { states } = setup(
      vi.fn(async () => {
        if (fail) throw new TypeError("Failed to fetch");
        return order("preparing");
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    fail = true;
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(states.at(-1)?.order?.status).toBe("preparing");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/tracking.test.ts test/tracker.test.ts`
Expected: FAIL — os arquivos não existem.

- [ ] **Step 3: Implement `tracking.ts`**

```ts
// apps/menu/src/lib/tracking.ts
import { API_URL } from "./api.ts";
import type { PaymentMethod } from "./types.ts";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "preparing"
  | "out_for_delivery"
  | "ready_for_pickup"
  | "completed"
  | "cancelled";

/** O pedido como o acompanhamento público devolve. */
export type TrackedOrder = {
  id: string;
  number: number;
  type: "delivery" | "takeaway";
  status: OrderStatus;
  totalInCents: number;
  deliveryFeeInCents: number | null;
  paymentMethod: PaymentMethod;
  items: {
    name: string;
    quantity: number;
    unitPriceInCents: number;
    options?: { name: string }[];
    note?: string | null;
  }[];
  statusHistory: { status: OrderStatus; at: string }[];
  estimate: { readyAt: string } | { from: string; to: string } | null;
  cancellationReason: string | null;
};

export function isFinished(status: OrderStatus): boolean {
  return status === "completed" || status === "cancelled";
}

const TRACKS: Record<TrackedOrder["type"], { status: OrderStatus; label: string }[]> = {
  delivery: [
    { status: "confirmed", label: "Pedido aceito" },
    { status: "preparing", label: "Preparando" },
    { status: "out_for_delivery", label: "Saiu para entrega" },
    { status: "completed", label: "Entregue" },
  ],
  takeaway: [
    { status: "confirmed", label: "Pedido aceito" },
    { status: "preparing", label: "Preparando" },
    { status: "ready_for_pickup", label: "Pronto para retirada" },
    { status: "completed", label: "Retirado" },
  ],
};

function hhmm(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/**
 * As quatro etapas do handoff, com a hora de cada uma vinda do histórico (o
 * primeiro registro daquele status). Etapa sem registro fica sem hora — a tela
 * mostra "—", nunca estima.
 */
export function trackSteps(order: TrackedOrder, timezone: string) {
  const track = TRACKS[order.type];
  const reached = track.findIndex((step) => step.status === order.status);
  return track.map((step, index) => {
    const at = order.statusHistory.find((event) => event.status === step.status)?.at;
    return { label: step.label, time: at ? hhmm(at, timezone) : null, done: reached >= index };
  });
}

export function trackHeadline(order: TrackedOrder): string {
  if (order.status === "pending") return "Aguardando a loja confirmar";
  if (order.status === "cancelled") return "Pedido cancelado";
  return TRACKS[order.type].find((step) => step.status === order.status)?.label ?? "Pedido aceito";
}

/** Hora de parede, e não "em 25 min": não envelhece com a tela aberta. */
export function estimateText(order: TrackedOrder, timezone: string): string | null {
  const e = order.estimate;
  if (e === null) return null;
  if ("readyAt" in e) return `Pronto por volta de ${hhmm(e.readyAt, timezone)}`;
  return `Previsão de entrega: ${hhmm(e.from, timezone)} – ${hhmm(e.to, timezone)}`;
}

/** A leitura HTTP. 404 é "não existe para este token"; rede e 5xx lançam. */
export async function fetchTrackedOrder(orderId: string, token: string): Promise<TrackedOrder | "not-found"> {
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  if (res.status === 404 || res.status === 400) return "not-found";
  if (!res.ok) throw new Error(`acompanhamento: ${res.status}`);
  return (await res.json()) as TrackedOrder;
}

export function trackingSocketUrl(orderId: string, token: string): string {
  return `${API_URL.replace(/^http/, "ws")}/orders/${encodeURIComponent(orderId)}/track?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Implement `tracker.ts`**

```ts
// apps/menu/src/lib/tracker.ts
import { isFinished, type TrackedOrder } from "./tracking.ts";

/** O que o transporte usa de um WebSocket — o suficiente para o teste trocar. */
export type SocketLike = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close(): void;
};

export const POLL_MS = 20_000;
export const RETRY_SOCKET_MS = 60_000;

export type TrackerState = {
  order: TrackedOrder | null;
  mode: "live" | "polling";
  updatedAt: number | null;
  notFound: boolean;
};

export type TrackerDeps = {
  fetchOrder: () => Promise<TrackedOrder | "not-found">;
  openSocket: () => SocketLike;
  now: () => number;
};

/**
 * WebSocket quando dá, consulta quando não. Toda mensagem do socket só avisa
 * que algo mudou: o pedido é sempre lido pelo `GET` (uma fonte para horários,
 * previsão e motivo). Socket que cai → consulta a cada 20 s e nova tentativa
 * de socket a cada minuto. Pedido terminado ou inexistente → para tudo.
 */
export function startTracker(deps: TrackerDeps, onChange: (state: TrackerState) => void) {
  let state: TrackerState = { order: null, mode: "polling", updatedAt: null, notFound: false };
  let socket: SocketLike | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const emit = (patch: Partial<TrackerState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  const stopPolling = () => {
    if (poll !== null) clearInterval(poll);
    poll = null;
  };

  const stop = () => {
    stopped = true;
    stopPolling();
    if (retry !== null) clearTimeout(retry);
    retry = null;
    const open = socket;
    socket = null;
    open?.close();
  };

  const refresh = () => {
    if (stopped) return;
    deps.fetchOrder().then(
      (result) => {
        if (stopped) return;
        if (result === "not-found") {
          emit({ notFound: true });
          stop();
          return;
        }
        emit({ order: result, updatedAt: deps.now() });
        if (isFinished(result.status)) stop();
      },
      () => {
        // sem rede: fica o último estado, e a próxima consulta tenta de novo
      },
    );
  };

  const fallBack = () => {
    if (stopped) return;
    socket = null;
    emit({ mode: "polling" });
    if (poll === null) poll = setInterval(refresh, POLL_MS);
    if (retry === null) {
      retry = setTimeout(() => {
        retry = null;
        connect();
      }, RETRY_SOCKET_MS);
    }
  };

  const connect = () => {
    if (stopped) return;
    const s = deps.openSocket();
    socket = s;
    s.onopen = () => {
      if (stopped) return;
      stopPolling();
      emit({ mode: "live" });
    };
    s.onmessage = () => refresh();
    s.onclose = () => {
      if (socket === s) fallBack();
    };
    s.onerror = () => {
      if (socket === s) fallBack();
    };
  };

  refresh();
  connect();
  return { stop, refresh };
}
```

- [ ] **Step 5: Run them to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/tracking.test.ts test/tracker.test.ts`
Expected: PASS (9 tests).

Mutação obrigatória: tire o `if (isFinished(result.status)) stop();` e confirme que "pedido terminado: fecha o socket e para tudo" cai; desfaça.

- [ ] **Step 6: Commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu test && pnpm lint && (cd apps/menu && pnpm exec tsc --noEmit)`
Expected: verde.

```bash
git add apps/menu
git commit -m "feat(menu): ✨ acompanha o pedido por websocket com recuo para consulta"
```

### Task 14: Página de acompanhamento e faixa do pedido em andamento (app)

**Files:**
- Modify: `apps/menu/src/lib/api.ts` (`getMenuRestaurant`)
- Create: `apps/menu/src/app/[slug]/pedido/[orderId]/page.tsx`
- Create: `apps/menu/src/components/TrackingView.tsx`
- Create: `apps/menu/src/components/ActiveOrderBanner.tsx`
- Modify: `apps/menu/src/components/MenuApp.tsx` (monta a faixa no cardápio)
- Test: `apps/menu/test/tracking-view.test.tsx`, `apps/menu/test/active-order-banner.test.tsx`, `apps/menu/test/ssr.test.tsx`

**Interfaces:**
- Consumes: `startTracker`, `fetchTrackedOrder`, `trackingSocketUrl`, `trackSteps`, `trackHeadline`, `estimateText`, `isFinished` (Task 13); `loadActiveOrder`, `clearActiveOrder`, `trackingPath` (Tasks 8 e 12).
- Produces: rota `/:slug/pedido/:orderId?t=<token>`; `getMenuRestaurant(slug): Promise<MenuRestaurant | null>` (servidor, `revalidate: 60`); `TrackingView({ restaurant, orderId })`; `ActiveOrderBanner({ slug })`.

- [ ] **Step 1: Leia o guia do Next antes da rota**

Run: `ls apps/menu/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/ apps/menu/node_modules/next/dist/docs/01-app/03-api-reference/04-functions/ | head -80`

Leia o arquivo de `route-segment-config` (a opção `dynamic`) e o de `generate-metadata` (a chave `robots`). Se o Next 16 instalado nomear algo diferente do código abaixo, siga o guia e registre a diferença no ledger.

- [ ] **Step 2: Write the failing tests**

```tsx
// apps/menu/test/tracking-view.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrackingView } from "../src/components/TrackingView.tsx";
import { saveActiveOrder } from "../src/lib/active-order.ts";
import { makeRestaurant } from "./fixtures.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** WebSocket falso: abre logo depois de criado. */
class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => this.onopen?.(), 0);
  }
  close() {}
}

const DELIVERY = {
  id: "o1",
  number: 42,
  type: "delivery",
  status: "preparing",
  totalInCents: 6100,
  deliveryFeeInCents: 900,
  paymentMethod: "pix",
  items: [{ name: "Margherita", quantity: 1, unitPriceInCents: 5200, options: [{ name: "Borda catupiry" }], note: "sem cebola" }],
  statusHistory: [
    { status: "pending", at: "2026-09-30T21:00:00.000Z" },
    { status: "confirmed", at: "2026-09-30T21:02:00.000Z" },
    { status: "preparing", at: "2026-09-30T21:05:00.000Z" },
  ],
  estimate: { from: "2026-09-30T21:42:00.000Z", to: "2026-09-30T21:57:00.000Z" },
  cancellationReason: null,
};

describe("página de acompanhamento", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("mostra etapa, previsão, trilha com horários, itens e o tempo real", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1?t=tk-1");
    vi.stubGlobal("fetch", vi.fn(async () => json(DELIVERY)));
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByRole("heading", { name: "Preparando" })).toBeTruthy();
    expect(screen.getByText("Previsão de entrega: 18:42 – 18:57")).toBeTruthy();
    expect(screen.getByText("18:05")).toBeTruthy();
    expect(screen.getByText("Borda catupiry")).toBeTruthy();
    expect(screen.getByText("Obs.: sem cebola")).toBeTruthy();
    expect(screen.getByText("R$ 61,00")).toBeTruthy();
    expect(await screen.findByText("Atualizando em tempo real")).toBeTruthy();
  });

  it("cancelado mostra o motivo e tira o pedido guardado do aparelho", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1?t=tk-1");
    saveActiveOrder("cantina-do-porto", { orderId: "o1", token: "tk-1" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...DELIVERY, status: "cancelled", cancellationReason: "Acabou o salmão" })));
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByRole("heading", { name: "Pedido cancelado" })).toBeTruthy();
    expect(screen.getByText("Acabou o salmão")).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("order:cantina-do-porto")).toBeNull());
  });

  it("sem token ou com token que não vale: 'Não encontramos este pedido'", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1");
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByText("Não encontramos este pedido")).toBeTruthy();
  });

  it("retirada mostra o número do pedido e onde retirar", async () => {
    window.history.replaceState(null, "", "/cantina-do-porto/pedido/o1?t=tk-1");
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...DELIVERY, type: "takeaway", deliveryFeeInCents: null, estimate: null })));
    vi.stubGlobal("WebSocket", FakeSocket);
    render(<TrackingView restaurant={makeRestaurant()} orderId="o1" />);
    expect(await screen.findByText("Pedido #42")).toBeTruthy();
    expect(screen.getByText("Retire em Rua do Porto, 120 — Centro")).toBeTruthy();
  });
});
```

```tsx
// apps/menu/test/active-order-banner.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActiveOrderBanner } from "../src/components/ActiveOrderBanner.tsx";
import { saveActiveOrder } from "../src/lib/active-order.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Review Focus 4: a faixa só aparece para pedido em andamento desta loja
describe("faixa do pedido em andamento", () => {
  it("pedido em andamento: a faixa leva ao acompanhamento", async () => {
    saveActiveOrder("cantina", { orderId: "o1", token: "tk" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "o1", status: "preparing" })));
    render(<ActiveOrderBanner slug="cantina" />);
    expect((await screen.findByRole("link", { name: /Acompanhar/ })).getAttribute("href")).toBe("/cantina/pedido/o1?t=tk");
    expect(screen.getByText("Você tem um pedido em andamento")).toBeTruthy();
  });

  it("terminado ou 404: sem faixa, e sai do aparelho", async () => {
    saveActiveOrder("cantina", { orderId: "o1", token: "tk" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ id: "o1", status: "completed" })));
    const { unmount } = render(<ActiveOrderBanner slug="cantina" />);
    await waitFor(() => expect(localStorage.getItem("order:cantina")).toBeNull());
    expect(screen.queryByText("Você tem um pedido em andamento")).toBeNull();
    unmount();

    saveActiveOrder("cantina", { orderId: "o1", token: "tk" });
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 404)));
    render(<ActiveOrderBanner slug="cantina" />);
    await waitFor(() => expect(localStorage.getItem("order:cantina")).toBeNull());
  });

  it("nada guardado: nem consulta a API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ActiveOrderBanner slug="cantina" />);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

Em `apps/menu/test/ssr.test.tsx`, dentro do `describe`:

```ts
  // o token é credencial: a página não pode ir para cache nem para buscador
  it("a página de acompanhamento é dinâmica e noindex", () => {
    const page = readFileSync(resolve(process.cwd(), "src/app/[slug]/pedido/[orderId]/page.tsx"), "utf8");
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).toMatch(/robots: \{ index: false, follow: false \}/);
    expect(page).not.toMatch(/searchParams/);
  });
```

- [ ] **Step 3: Run them to verify they fail**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu exec vitest run test/tracking-view.test.tsx test/active-order-banner.test.tsx test/ssr.test.tsx`
Expected: FAIL — componentes e página não existem.

- [ ] **Step 4: `getMenuRestaurant` e a página**

Em `apps/menu/src/lib/api.ts`:

```ts
/** Só o restaurante do cardápio, no SERVIDOR (a página de acompanhamento). */
export async function getMenuRestaurant(slug: string): Promise<MenuRestaurant | null> {
  const res = await fetch(`${API_URL}/menu/${encodeURIComponent(slug)}`, { next: { revalidate: MENU_REVALIDATE_SECONDS } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`restaurante ${slug}: ${res.status}`);
  return (await res.json()) as MenuRestaurant;
}
```

```tsx
// apps/menu/src/app/[slug]/pedido/[orderId]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TrackingView } from "@/components/TrackingView.tsx";
import { getMenuRestaurant } from "@/lib/api.ts";

// O token de acompanhamento é credencial (S27): esta página nunca vai para
// cache compartilhado nem para buscador. O servidor só busca a loja (nome,
// cor, endereço); o pedido é lido NO NAVEGADOR, com o token da querystring.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string; orderId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const restaurant = await getMenuRestaurant(slug);
  return {
    title: restaurant ? `${restaurant.name} · Seu pedido` : "Seu pedido",
    robots: { index: false, follow: false },
  };
}

export default async function TrackingPage({ params }: Props) {
  const { slug, orderId } = await params;
  const restaurant = await getMenuRestaurant(slug);
  if (!restaurant) notFound();
  return <TrackingView restaurant={restaurant} orderId={orderId} />;
}
```

- [ ] **Step 5: `TrackingView`**

```tsx
// apps/menu/src/components/TrackingView.tsx
"use client";

import { type CSSProperties, useEffect, useState } from "react";
import { clearActiveOrder, loadActiveOrder } from "@/lib/active-order.ts";
import { formatCents } from "@/lib/money.ts";
import { type SocketLike, startTracker, type TrackerState } from "@/lib/tracker.ts";
import {
  estimateText,
  fetchTrackedOrder,
  isFinished,
  trackHeadline,
  trackingSocketUrl,
  trackSteps,
} from "@/lib/tracking.ts";
import type { MenuRestaurant } from "@/lib/types.ts";
import { CheckIcon } from "./icons.tsx";

const INITIAL: TrackerState = { order: null, mode: "polling", updatedAt: null, notFound: false };

/**
 * O acompanhamento. O token vem da querystring, lido depois de montar (a
 * página é a mesma para qualquer token). Aba que volta a ficar visível
 * consulta na hora: o celular suspende o socket em segundo plano.
 */
export function TrackingView({ restaurant, orderId }: { restaurant: MenuRestaurant; orderId: string }) {
  const [state, setState] = useState<TrackerState>(INITIAL);
  const [missingToken, setMissingToken] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("t");
    if (!token) {
      setMissingToken(true);
      return;
    }
    const tracker = startTracker(
      {
        fetchOrder: () => fetchTrackedOrder(orderId, token),
        // o WebSocket do navegador tem handlers com parâmetro (`ev: Event`); o
        // transporte só usa o que o `SocketLike` descreve
        openSocket: () => new WebSocket(trackingSocketUrl(orderId, token)) as unknown as SocketLike,
        now: () => Date.now(),
      },
      setState,
    );
    const onVisible = () => {
      if (document.visibilityState === "visible") tracker.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      tracker.stop();
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orderId]);

  // terminou: o aparelho esquece o pedido (nunca vira histórico)
  const finished = state.order !== null && isFinished(state.order.status);
  useEffect(() => {
    if (!finished) return;
    if (loadActiveOrder(restaurant.slug)?.orderId === orderId) clearActiveOrder(restaurant.slug);
  }, [finished, restaurant.slug, orderId]);

  const brand = { "--brand-action": restaurant.brandColor ?? "#1E5AE8" } as CSSProperties;
  const back = (
    <a href={`/${restaurant.slug}`} className="mt-6 flex min-h-11 items-center justify-center text-sm font-semibold text-ink-2">
      Voltar ao cardápio
    </a>
  );

  if (missingToken || state.notFound) {
    return (
      <main style={brand} className="mx-auto min-h-dvh max-w-[480px] bg-paper px-5 pt-16 text-ink">
        <h1 className="text-[22px] font-semibold">Não encontramos este pedido</h1>
        <p className="mt-2 text-[15px] text-ink-2">Confira se o link está completo, do jeito que apareceu ao enviar o pedido.</p>
        {back}
      </main>
    );
  }

  const order = state.order;
  if (order === null) {
    return (
      <main style={brand} className="mx-auto min-h-dvh max-w-[480px] bg-paper px-5 pt-16 text-ink">
        <p className="text-[15px] text-ink-2">Carregando o pedido…</p>
      </main>
    );
  }

  const tz = restaurant.timezone;
  const estimate = estimateText(order, tz);
  const seconds = state.updatedAt === null ? null : Math.max(0, Math.round((now - state.updatedAt) / 1000));
  const cancelled = order.status === "cancelled";
  const address = restaurant.address;

  return (
    <main style={brand} className="mx-auto min-h-dvh max-w-[480px] bg-paper px-5 pb-10 pt-8 text-ink">
      <p className="text-[13px] font-semibold text-ink-2">{restaurant.name}</p>
      {!finished && (
        <p role="status" className="mt-3 flex items-center gap-2 text-[13px] text-ink-2">
          <span aria-hidden="true" className={`size-2 rounded-full ${state.mode === "live" ? "bg-success" : "bg-line-strong"}`} />
          {state.mode === "live" ? "Atualizando em tempo real" : seconds === null ? "Atualizando…" : `Atualizado há ${seconds} s`}
        </p>
      )}
      <h1 className="mt-2 text-[26px] font-semibold leading-[1.15] tracking-[-0.03em]">{trackHeadline(order)}</h1>
      {estimate && <p className="mt-2 text-sm text-ink-2">{estimate}</p>}
      {cancelled && <p className="mt-2 text-[15px] text-ink-2">{order.cancellationReason ?? "A loja cancelou este pedido."}</p>}

      {order.type === "takeaway" && (
        <div className="mt-4 rounded-card bg-paper-2 p-4 text-sm">
          <p className="font-semibold">Pedido #{order.number}</p>
          <p className="mt-1 text-ink-2">
            Retire em {address.street}, {address.number} — {address.neighborhood}
          </p>
        </div>
      )}

      {!cancelled && (
        <ol className="mt-6 flex flex-col gap-3">
          {trackSteps(order, tz).map((step) => (
            <li key={step.label} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`flex size-6 flex-none items-center justify-center rounded-full ${step.done ? "bg-action text-white" : "border-[1.5px] border-line-control"}`}
              >
                {step.done && <CheckIcon size={13} />}
              </span>
              <span className={`text-[15px] ${step.done ? "font-semibold" : "text-ink-3"}`}>{step.label}</span>
              <span className="ml-auto text-sm tabular-nums text-ink-2">{step.time ?? "—"}</span>
            </li>
          ))}
        </ol>
      )}

      <section className="mt-8 rounded-card border border-paper-3 p-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-3">Seu pedido</h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {order.items.map((item, index) => (
            <li key={index} className="flex gap-2 text-sm">
              <span className="tabular-nums text-ink-2">{item.quantity}×</span>
              <div className="min-w-0">
                <p>{item.name}</p>
                {item.options && item.options.length > 0 && (
                  <p className="text-xs text-ink-2">{item.options.map((o) => o.name).join(" · ")}</p>
                )}
                {item.note && <p className="text-xs text-ink-2">Obs.: {item.note}</p>}
              </div>
              <span className="ml-auto tabular-nums">{formatCents(item.unitPriceInCents * item.quantity)}</span>
            </li>
          ))}
        </ul>
        {order.type === "delivery" && (
          <div className="mt-2.5 flex text-sm">
            <span className="text-ink-2">Entrega</span>
            <span className="ml-auto tabular-nums">
              {order.deliveryFeeInCents === null ? "A combinar" : order.deliveryFeeInCents === 0 ? "Grátis" : formatCents(order.deliveryFeeInCents)}
            </span>
          </div>
        )}
        <div className="mt-2.5 flex border-t border-paper-3 pt-2.5">
          <span className="text-sm font-semibold">TOTAL</span>
          <span className="ml-auto text-lg font-semibold tabular-nums">{formatCents(order.totalInCents)}</span>
        </div>
      </section>
      {back}
    </main>
  );
}
```

⚠️ O item "Obs.: sem cebola" do teste é UM texto: se a tela quebrar em dois elementos (`<span>Obs.: </span><span>…</span>`), troque o teste para procurar o `note` sozinho.

- [ ] **Step 6: `ActiveOrderBanner` e a montagem no cardápio**

```tsx
// apps/menu/src/components/ActiveOrderBanner.tsx
"use client";

import { useEffect, useState } from "react";
import { clearActiveOrder, loadActiveOrder, trackingPath } from "@/lib/active-order.ts";
import { fetchTrackedOrder, isFinished } from "@/lib/tracking.ts";

/**
 * "Você tem um pedido em andamento": o caminho de volta para quem fechou a
 * aba. Confere o pedido antes de mostrar — terminado ou inexistente sai do
 * aparelho sem faixa. Sem rede, mostra (é melhor um link a mais que um a menos).
 */
export function ActiveOrderBanner({ slug }: { slug: string }) {
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    const active = loadActiveOrder(slug);
    if (!active) return;
    let alive = true;
    fetchTrackedOrder(active.orderId, active.token).then(
      (order) => {
        if (!alive) return;
        if (order === "not-found" || isFinished(order.status)) {
          clearActiveOrder(slug);
          return;
        }
        setHref(trackingPath(slug, active.orderId, active.token));
      },
      () => {
        if (alive) setHref(trackingPath(slug, active.orderId, active.token));
      },
    );
    return () => {
      alive = false;
    };
  }, [slug]);

  if (href === null) return null;
  return (
    <div className="mx-4 mt-3 flex items-center gap-3 rounded-field bg-action/10 px-3.5 py-2.5 text-[13px]">
      <span className="font-semibold">Você tem um pedido em andamento</span>
      <a href={href} className="ml-auto min-h-11 content-center font-semibold text-action">
        Acompanhar
      </a>
    </div>
  );
}
```

Em `MenuApp.tsx`, na tela `menu`, logo depois do `StoreNotice`, só pelo link (a mesa não recebe token):

```tsx
          {!inDineIn && <ActiveOrderBanner slug={menu.restaurant.slug} />}
```

(`import { ActiveOrderBanner } from "./ActiveOrderBanner.tsx";`)

- [ ] **Step 7: Run tests to verify they pass**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu test && pnpm lint && (cd apps/menu && pnpm exec tsc --noEmit)`
Expected: tudo verde.

- [ ] **Step 8: Build do Next**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm --filter @menuclick/menu build`
Expected: verde; na lista de rotas, `/[slug]` continua `●` e `/[slug]/pedido/[orderId]` sai `ƒ` (dinâmica).

- [ ] **Step 9: Commit**

```bash
git add apps/menu
git commit -m "feat(menu): ✨ adiciona a página de acompanhamento e a faixa do pedido em andamento"
```

### Task 15: Documentação e verificação ponta a ponta

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-30-app-do-cliente-parte-2-design.md` (estado)
- Modify: `README.md` (próximos passos)

- [ ] **Step 1: `CLAUDE.md`**

- Seção "O que é": o app do cliente faz pedido de salão, entrega e retirada, com acompanhamento.
- Seção "Pedidos"/"Máquina de status": o motivo do cancelamento (`cancellation_reason`, só em cancelado, gravado no `transitionTo`, corpo opcional do `cancel`); o complemento (`orders.complement`, schema próprio do endereço do PEDIDO, fora do `addressSchema` compartilhado).
- Seção do acompanhamento: o `GET /orders/:orderId?token=` traz `statusHistory` e `estimate`; a previsão conta a partir do evento `confirmed`, com os tempos de AGORA (`prep_time_minutes`, `delivery_time_min/max_minutes`), e é `null` quando não há o que prever.
- Seção do cardápio público: `deliveryNeighborhoods` (só nomes, só no modo por bairro).
- Seção do painel: o motivo ao cancelar; o bloco "Tempos estimados" em Modalidades.
- Seção do app do cliente: o modo link (quem pode pedir, "Itens" + aviso de mínimo no carrinho, finalizar em passos com cada passo no histórico, cotação com "só a última vale", troco contra o total com frete, cidade/UF do endereço da loja); o acompanhamento (rota dinâmica e noindex, token lido no navegador, WebSocket + consulta a cada 20 s + socket de novo a cada 60 s, pedido terminado para tudo); o pedido em andamento (`order:<slug>`, 24 h, nunca histórico); o endereço lembrado.

- [ ] **Step 2: Estado da spec e README**

Na spec, troque "aprovado, a implementar" por "implementado". No `README.md`, em "Próximos passos", tire o item "App do cliente, parte 2" e acrescente "Hospedagem e deploy (em plano gratuito)".

- [ ] **Step 3: Ponta a ponta no navegador (390 px)**

Com a API, o painel e o app de pé (`pnpm dev`) e o banco migrado:
1. No painel, em Modalidades, salvar "Preparo para retirada: 25" e "Entrega entre 40 e 55".
2. Abrir `http://localhost:3000/<slug>` (sem `?mesa=`), montar um carrinho, "Finalizar pedido" → Entrega → dados → endereço (ver a cotação) → Dinheiro com troco → "Enviar pedido" → tela de enviado com o link.
3. "Acompanhar pedido": "Aguardando a loja confirmar", "Atualizando em tempo real".
4. No painel, aceitar e avançar o pedido; o acompanhamento muda sozinho, com hora em cada etapa e a previsão.
5. Voltar ao cardápio: a faixa "Você tem um pedido em andamento". Concluir no painel: a faixa some ao recarregar.
6. Repetir com retirada ("Pedido #N" e o endereço da loja) e cancelar no painel com um motivo: o acompanhamento mostra "Pedido cancelado" e o motivo.

- [ ] **Step 4: Verificação e commit**

Run: `unset -f node pnpm npm npx nvm 2>/dev/null; pnpm lint && pnpm build && pnpm --filter @menuclick/pricing test && pnpm --filter @menuclick/api test && pnpm --filter @menuclick/panel test && pnpm --filter @menuclick/menu test`
Expected: tudo verde.

```bash
git add CLAUDE.md README.md docs
git commit -m "docs: 📝 documenta a entrega, a retirada e o acompanhamento no app do cliente"
```
