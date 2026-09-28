# Número do pedido, andamento, horário da loja e pagamento — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar à API os quatro dados que o painel não tem (número sequencial do pedido, horário de cada status, se a loja está aberta e até quando, se o pedido foi pago) e mostrá-los no painel como o handoff desenha.

**Architecture:** quatro fatias verticais, cada uma API → painel, na ordem número → andamento → horário → pagamento. A API segue as três camadas (rota → serviço → repositório) com SQL só no repositório; toda conta de tempo fica no Postgres. O painel só formata o que a API devolve.

**Tech Stack:** Fastify 5 + TypeScript nativo no Node 24, Postgres via `pg`, `node-pg-migrate` (SQL puro), Vitest; painel em Vite + React 19 + Mantine 9 + TanStack Query 5.

**Spec:** `docs/superpowers/specs/2026-09-28-pedido-numero-andamento-pagamento-design.md`

## Global Constraints

- Imports locais com extensão `.ts`; `import type` para tipos; sem `enum` (TS nativo, `erasableSyntaxOnly`).
- SQL só em `apps/api/src/repositories/`; todo valor do cliente como `$n` (S1/S2).
- Soft delete: toda leitura filtra `deleted_at is null`; índice único é **parcial** (D2, D5, D6).
- Migration nova sempre por `pnpm --filter @menuclick/api migrate:create <nome>` (D21), sem `if not exists` (D18), com `Down` que desfaz (D17).
- Toda rota nova declara `tags`, `summary`, `description`, `operationId` e `schema.response` por status (F10/S10); depois `pnpm --filter @menuclick/api openapi:generate`.
- `restaurants.last_order_number` **nunca** sai em resposta (S10).
- Campo que pode ser nulo e cuja nulidade é informação usa `nullable: true` (F12): `paidAt`.
- Painel: cor só por `var(--mc-*)`; toda chamada por `apiRequest`; chave de query de pedido começa em `"orders"`.
- Textos de interface em pt-BR; identificadores em inglês.
- Commits no padrão `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente, minúscula, sem ponto; sem trailer de coautoria.
- Rodar comandos de shell com `unset -f node pnpm npm npx 2>/dev/null;` antes (node/pnpm são funções do nvm neste shell).

## Review Focus

1. **Grade 24x7 do backfill** (`00:00–23:59` + `23:59–00:00` todo dia): a loja deve aparecer como "Aberta" sem hora de fechamento, nunca "fecha 23:59". → teste na Task 5.
2. **Pausar a loja pelo interruptor**: o `PATCH` volta sem `openingStatus`; o rail deve continuar "Aberta · fecha …" depois de despausar, sem esperar o polling. → teste na Task 6.
3. **Pedido criado que falha depois do número** (estoque, troco, mesa inválida): o contador não pode avançar — o próximo pedido pega o número seguinte ao último que existe. → teste na Task 1.
4. **Pedido antigo, de antes da migration**: o Andamento mostra "—" nas etapas do meio, nunca um horário inventado nem um crash por `statusHistory` curto. → teste na Task 4.
5. **Marcar como pago duas vezes** (dois aparelhos): o `paidAt` continua o da primeira marcação. → teste na Task 7.

---

## File Structure

**API (`apps/api`)**
- `migrations/<ts>_add-order-number.sql` — contador na loja, `orders.order_number`, backfill, índice.
- `migrations/<ts>_add-order-status-events.sql` — tabela de eventos e backfill.
- `migrations/<ts>_add-order-paid-at.sql` — `orders.paid_at`.
- `src/domain/order.ts` — `number`, `paidAt`, `OrderStatusEvent`, `OrderDetail`.
- `src/domain/opening-hours.ts` — `OpeningStatus`.
- `src/repositories/orders.ts` — `nextOrderNumber`, `insertStatusEvent`, `findStatusHistory`, `setPaid`; `order_number`/`paid_at` no mapper.
- `src/repositories/opening-hours.ts` — `findOpeningStatus`.
- `src/services/orders.ts` — número na criação, evento `pending`, histórico no `getById`, `markPaid`/`markUnpaid`.
- `src/services/restaurants.ts` — `getDetail` (restaurante + `openingStatus`).
- `src/routes/orders.ts`, `src/routes/tracking.ts`, `src/routes/restaurants.ts`, `src/routes/schemas.ts` — schemas e as duas rotas novas.
- `test/orders-number.test.ts`, `test/orders-status-history.test.ts`, `test/opening-status.test.ts`, `test/orders-payment-status.test.ts` — novos.
- `openapi.json` — regerado.

**Painel (`apps/panel`)**
- `src/api/types.ts` — `number`, `paidAt`, `statusHistory`, `openingStatus`.
- `src/api/orders.ts` — `markOrderPaid`, `markOrderUnpaid`.
- `src/lib/orderCode.ts` — **sai**; `test/orderCode.test.ts` sai junto.
- `src/features/orders/orderRules.ts` — `progressSteps`/`closedMessage` pelo histórico; título das confirmações com o número.
- `src/features/orders/presentation.ts` — `paymentLabel` com "· pago".
- `src/features/orders/OrderDrawer.tsx`, `OrderCard.tsx`, `src/features/kitchen/KitchenPage.tsx` — número; botão de pagamento no drawer.
- `src/features/orders/useOrders.ts` — `useTogglePaid`.
- `src/features/restaurant/storeStatus.ts` — **novo**, `storeStatusLabel` (puro).
- `src/features/restaurant/useRestaurant.ts` — gravações no cache preservam `openingStatus`.
- `src/layout/Rail.tsx` — texto do status da loja.
- `test/fixtures.ts` e os testes afetados.

---

### Task 1: API — número do pedido

**Files:**
- Create: `apps/api/migrations/<ts>_add-order-number.sql`
- Modify: `apps/api/src/domain/order.ts` (`OrderSummary`), `apps/api/src/repositories/orders.ts` (`OrderRow`, `toOrderSummary`, `InsertOrderData`, `insertOrder`, novo `nextOrderNumber`), `apps/api/src/services/orders.ts` (`create`), `apps/api/src/routes/orders.ts` (`orderSummaryProperties`), `apps/api/src/routes/tracking.ts` (`trackedOrderResponseSchema`)
- Test: `apps/api/test/orders-number.test.ts`

**Interfaces:**
- Produces: `OrderSummary.number: number`; `ordersRepository.nextOrderNumber(restaurantId: string, client: PoolClient): Promise<number>`; `InsertOrderData.orderNumber: number`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/api/test/orders-number.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createOrder, createProduct, createRestaurant } from "./helpers.ts";

/**
 * O número do pedido: contínuo por loja, sem buraco, e sem colidir sob
 * concorrência. É o `#1042` que o painel fala no balcão.
 */
describe("número do pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("começa em 1 e sobe de um em um, por loja", async () => {
    const a = await createRestaurant(app);
    const b = await createRestaurant(app);
    const pa = await createProduct(app, a, { stock: 100 });
    const pb = await createProduct(app, b, { stock: 100 });

    const a1 = await createOrder(app, a.id, [{ productId: pa.id, quantity: 1 }]);
    const a2 = await createOrder(app, a.id, [{ productId: pa.id, quantity: 1 }]);
    const b1 = await createOrder(app, b.id, [{ productId: pb.id, quantity: 1 }]);

    expect([a1.number, a2.number, b1.number]).toEqual([1, 2, 1]);
  });

  it("sai na listagem, no detalhe e no acompanhamento público", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 100 });
    const created = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });

    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    const detail = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/orders/${created.id}`,
      headers: r.headers,
    });
    const tracked = await app.inject({
      method: "GET",
      url: `/orders/${created.id}?token=${created.trackingToken}`,
    });

    expect(list.json().data[0].number).toBe(1);
    expect(detail.json().number).toBe(1);
    expect(tracked.json().number).toBe(1);
  });

  it("criação que falha depois do número não queima o número", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 100, priceInCents: 5000 });
    await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    // troco menor que o total: 400 no serviço, DEPOIS do incremento
    const falha = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders`,
      payload: {
        type: "dine_in",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: p.id, quantity: 1 }],
        paymentMethod: "cash",
        changeForInCents: 100,
      },
    });
    expect(falha.statusCode).toBe(400);

    const next = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    expect(next.number).toBe(2);
  });

  it("criações simultâneas na mesma loja recebem números distintos e contíguos", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 1000 });
    // 🚨 pool aquecido: com conexões frias, cada criação espera o handshake e
    // elas nunca se sobrepõem — o teste passaria mesmo sem o lock do contador
    await Promise.all(Array.from({ length: 10 }, () => pool.query("select pg_sleep(0.01)")));

    const orders = await Promise.all(
      Array.from({ length: 10 }, () => createOrder(app, r.id, [{ productId: p.id, quantity: 1 }])),
    );

    const numbers = orders.map((order) => order.number).sort((x, y) => x - y);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("o contador da loja não sai na resposta do restaurante", async () => {
    const r = await createRestaurant(app);
    const response = await app.inject({ method: "GET", url: `/restaurants/${r.id}`, headers: r.headers });
    expect(response.json().lastOrderNumber).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/orders-number.test.ts`
Expected: FAIL — `expected [undefined, undefined, undefined] to deeply equal [1, 2, 1]`.

- [ ] **Step 3: Criar a migration**

Run: `pnpm --filter @menuclick/api migrate:create add-order-number`, e escrever no arquivo gerado:

```sql
-- Up Migration

-- O número do pedido que se fala no balcão: `#1042`, contínuo POR LOJA.
--
-- ⚠️ A coluna é `order_number`, e não `number`: `orders.number` já existe e é
-- o número do endereço de entrega (o endereço é cópia em colunas planas, D15).
--
-- O contador mora na linha do restaurante e é incrementado na MESMA transação
-- que cria o pedido: se a criação falhar depois, o rollback desfaz o
-- incremento, e a numeração não ganha buraco. O custo é que duas criações
-- simultâneas da mesma loja entram em fila no lock dessa linha.
alter table restaurants add column last_order_number integer not null default 0;
alter table orders add column order_number integer;

-- Backfill: numera o que já existe pela ordem de criação (D11), loja a loja.
update orders o
   set order_number = n.rn
  from (
    select id, row_number() over (partition by restaurant_id order by created_at, id) as rn
      from orders
  ) n
 where n.id = o.id;

update restaurants r
   set last_order_number = m.max_number
  from (select restaurant_id, max(order_number) as max_number from orders group by restaurant_id) m
 where m.restaurant_id = r.id;

alter table orders alter column order_number set not null;

-- Parcial (D6): pedido não se apaga, mas a regra de soft delete é absoluta.
create unique index orders_order_number_active_key
  on orders (restaurant_id, order_number) where deleted_at is null;

-- Down Migration

drop index orders_order_number_active_key;
alter table orders drop column order_number;
alter table restaurants drop column last_order_number;
```

Run: `pnpm --filter @menuclick/api migrate:up`
Expected: a migration aplica sem erro (o banco de teste migra sozinho no `globalSetup`).

- [ ] **Step 4: Domínio e repositório**

Em `src/domain/order.ts`, dentro de `OrderSummary`, logo depois de `restaurantId`:

```ts
  /**
   * O número do pedido na loja (`#1042`), contínuo e sem buraco. Na coluna é
   * `order_number`: `orders.number` é o número do endereço de entrega.
   */
  number: number;
```

Em `src/repositories/orders.ts`:
- `OrderRow` ganha `order_number: number;`
- `toOrderSummary` ganha `number: row.order_number,` logo depois de `restaurantId`.
- `InsertOrderData` ganha `orderNumber: number;` (com comentário: "já reservado por `nextOrderNumber`, na mesma transação").
- `insertOrder`: acrescentar `order_number` à lista de colunas, `$17` aos valores e `data.orderNumber` ao fim do array.
- Nova função, antes de `insertOrder`:

```ts
/**
 * Reserva o próximo número de pedido da loja. SÓ dentro da transação que cria
 * o pedido: o `update` trava a linha do restaurante até o commit (serializando
 * criações simultâneas da mesma loja), e o rollback de uma criação que falhou
 * desfaz o incremento — a numeração não ganha buraco.
 *
 * Não toca `updated_at`: é contador interno, não edição de conteúdo (D10).
 */
export async function nextOrderNumber(
  restaurantId: string,
  client: PoolClient,
): Promise<number> {
  const { rows } = await client.query<{ last_order_number: number }>(
    `update restaurants set last_order_number = last_order_number + 1
      where id = $1 and deleted_at is null
      returning last_order_number`,
    [restaurantId],
  );
  if (rows.length === 0) {
    throw new Error(`restaurante ${restaurantId} sumiu no meio da criação do pedido`);
  }
  return rows[0].last_order_number;
}
```

- [ ] **Step 5: Serviço**

Em `services/orders.ts`, `create`, dentro do `withTransaction`, imediatamente antes de `const orderId = await ordersRepository.insertOrder(`:

```ts
    // depois de toda validação que pode recusar o pedido: um número reservado
    // e desfeito pelo rollback não aparece, mas reservá-lo por último encurta
    // o tempo em que a linha do restaurante fica travada
    const orderNumber = await ordersRepository.nextOrderNumber(restaurantId, client);
```

e `orderNumber,` no objeto passado a `insertOrder`.

- [ ] **Step 6: Schemas**

`routes/orders.ts`, em `orderSummaryProperties`, depois de `restaurantId`:

```ts
  // `#1042` no painel; contínuo por loja (ver a migration `add-order-number`)
  number: { type: "integer" },
```

`routes/tracking.ts`, em `trackedOrderResponseSchema.properties`, depois de `id`:

```ts
    // o número que a loja fala no balcão — útil para quem vai retirar
    number: { type: "integer" },
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd apps/api && pnpm exec vitest run test/orders-number.test.ts`
Expected: PASS (5).

Conferir o lock: trocar temporariamente, no `update` de `nextOrderNumber`, o incremento por um `select last_order_number + 1 from restaurants where id = $1` sem gravar, rodar o teste de concorrência e ver **falhar** (números repetidos); desfazer.

- [ ] **Step 8: Suíte, OpenAPI e commit**

Run: `cd apps/api && pnpm exec tsc --noEmit && pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(orders): ✨ numera os pedidos em sequência por loja"
```

---

### Task 2: Painel — `#1042` no lugar do código do UUID

**Files:**
- Delete: `apps/panel/src/lib/orderCode.ts`, `apps/panel/test/orderCode.test.ts`
- Modify: `apps/panel/src/api/types.ts` (`Order`), `src/features/orders/OrderCard.tsx`, `OrderDrawer.tsx`, `orderRules.ts`, `src/features/kitchen/KitchenPage.tsx`, `test/fixtures.ts`, `test/orders-page.test.tsx`, `test/order-actions.test.tsx`, `test/orderRules.test.ts`
- Create: `apps/panel/src/lib/orderNumber.ts`

**Interfaces:**
- Consumes: `Order.number` (Task 1).
- Produces: `orderNumber(order: Pick<Order, "number">): string` → `"#1042"`.

- [ ] **Step 1: Teste que falha**

`test/orderRules.test.ts`: onde o pedido é montado para as confirmações, fixar `number: 1042` no `makeOrder(...)` e trocar as expectativas `"#A3F9"` por `"#1042"` (títulos "Recusar o pedido #1042?" e "Cancelar o pedido #1042?"). Mesma troca em `test/order-actions.test.tsx` (três diálogos) passando `number: 1042` ao pedido do teste. Novo teste em `test/orderNumber.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { orderNumber } from "../src/lib/orderNumber.ts";

describe("número do pedido", () => {
  it("é o número da loja com #", () => {
    expect(orderNumber({ number: 1042 })).toBe("#1042");
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd apps/panel && pnpm exec vitest run test/orderNumber.test.ts test/orderRules.test.ts test/order-actions.test.tsx`
Expected: FAIL (módulo inexistente; títulos ainda com `#A3F9`).

- [ ] **Step 3: Implementar**

```ts
// apps/panel/src/lib/orderNumber.ts
import type { Order } from "../api/types.ts";

/** O número que se fala no balcão: contínuo por loja, vindo da API. */
export function orderNumber(order: Pick<Order, "number">): string {
  return `#${order.number}`;
}
```

- `api/types.ts`, `Order`: `number: number;` depois de `restaurantId`, com o comentário "contínuo por loja (`#1042`)".
- Trocar `orderCode(order.id)` por `orderNumber(order)` em `OrderCard.tsx`, `OrderDrawer.tsx`, `orderRules.ts` (3 lugares) e `KitchenPage.tsx`; trocar o import.
- Apagar `src/lib/orderCode.ts` e `test/orderCode.test.ts`.
- `test/fixtures.ts`, `makeOrder`: `number: orderSeq,` (o contador que já existe). `test/orders-page.test.tsx`: `orderCode(x.id)` → `orderNumber(x)`.

- [ ] **Step 4: Ver passar**

Run: `cd apps/panel && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS; `grep -rn orderCode src test` vazio.

- [ ] **Step 5: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ mostra o número sequencial do pedido"
```

---

### Task 3: API — histórico de status

**Files:**
- Create: `apps/api/migrations/<ts>_add-order-status-events.sql`
- Modify: `src/domain/order.ts`, `src/repositories/orders.ts` (`updateStatus`, novos `insertStatusEvent` e `findStatusHistory`), `src/services/orders.ts` (`create`, `getById`), `src/routes/orders.ts` (schema do detalhe)
- Test: `apps/api/test/orders-status-history.test.ts`

**Interfaces:**
- Produces: `type OrderStatusEvent = { status: OrderStatus; at: string }`; `type OrderDetail = Order & { statusHistory: OrderStatusEvent[] }`; `ordersService.getById(...): Promise<OrderDetail>`.

- [ ] **Step 1: Teste que falha**

```ts
// apps/api/test/orders-status-history.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createOrder, createProduct, createRestaurant, type TestRestaurant } from "./helpers.ts";

/** O Andamento do painel: quando o pedido entrou em cada status. */
describe("histórico de status do pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function step(r: TestRestaurant, orderId: string, action: string) {
    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders/${orderId}/${action}`,
      headers: r.headers,
    });
    expect(response.statusCode).toBe(200);
  }

  async function detail(r: TestRestaurant, orderId: string) {
    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${r.id}/orders/${orderId}`,
      headers: r.headers,
    });
    return response.json();
  }

  it("grava a criação e cada transição, em ordem", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    await step(r, order.id, "confirm");
    await step(r, order.id, "start-preparing");
    await step(r, order.id, "complete");

    const { statusHistory } = await detail(r, order.id);

    expect(statusHistory.map((e: { status: string }) => e.status)).toEqual([
      "pending",
      "confirmed",
      "preparing",
      "completed",
    ]);
    for (const event of statusHistory) expect(Number.isNaN(Date.parse(event.at))).toBe(false);
  });

  it("cancelamento entra no histórico", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    await step(r, order.id, "cancel");

    const { statusHistory } = await detail(r, order.id);
    expect(statusHistory.map((e: { status: string }) => e.status)).toEqual(["pending", "cancelled"]);
  });

  it("transição recusada (409) não grava evento", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }]);
    const recusada = await app.inject({
      method: "POST",
      url: `/restaurants/${r.id}/orders/${order.id}/complete`,
      headers: r.headers,
    });
    expect(recusada.statusCode).toBe(409);

    const { rows } = await pool.query("select status from order_status_events where order_id = $1", [order.id]);
    expect(rows.map((row) => row.status)).toEqual(["pending"]);
  });

  it("o histórico sai só no detalhe: nem na listagem, nem no acompanhamento", async () => {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { type: "takeaway" });

    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    const tracked = await app.inject({ method: "GET", url: `/orders/${order.id}?token=${order.trackingToken}` });

    expect(list.json().data[0].statusHistory).toBeUndefined();
    expect(tracked.json().statusHistory).toBeUndefined();
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/orders-status-history.test.ts`
Expected: FAIL (`statusHistory` undefined; `relation "order_status_events" does not exist`).

- [ ] **Step 3: Migration**

Run: `pnpm --filter @menuclick/api migrate:create add-order-status-events`

```sql
-- Up Migration

-- Quando o pedido entrou em cada status: o "Andamento" do painel, com hora
-- real por etapa. Tabela de eventos, e não uma coluna por status: status novo
-- na máquina não pede migration, e o evento é gravado num lugar só
-- (`ordersRepository.updateStatus`, por onde toda transição passa).
create table order_status_events (
  id          uuid        primary key default gen_random_uuid(),
  order_id    uuid        not null references orders (id),
  status      text        not null,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint order_status_events_status_check check (status in (
    'pending', 'confirmed', 'preparing', 'ready_for_pickup',
    'out_for_delivery', 'completed', 'cancelled'
  ))
);

create index order_status_events_active_by_order_idx
  on order_status_events (order_id, occurred_at, id) where deleted_at is null;

-- Backfill HONESTO: só o que se sabe. A chegada é `created_at`; o status atual
-- é `updated_at`. As etapas do meio não foram registradas e ficam sem evento —
-- o painel mostra "—", em vez de um horário inventado exibido como fato.
insert into order_status_events (order_id, status, occurred_at)
  select id, 'pending', created_at from orders;

insert into order_status_events (order_id, status, occurred_at)
  select id, status, updated_at from orders where status <> 'pending';

-- Down Migration

-- ⚠️ PERDA DE INFORMAÇÃO: o horário de cada transição registrada desde o Up.
-- O schema anterior não tem onde guardá-lo.
drop table order_status_events;
```

Run: `pnpm --filter @menuclick/api migrate:up`

- [ ] **Step 4: Domínio**

`src/domain/order.ts`, depois de `Order`:

```ts
/** Um status pelo qual o pedido passou, e quando. */
export type OrderStatusEvent = { status: OrderStatus; at: string };

/**
 * O pedido como o DETALHE do painel devolve: com o histórico de status. Só o
 * detalhe carrega — a listagem é polled a cada 10 s e nenhum cartão mostra o
 * andamento; o acompanhamento público fica com o app do cliente decidir.
 */
export type OrderDetail = Order & { statusHistory: OrderStatusEvent[] };
```

- [ ] **Step 5: Repositório**

```ts
/** Registra que o pedido entrou em `status`. Só a criação e `updateStatus` chamam. */
export async function insertStatusEvent(
  orderId: string,
  status: OrderStatus,
  client: PoolClient,
): Promise<void> {
  await client.query(
    `insert into order_status_events (order_id, status) values ($1, $2)`,
    [orderId, status],
  );
}

/** Os status pelos quais o pedido passou, em ordem (D11). */
export async function findStatusHistory(
  orderId: string,
  db: Queryable = pool,
): Promise<OrderStatusEvent[]> {
  const { rows } = await db.query<{ status: OrderStatus; occurred_at: Date }>(
    `select status, occurred_at from order_status_events
      where order_id = $1 and deleted_at is null
      order by occurred_at, id`,
    [orderId],
  );
  return rows.map((row) => ({ status: row.status, at: row.occurred_at.toISOString() }));
}
```

`updateStatus` ganha, depois do `update orders`: `await insertStatusEvent(orderId, status, client);` e o comentário "o evento vai na mesma transação da mudança: rollback desfaz os dois". Importar `OrderStatusEvent` do domínio.

- [ ] **Step 6: Serviço**

- `create`: logo depois de `const orderId = await ordersRepository.insertOrder(...)`: `await ordersRepository.insertStatusEvent(orderId, "pending", client);`
- `getById` passa a devolver `Promise<OrderDetail>`:

```ts
  const order = await ordersRepository.findById(restaurantId, orderId);
  if (order === null) throw orderNotFound(orderId);
  return { ...order, statusHistory: await ordersRepository.findStatusHistory(orderId) };
```

- [ ] **Step 7: Schema do detalhe**

`routes/orders.ts`, depois de `orderResponseSchema`:

```ts
/** Só o detalhe leva o histórico — ver `OrderDetail`. */
const orderDetailResponseSchema = {
  type: "object",
  properties: {
    ...orderResponseSchema.properties,
    statusHistory: {
      type: "array",
      items: {
        type: "object",
        properties: { status: { type: "string" }, at: { type: "string" } },
      },
    },
  },
};
```

Na rota `GET /restaurants/:restaurantId/orders/:orderId`: `200: orderDetailResponseSchema`, e acrescentar à `description`: "Traz `statusHistory`, o horário em que o pedido entrou em cada status; pedidos anteriores ao registro têm só a chegada e o status atual."

- [ ] **Step 8: Ver passar, suíte, OpenAPI, commit**

Run: `cd apps/api && pnpm exec vitest run test/orders-status-history.test.ts && pnpm exec tsc --noEmit && pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(orders): ✨ registra quando o pedido entrou em cada status"
```

---

### Task 4: Painel — Andamento com hora por etapa

**Files:**
- Modify: `apps/panel/src/api/types.ts` (`OrderDetail`), `src/features/orders/orderRules.ts` (`progressSteps`, `closedMessage`), `test/fixtures.ts` (`makeOrderDetail`), `test/orderRules.test.ts`

**Interfaces:**
- Consumes: `statusHistory` do detalhe (Task 3).
- Produces: `progressSteps(order: OrderDetail, timeZone?: string): Step[]`; `closedMessage(order: OrderDetail, timeZone?: string): string | null`.

- [ ] **Step 1: Testes que falham** (em `test/orderRules.test.ts`, substituindo os dois testes de `progressSteps` existentes)

```ts
  it("cada etapa leva a hora do primeiro status dela; as futuras, '—'", () => {
    const order = makeOrderDetail({
      type: "delivery",
      status: "preparing",
      statusHistory: [
        { status: "pending", at: "2026-09-19T22:58:00.000Z" },
        { status: "confirmed", at: "2026-09-19T23:01:00.000Z" },
        { status: "preparing", at: "2026-09-19T23:02:00.000Z" },
      ],
    });
    expect(progressSteps(order, TZ)).toEqual([
      { label: "Novo", state: "done", time: "19:58" },
      { label: "Em preparo", state: "current", time: "20:01" },
      { label: "Saiu para entrega", state: "future", time: null },
      { label: "Concluído", state: "future", time: null },
    ]);
  });

  it("pedido antigo sem as etapas do meio: sem hora, nunca inventada", () => {
    const order = makeOrderDetail({
      type: "dine_in",
      status: "completed",
      statusHistory: [
        { status: "pending", at: "2026-09-19T22:58:00.000Z" },
        { status: "completed", at: "2026-09-19T23:40:00.000Z" },
      ],
    });
    expect(progressSteps(order, TZ)).toEqual([
      { label: "Novo", state: "done", time: "19:58" },
      { label: "Em preparo", state: "done", time: null },
      { label: "Concluído", state: "current", time: "20:40" },
    ]);
  });

  it("concluído e cancelado dizem a hora do evento", () => {
    const done = makeOrderDetail({
      status: "completed",
      statusHistory: [
        { status: "pending", at: "2026-09-19T22:58:00.000Z" },
        { status: "completed", at: "2026-09-19T23:10:00.000Z" },
      ],
    });
    const cancelled = makeOrderDetail({
      status: "cancelled",
      statusHistory: [
        { status: "pending", at: "2026-09-19T22:58:00.000Z" },
        { status: "cancelled", at: "2026-09-19T23:05:00.000Z" },
      ],
    });
    expect(closedMessage(done, TZ)).toBe("Pedido concluído às 20:10. Não há mais ação possível.");
    expect(closedMessage(cancelled, TZ)).toBe("Pedido cancelado às 20:05. Não há mais ação possível.");
  });
```

(`TZ` é `"America/Sao_Paulo"`, já definido no arquivo.)

- [ ] **Step 2: Ver falhar**

Run: `cd apps/panel && pnpm exec vitest run test/orderRules.test.ts`
Expected: FAIL (`statusHistory` ignorado; "Em preparo" sem hora; texto do cancelado sem hora).

- [ ] **Step 3: Implementar**

`api/types.ts`:

```ts
export type OrderStatusEvent = { status: OrderStatus; at: string };
/** O detalhe traz o histórico; pedido anterior ao registro tem só chegada e status atual. */
export type OrderDetail = Order & { items: OrderItem[]; statusHistory: OrderStatusEvent[] };
```

`orderRules.ts` — `stepIndex` passa a aceitar um status (`function stepOf(type: OrderType, status: OrderStatus): number`, mesmo `switch`), e:

```ts
/** A hora do PRIMEIRO evento que cai na etapa; `null` se nenhum foi registrado. */
function stepTime(order: OrderDetail, index: number, timeZone?: string): string | null {
  const event = order.statusHistory.find(
    (item) => item.status !== "cancelled" && stepOf(order.type, item.status) === index,
  );
  return event ? formatClock(event.at, timeZone) : null;
}

function eventClock(order: OrderDetail, status: OrderStatus, timeZone?: string): string {
  const event = order.statusHistory.find((item) => item.status === status);
  // pedido sem o evento (não deveria existir depois da migration): cai no updatedAt
  return formatClock(event?.at ?? order.updatedAt, timeZone);
}

export function progressSteps(order: OrderDetail, timeZone?: string): Step[] {
  if (order.status === "cancelled") {
    return [
      { label: "Novo", state: "done", time: stepTime(order, 0, timeZone) },
      { label: "Cancelado", state: "current", time: eventClock(order, "cancelled", timeZone) },
    ];
  }
  const current = stepOf(order.type, order.status);
  return STEP_LABELS[order.type].map((label, index) => ({
    label,
    state: index < current ? "done" : index === current ? "current" : "future",
    time: index <= current ? stepTime(order, index, timeZone) : null,
  }));
}

export function closedMessage(order: OrderDetail, timeZone?: string): string | null {
  if (order.status === "completed") {
    return `Pedido concluído às ${eventClock(order, "completed", timeZone)}. Não há mais ação possível.`;
  }
  if (order.status === "cancelled") {
    return `Pedido cancelado às ${eventClock(order, "cancelled", timeZone)}. Não há mais ação possível.`;
  }
  return null;
}
```

Apagar o comentário "A API só guarda `createdAt` e `updatedAt`…" acima de `progressSteps`. No drawer, a coluna de hora já mostra `—` quando `time` é `null` só para `future`; trocar para `step.time ?? "—"` (etapa cumprida sem registro também mostra "—", como a spec pede).

`test/fixtures.ts`, `makeOrderDetail`: `statusHistory: [{ status: "pending", at: "2026-09-19T22:58:00.000Z" }],` antes de `...overrides`.

- [ ] **Step 4: Ver passar**

Run: `cd apps/panel && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ mostra a hora de cada etapa no andamento do pedido"
```

---

### Task 5: API — loja aberta agora, e até quando

**Files:**
- Modify: `apps/api/src/domain/opening-hours.ts`, `src/repositories/opening-hours.ts` (novo `findOpeningStatus`), `src/services/restaurants.ts` (novo `getDetail`), `src/routes/restaurants.ts` (GET por id), `src/routes/schemas.ts` (novo `restaurantDetailResponseSchema`)
- Test: `apps/api/test/opening-status.test.ts`

**Interfaces:**
- Produces: `type OpeningStatus = { isOpen: boolean; closesAt?: string; opensAt?: string }`; `openingHoursRepository.findOpeningStatus(restaurantId: string, timezone: string, at?: Date, db?: Queryable): Promise<OpeningStatus>`; `restaurantsService.getDetail(id: string): Promise<Restaurant & { openingStatus: OpeningStatus }>`; resposta do `GET /restaurants/:restaurantId` com `openingStatus`.

- [ ] **Step 1: Testes que falham** (no nível do repositório, com instante fixo, e um pela rota)

```ts
// apps/api/test/opening-status.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as openingHours from "../src/repositories/opening-hours.ts";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";

const TZ = "America/Sao_Paulo"; // UTC-3, sem horário de verão desde 2019

/**
 * "Aberta · fecha 23:30" / "Fechada · abre 18:00". Instante FIXO passado à
 * função: 2026-09-21 é uma segunda-feira (weekday 1).
 */
describe("status de funcionamento", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  // segunda 2026-09-21 às HH:MM no fuso de São Paulo
  const segunda = (hora: string) => new Date(`2026-09-21T${hora}:00-03:00`);

  async function lojaCom(grade: { weekday: number; opensAt: string; closesAt: string }[]) {
    const r = await createRestaurant(app, { timezone: TZ });
    await setOpeningHours(app, r, grade);
    return r;
  }

  it("dentro da faixa: aberta, com a hora de fechar", async () => {
    const r = await lojaCom([{ weekday: 1, opensAt: "11:00", closesAt: "23:30" }]);
    const status = await openingHours.findOpeningStatus(r.id, TZ, segunda("20:00"));
    expect(status).toEqual({ isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" });
  });

  it("fora da faixa: fechada, com a próxima abertura (hoje ou outro dia)", async () => {
    const r = await lojaCom([
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
    ]);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("15:00"))).toEqual({
      isOpen: false,
      opensAt: "2026-09-21T21:00:00.000Z",
    });
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("23:30"))).toEqual({
      isOpen: false,
      opensAt: "2026-09-23T21:00:00.000Z",
    });
  });

  it("faixa que atravessa a meia-noite: às 01:00 de terça vale a de segunda", async () => {
    const r = await lojaCom([{ weekday: 1, opensAt: "18:00", closesAt: "02:00" }]);
    const terca1h = new Date("2026-09-22T01:00:00-03:00");
    expect(await openingHours.findOpeningStatus(r.id, TZ, terca1h)).toEqual({
      isOpen: true,
      closesAt: "2026-09-22T05:00:00.000Z",
    });
  });

  it("faixas encostadas se fundem: almoço 11–15 e 15–23 fecha às 23", async () => {
    const r = await lojaCom([
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
      { weekday: 1, opensAt: "15:00", closesAt: "23:00" },
    ]);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("12:00"))).toEqual({
      isOpen: true,
      closesAt: "2026-09-22T02:00:00.000Z",
    });
  });

  it("grade 24x7 do backfill: aberta, sem hora de fechar", async () => {
    const grade = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
      { weekday, opensAt: "00:00", closesAt: "23:59" },
      { weekday, opensAt: "23:59", closesAt: "00:00" },
    ]);
    const r = await lojaCom(grade);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("23:59"))).toEqual({ isOpen: true });
  });

  it("sem grade nenhuma: fechada, sem próxima abertura", async () => {
    const r = await lojaCom([]);
    expect(await openingHours.findOpeningStatus(r.id, TZ, segunda("12:00"))).toEqual({ isOpen: false });
  });

  it("concorda com isOpenNow nas mesmas grades, agora", async () => {
    for (const grade of [
      [{ weekday: 1, opensAt: "11:00", closesAt: "23:30" }],
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "00:00", closesAt: "23:59" })),
      [],
    ]) {
      const r = await lojaCom(grade);
      const status = await openingHours.findOpeningStatus(r.id, TZ);
      expect(status.isOpen).toBe(await openingHours.isOpenNow(r.id, TZ));
    }
  });

  it("sai no GET do restaurante, e não no PATCH", async () => {
    const r = await createRestaurant(app);
    const get = await app.inject({ method: "GET", url: `/restaurants/${r.id}`, headers: r.headers });
    const patch = await app.inject({
      method: "PATCH",
      url: `/restaurants/${r.id}`,
      headers: r.headers,
      payload: { acceptingOrders: false },
    });
    expect(typeof get.json().openingStatus.isOpen).toBe("boolean");
    expect(patch.json().openingStatus).toBeUndefined();
  });
});
```

Confirmar antes que `setOpeningHours(app, r, grade)` aceita lista vazia (`PUT` de lista vazia fecha a loja); se o helper recusar, chamar `app.inject({ method: "PUT", url: \`/restaurants/${r.id}/opening-hours\`, headers: r.headers, payload: { openingHours: [] } })`.

- [ ] **Step 2: Ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/opening-status.test.ts`
Expected: FAIL (`findOpeningStatus is not a function`).

- [ ] **Step 3: Domínio e repositório**

`src/domain/opening-hours.ts`:

```ts
/**
 * Se a loja está dentro da GRADE agora, e a próxima fronteira. Só a grade: a
 * pausa manual (`acceptingOrders`) é outra condição, e a tela combina as duas.
 *
 * `closesAt` ausente com `isOpen: true` = aberta "direto" até o fim da janela
 * calculada (a grade 24x7). `opensAt` ausente com `isOpen: false` = loja sem
 * nenhuma faixa cadastrada.
 */
export type OpeningStatus = { isOpen: boolean; closesAt?: string; opensAt?: string };
```

`src/repositories/opening-hours.ts`, depois de `isOpenNow`:

```ts
/** Quantos dias à frente a conta olha. Trecho aberto até aqui = "aberta direto". */
const WINDOW_DAYS = 7;

/**
 * O status de funcionamento no instante `at` (padrão: agora), no fuso da loja.
 *
 * Mesma decisão de `isOpenNow`: a conta é do Postgres, que conhece o banco de
 * fusos. Cada faixa vira um intervalo de instantes concretos, de ontem até
 * `WINDOW_DAYS` dias à frente (a faixa que atravessa a meia-noite termina no
 * dia seguinte); intervalos encostados ou sobrepostos se FUNDEM — sem isso, a
 * grade 24x7 do backfill (`00:00–23:59` + `23:59–00:00`) diria "fecha 23:59"
 * numa loja que nunca fecha.
 */
export async function findOpeningStatus(
  restaurantId: string,
  timezone: string,
  at: Date | null = null,
  db: Queryable = pool,
): Promise<OpeningStatus> {
  const { rows } = await db.query<{
    is_open: boolean;
    closes_at: Date | null;
    opens_at: Date | null;
    open_through_window: boolean;
  }>(
    `with ref as (
       select coalesce($3::timestamptz, now()) as at, $2::text as tz
     ),
     days as (
       select ((ref.at at time zone ref.tz)::date + d) as day
         from ref, generate_series(-1, $4::int) as d
     ),
     spans as (
       select ((days.day + h.opens_at) at time zone ref.tz) as starts_at,
              ((days.day + h.closes_at
                + case when h.closes_at < h.opens_at then interval '1 day' else interval '0' end)
                at time zone ref.tz) as ends_at
         from days
         join opening_hours h
           on h.restaurant_id = $1
          and h.deleted_at is null
          and h.weekday = extract(dow from days.day)
         cross join ref
     ),
     marked as (
       select starts_at, ends_at,
              max(ends_at) over (order by starts_at, ends_at
                                 rows between unbounded preceding and 1 preceding) as prev_end
         from spans
     ),
     islands as (
       select starts_at, ends_at,
              sum(case when prev_end is null or starts_at > prev_end then 1 else 0 end)
                over (order by starts_at, ends_at) as island
         from marked
     ),
     merged as (
       select min(starts_at) as starts_at, max(ends_at) as ends_at from islands group by island
     ),
     current_span as (
       select merged.* from merged, ref where merged.starts_at <= ref.at and ref.at < merged.ends_at
     )
     select exists (select 1 from current_span) as is_open,
            (select ends_at from current_span) as closes_at,
            (select min(merged.starts_at) from merged, ref where merged.starts_at > ref.at) as opens_at,
            coalesce((select ends_at >= ref.at + make_interval(days => $4::int)
                        from current_span, ref), false) as open_through_window`,
    [restaurantId, timezone, at, WINDOW_DAYS],
  );
  const row = rows[0];
  if (row.is_open) {
    return row.open_through_window || row.closes_at === null
      ? { isOpen: true }
      : { isOpen: true, closesAt: row.closes_at.toISOString() };
  }
  return row.opens_at === null ? { isOpen: false } : { isOpen: false, opensAt: row.opens_at.toISOString() };
}
```

Importar `OpeningStatus` no topo (`import type { OpeningHour, OpeningHourInput, OpeningStatus } from "../domain/opening-hours.ts";`).

- [ ] **Step 4: Serviço e rota**

`services/restaurants.ts`:

```ts
/**
 * O restaurante como o GET do painel devolve: com o status de funcionamento.
 * Só o GET calcula — PATCH e POST devolvem o restaurante sem ele (o painel
 * preserva o último valor no cache; ver `useRestaurant.ts`).
 */
export async function getDetail(id: string): Promise<Restaurant & { openingStatus: OpeningStatus }> {
  const restaurant = await getById(id);
  const openingStatus = await openingHoursRepository.findOpeningStatus(restaurant.id, restaurant.timezone);
  return { ...restaurant, openingStatus };
}
```

(importar `openingHoursRepository` e `OpeningStatus` se ainda não estiverem.)

`routes/schemas.ts`, depois de `restaurantResponseSchema`:

```ts
/** O GET por id: o restaurante mais o status de funcionamento, que só ele calcula. */
export const restaurantDetailResponseSchema = {
  type: "object",
  properties: {
    ...restaurantResponseSchema.properties,
    // só a GRADE; a pausa manual continua em `acceptingOrders`
    openingStatus: {
      type: "object",
      properties: {
        isOpen: { type: "boolean" },
        closesAt: { type: "string" },
        opensAt: { type: "string" },
      },
    },
  },
};
```

`routes/restaurants.ts`, GET por id: `200: restaurantDetailResponseSchema`, handler `return restaurantsService.getDetail(request.params.restaurantId);`, e na `description`: "Traz `openingStatus`: se a loja está dentro da grade de horário agora, com `closesAt` (aberta) ou `opensAt` (fechada). A pausa manual não entra nele — está em `acceptingOrders`."

- [ ] **Step 5: Ver passar, suíte, OpenAPI, commit**

Run: `cd apps/api && pnpm exec vitest run test/opening-status.test.ts && pnpm exec tsc --noEmit && pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: tudo verde.

```bash
git add apps/api
git commit -m "feat(restaurants): ✨ diz se a loja está aberta e até quando"
```

---

### Task 6: Painel — status da loja no rail

**Files:**
- Create: `apps/panel/src/features/restaurant/storeStatus.ts`, `apps/panel/test/storeStatus.test.ts`
- Modify: `src/api/types.ts` (`Restaurant.openingStatus?`), `src/features/restaurant/useRestaurant.ts`, `src/layout/Rail.tsx`, `test/fixtures.ts` (`makeRestaurant`), `test/layout.test.tsx`

**Interfaces:**
- Consumes: `openingStatus` do GET (Task 5).
- Produces: `storeStatusLabel(restaurant: Pick<Restaurant, "acceptingOrders" | "openingStatus" | "timezone">, nowMs: number): { text: string; noSchedule: boolean }`; `keepOpeningStatus(previous: Restaurant | undefined, next: Restaurant): Restaurant`.

- [ ] **Step 1: Testes que falham**

```ts
// apps/panel/test/storeStatus.test.ts
import { describe, expect, it } from "vitest";
import { keepOpeningStatus, storeStatusLabel } from "../src/features/restaurant/storeStatus.ts";
import { makeRestaurant } from "./fixtures.ts";

const TZ = "America/Sao_Paulo";
const segunda15h = Date.parse("2026-09-21T15:00:00-03:00");

function label(openingStatus: { isOpen: boolean; closesAt?: string; opensAt?: string }, acceptingOrders = true) {
  return storeStatusLabel({ acceptingOrders, openingStatus, timezone: TZ }, segunda15h).text;
}

describe("status da loja no rail", () => {
  it("pausa ganha de tudo", () => {
    expect(label({ isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" }, false)).toBe("Pausada agora");
  });

  it("aberta, com a hora de fechar; aberta direto, sem hora", () => {
    expect(label({ isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" })).toBe("Aberta · fecha 23:30");
    expect(label({ isOpen: true })).toBe("Aberta");
  });

  it("fechada: abre hoje sem dia, outro dia com o dia", () => {
    expect(label({ isOpen: false, opensAt: "2026-09-21T21:00:00.000Z" })).toBe("Fechada · abre 18:00");
    expect(label({ isOpen: false, opensAt: "2026-09-25T21:00:00.000Z" })).toBe("Fechada · abre sex 18:00");
  });

  it("sem grade: diz que falta cadastrar", () => {
    expect(storeStatusLabel({ acceptingOrders: true, openingStatus: { isOpen: false }, timezone: TZ }, segunda15h))
      .toEqual({ text: "Fechada · sem horário cadastrado", noSchedule: true });
  });

  it("sem openingStatus (ainda carregando): cai no texto antigo", () => {
    expect(storeStatusLabel({ acceptingOrders: true, openingStatus: undefined, timezone: TZ }, segunda15h).text)
      .toBe("Aceitando pedidos");
  });

  it("a resposta do PATCH não apaga o openingStatus do cache", () => {
    const previous = makeRestaurant({ openingStatus: { isOpen: true, closesAt: "2026-09-22T02:30:00.000Z" } });
    const patched = makeRestaurant({ acceptingOrders: false, openingStatus: undefined });
    expect(keepOpeningStatus(previous, patched).openingStatus).toEqual(previous.openingStatus);
    expect(keepOpeningStatus(previous, patched).acceptingOrders).toBe(false);
  });
});
```

Em `test/layout.test.tsx`, no teste "o interruptor pausa a loja e a faixa aparece", acrescentar ao fim — despausar e ver o status do grade voltar sem esperar o polling (Review Focus 2):

```ts
    // despausa: o PATCH volta sem `openingStatus`, e o rail NÃO pode esquecê-lo
    api.add({ method: "PATCH", path: `/restaurants/${RESTAURANT_ID}`, body: makeRestaurant({ acceptingOrders: true, openingStatus: undefined }) });
    fireEvent.click(pause);
    expect(await screen.findByText("Aberta · fecha 23:30")).toBeTruthy();
```

(com `makeRestaurant` do fixture trazendo por padrão `openingStatus: { isOpen: true, closesAt: "2026-09-20T02:30:00.000Z" }` e `timezone: "America/Sao_Paulo"`; o texto esperado é o dessa hora no fuso.)

- [ ] **Step 2: Ver falhar**

Run: `cd apps/panel && pnpm exec vitest run test/storeStatus.test.ts test/layout.test.tsx`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar**

`api/types.ts`, `Restaurant`:

```ts
  /**
   * Só o GET traz (PATCH não calcula): se a loja está dentro da grade agora.
   * Ausente enquanto não houve GET — e o cache preserva o último valor.
   */
  openingStatus?: { isOpen: boolean; closesAt?: string; opensAt?: string };
```

```ts
// apps/panel/src/features/restaurant/storeStatus.ts
import type { Restaurant } from "../../api/types.ts";

/**
 * O texto do topo do rail. O painel FORMATA o que a API calculou (no fuso da
 * loja); nenhuma regra de faixa mora aqui. Pausa ganha de tudo: é a condição
 * que a pessoa escolheu agora.
 */
export function storeStatusLabel(
  restaurant: Pick<Restaurant, "acceptingOrders" | "openingStatus" | "timezone">,
  nowMs: number,
): { text: string; noSchedule: boolean } {
  if (!restaurant.acceptingOrders) return { text: "Pausada agora", noSchedule: false };
  const status = restaurant.openingStatus;
  if (status === undefined) return { text: "Aceitando pedidos", noSchedule: false };

  const clock = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: restaurant.timezone }).format(
      new Date(iso),
    );
  const day = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: restaurant.timezone }).format(new Date(ms));
  const weekday = (iso: string) =>
    new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: restaurant.timezone })
      .format(new Date(iso))
      .replace(".", "");

  if (status.isOpen) {
    return { text: status.closesAt ? `Aberta · fecha ${clock(status.closesAt)}` : "Aberta", noSchedule: false };
  }
  if (status.opensAt === undefined) return { text: "Fechada · sem horário cadastrado", noSchedule: true };
  const sameDay = day(Date.parse(status.opensAt)) === day(nowMs);
  return {
    text: sameDay
      ? `Fechada · abre ${clock(status.opensAt)}`
      : `Fechada · abre ${weekday(status.opensAt)} ${clock(status.opensAt)}`,
    noSchedule: false,
  };
}

/** A resposta do PATCH não traz `openingStatus`: guardá-la crua apagaria o status do rail. */
export function keepOpeningStatus(previous: Restaurant | undefined, next: Restaurant): Restaurant {
  return next.openingStatus === undefined && previous?.openingStatus !== undefined
    ? { ...next, openingStatus: previous.openingStatus }
    : next;
}
```

`useRestaurant.ts`: nos três `onSuccess` que gravam a resposta do PATCH (`useSetAcceptingOrders`, `useUpdateRestaurant`, `useToggleRestaurantFlag`), trocar `queryClient.setQueryData(key, restaurant)` por
`queryClient.setQueryData<Restaurant>(key, (previous) => keepOpeningStatus(previous, restaurant))`.

`Rail.tsx`: trocar o `<span className={classes.status}>…</span>` e o comentário acima dele por:

```tsx
        {restaurant && (() => {
          const status = storeStatusLabel(restaurant, now);
          return status.noSchedule ? (
            <NavLink to="/horario" className={classes.status}>
              <span className={classes.dot} aria-hidden="true" />
              {status.text}
            </NavLink>
          ) : (
            <span className={classes.status}>
              <span className={classes.dot} aria-hidden="true" />
              {status.text}
            </span>
          );
        })()}
```

com `const now = useNow();` (hook já existente em `lib/useNow.ts`) no corpo do componente. Remover a variável `paused` se ficar sem uso.

`test/fixtures.ts`, `makeRestaurant`: `openingStatus: { isOpen: true, closesAt: "2026-09-20T02:30:00.000Z" },`.

- [ ] **Step 4: Ver passar**

Run: `cd apps/panel && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS. Testes que esperavam "Aceitando pedidos" no rail passam a esperar "Aberta · fecha 23:30"; o `PauseSwitch` do header continua dizendo "Aceitando pedidos" (é outro controle).

- [ ] **Step 5: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ mostra no rail se a loja está aberta e até quando"
```

---

### Task 7: API — marcar pedido como pago

**Files:**
- Create: `apps/api/migrations/<ts>_add-order-paid-at.sql`
- Modify: `src/domain/order.ts` (`paidAt`), `src/repositories/orders.ts` (`OrderRow`, mapper, novo `setPaid`), `src/services/orders.ts` (`markPaid`, `markUnpaid`), `src/routes/orders.ts` (propriedade e duas rotas)
- Test: `apps/api/test/orders-payment-status.test.ts`

**Interfaces:**
- Produces: `OrderSummary.paidAt: string | null`; `POST /restaurants/:restaurantId/orders/:orderId/mark-paid` e `/mark-unpaid` → `200` com o pedido.

- [ ] **Step 1: Teste que falha**

```ts
// apps/api/test/orders-payment-status.test.ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOrder, createProduct, createRestaurant, type TestRestaurant } from "./helpers.ts";

/** "Pix · pago": quem diz que foi pago é a loja, na mão. */
describe("pagamento do pedido", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function novo() {
    const r = await createRestaurant(app);
    const p = await createProduct(app, r, { stock: 10 });
    const order = await createOrder(app, r.id, [{ productId: p.id, quantity: 1 }], { paymentMethod: "pix" });
    return { r, order };
  }

  const act = (r: TestRestaurant, orderId: string, action: string) =>
    app.inject({ method: "POST", url: `/restaurants/${r.id}/orders/${orderId}/${action}`, headers: r.headers });

  it("nasce não pago, com paidAt null", async () => {
    const { order } = await novo();
    expect(order.paidAt).toBeNull();
  });

  it("marca e desmarca", async () => {
    const { r, order } = await novo();
    const paid = await act(r, order.id, "mark-paid");
    expect(paid.statusCode).toBe(200);
    expect(Number.isNaN(Date.parse(paid.json().paidAt))).toBe(false);

    const unpaid = await act(r, order.id, "mark-unpaid");
    expect(unpaid.json().paidAt).toBeNull();
  });

  it("marcar de novo mantém a hora da primeira marcação", async () => {
    const { r, order } = await novo();
    const first = (await act(r, order.id, "mark-paid")).json().paidAt;
    const second = (await act(r, order.id, "mark-paid")).json().paidAt;
    expect(second).toBe(first);
  });

  it("pedido cancelado não recebe pagamento (409), mas desmarca", async () => {
    const { r, order } = await novo();
    await act(r, order.id, "mark-paid");
    await act(r, order.id, "cancel");
    expect((await act(r, order.id, "mark-paid")).statusCode).toBe(409);
    expect((await act(r, order.id, "mark-unpaid")).json().paidAt).toBeNull();
  });

  it("pagamento não mexe no status", async () => {
    const { r, order } = await novo();
    const paid = await act(r, order.id, "mark-paid");
    expect(paid.json().status).toBe("pending");
  });

  it("pedido de outra loja é 404 (S19)", async () => {
    const { order } = await novo();
    const outra = await createRestaurant(app);
    expect((await act(outra, order.id, "mark-paid")).statusCode).toBe(404);
  });

  it("paidAt sai na listagem", async () => {
    const { r, order } = await novo();
    await act(r, order.id, "mark-paid");
    const list = await app.inject({ method: "GET", url: `/restaurants/${r.id}/orders`, headers: r.headers });
    expect(list.json().data[0].paidAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Ver falhar**

Run: `cd apps/api && pnpm exec vitest run test/orders-payment-status.test.ts`
Expected: FAIL (`paidAt` undefined; rotas 404).

- [ ] **Step 3: Migration**

Run: `pnpm --filter @menuclick/api migrate:create add-order-paid-at`

```sql
-- Up Migration

-- Se o pedido foi pago. Não há pagamento online: quem marca é a loja, na mão,
-- em qualquer forma de pagamento — o sistema não presume que o pix caiu nem
-- que o concluído foi pago. Nulo = não marcado. É outro eixo que o status: o
-- pix se paga antes de sair, o dinheiro depois.
alter table orders add column paid_at timestamptz;

-- Down Migration

alter table orders drop column paid_at;
```

Run: `pnpm --filter @menuclick/api migrate:up`

- [ ] **Step 4: Domínio, repositório, serviço**

Domínio (`OrderSummary`, depois de `changeForInCents`):

```ts
  /** Quando a loja marcou como pago; `null` = não marcado. Sempre presente (F12). */
  paidAt: string | null;
```

Repositório: `OrderRow.paid_at: Date | null;`, no mapper `paidAt: row.paid_at === null ? null : row.paid_at.toISOString(),` e:

```ts
/**
 * Marca ou desmarca o pagamento. Marcar mantém o `paid_at` que já existia
 * (`coalesce`): o primeiro registro é o que vale, e um segundo aparelho
 * marcando de novo não muda a hora. Quem trava o pedido é o serviço.
 */
export async function setPaid(orderId: string, paid: boolean, client: PoolClient): Promise<void> {
  await client.query(
    paid
      ? `update orders set paid_at = coalesce(paid_at, now()), updated_at = now()
          where id = $1 and deleted_at is null`
      : `update orders set paid_at = null, updated_at = now()
          where id = $1 and deleted_at is null`,
    [orderId],
  );
}
```

Serviço (`services/orders.ts`, depois de `cancel`):

```ts
/**
 * Marca ou desmarca o pagamento. NÃO é transição de status: não passa pelo
 * mapa de `TRANSITIONS` nem publica no acompanhamento (que não mostra
 * pagamento). O lock no pedido é o mesmo das transições, pelo mesmo motivo:
 * sem ele, marcar enquanto outro aparelho cancela veria o status antigo.
 */
async function setPaid(restaurantId: string, orderId: string, paid: boolean): Promise<Order> {
  await restaurantsService.ensureExists(restaurantId);
  if (!isUuid(orderId)) throw orderNotFound(orderId);

  return withTransaction(async (client) => {
    const atual = await ordersRepository.selectForUpdate(restaurantId, orderId, client);
    if (atual === null) throw orderNotFound(orderId);
    if (paid && atual.status === "cancelled") {
      throw new ConflictError("Pedido cancelado não recebe pagamento");
    }
    await ordersRepository.setPaid(orderId, paid, client);
    return (await ordersRepository.findById(restaurantId, orderId, client)) as Order;
  });
}

export async function markPaid(restaurantId: string, orderId: string): Promise<Order> {
  return setPaid(restaurantId, orderId, true);
}

/** Vale em qualquer status: existe para corrigir um clique errado. */
export async function markUnpaid(restaurantId: string, orderId: string): Promise<Order> {
  return setPaid(restaurantId, orderId, false);
}
```

- [ ] **Step 5: Rotas**

`orderSummaryProperties`, depois de `changeForInCents`:

```ts
  // `null` = não marcado como pago (F12: sempre presente, a nulidade é a informação)
  paidAt: { type: "string", nullable: true },
```

Duas rotas, depois de `cancel`, no mesmo formato das transições (`params: orderParamsSchema`, `response: { 200: orderResponseSchema, 404: errorResponseSchema, 409: errorResponseSchema }`):
- `operationId: "markOrderPaid"`, `summary: "Marca o pedido como pago"`, `description: "Não há pagamento online: quem registra que o pedido foi pago é a loja. Vale em qualquer forma de pagamento. Marcar de novo mantém a hora da primeira marcação. Pedido cancelado é 409. Não muda o status."` → `ordersService.markPaid`.
- `operationId: "markOrderUnpaid"`, `summary: "Desfaz o pago"`, `description: "Existe para corrigir um clique errado; vale em qualquer status, inclusive cancelado."` → `ordersService.markUnpaid`.

- [ ] **Step 6: Ver passar, suíte, OpenAPI, commit**

Run: `cd apps/api && pnpm exec vitest run test/orders-payment-status.test.ts && pnpm exec tsc --noEmit && pnpm --filter @menuclick/api openapi:generate && pnpm --filter @menuclick/api test`
Expected: tudo verde (`authorization.test.ts` e `openapi.test.ts` cobrem as rotas novas sozinhos).

```bash
git add apps/api
git commit -m "feat(orders): ✨ deixa a loja marcar o pedido como pago"
```

---

### Task 8: Painel — "Pix · pago" e o botão no drawer

**Files:**
- Modify: `apps/panel/src/api/types.ts` (`Order.paidAt`), `src/api/orders.ts`, `src/features/orders/presentation.ts` (`paymentLabel`), `src/features/orders/useOrders.ts`, `src/features/orders/OrderDrawer.tsx`, `test/fixtures.ts`, `test/presentation.test.ts`, `test/order-drawer.test.tsx`

**Interfaces:**
- Consumes: `paidAt`, `mark-paid`/`mark-unpaid` (Task 7).
- Produces: `markOrderPaid(restaurantId, orderId): Promise<OrderDetail>`, `markOrderUnpaid(...)`; `useTogglePaid(restaurantId)`.

- [ ] **Step 1: Testes que falham**

`test/presentation.test.ts`:

```ts
  it("pago vira sufixo da forma", () => {
    expect(paymentLabel({ paymentMethod: "pix", paidAt: "2026-09-19T23:00:00.000Z" })).toBe("Pix · pago");
    expect(paymentLabel({ paymentMethod: "pix", paidAt: null })).toBe("Pix");
  });
```

`test/order-drawer.test.tsx`:

```ts
  it("marca como pago e desfaz", async () => {
    const api = setup(makeOrderDetail({ id: ID, paymentMethod: "pix", paidAt: null }));
    api.add({
      method: "POST",
      path: `/restaurants/${RESTAURANT_ID}/orders/${ID}/mark-paid`,
      body: makeOrderDetail({ id: ID, paymentMethod: "pix", paidAt: "2026-09-19T23:00:00.000Z" }),
    });
    const view = await drawer();
    fireEvent.click(within(view).getByRole("button", { name: "Marcar como pago" }));
    await waitFor(() => expect(api.calls.some((call) => call.path.endsWith("/mark-paid"))).toBe(true));
  });

  it("pedido cancelado não oferece marcar como pago", async () => {
    setup(makeOrderDetail({ id: ID, status: "cancelled", paidAt: null }));
    const view = await drawer();
    expect(within(view).queryByRole("button", { name: "Marcar como pago" })).toBeNull();
  });
```

(Usar o `setup`/`drawer`/`ID` já existentes no arquivo; se o `setup` não devolver o `api`, fazê-lo devolver.)

- [ ] **Step 2: Ver falhar**

Run: `cd apps/panel && pnpm exec vitest run test/presentation.test.ts test/order-drawer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`api/types.ts`, `Order`: `paidAt: string | null;` (comentário: "`null` = a loja não marcou como pago").

`api/orders.ts`:

```ts
/** Não é transição de status: é a loja dizendo que recebeu. */
export function markOrderPaid(restaurantId: string, orderId: string): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(`/restaurants/${restaurantId}/orders/${orderId}/mark-paid`, { method: "POST" });
}

/** Desfaz um "pago" marcado por engano. */
export function markOrderUnpaid(restaurantId: string, orderId: string): Promise<OrderDetail> {
  return apiRequest<OrderDetail>(`/restaurants/${restaurantId}/orders/${orderId}/mark-unpaid`, { method: "POST" });
}
```

`presentation.ts`: `paymentLabel(order: Pick<Order, "paymentMethod" | "changeForInCents" | "paidAt">)` — calcular o texto atual numa variável `base` (o `switch` existente) e `return order.paidAt ? \`${base} · pago\` : base;`.

`useOrders.ts`:

```ts
/** Pago/não pago: invalida o prefixo "orders" (cartão, detalhe e lista mostram). */
export function useTogglePaid(restaurantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, paid }: { orderId: string; paid: boolean }) =>
      paid ? markOrderPaid(restaurantId, orderId) : markOrderUnpaid(restaurantId, orderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["orders"] }),
  });
}
```

`OrderDrawer.tsx`, logo depois de `<p className={classes.payment}>{paymentLabel(order)}</p>`:

```tsx
        {order.status !== "cancelled" && (
          <Button
            variant="default"
            size="xs"
            className={classes.paidToggle}
            loading={togglePaid.isPending}
            onClick={() => togglePaid.mutate({ orderId: order.id, paid: order.paidAt === null })}
          >
            {order.paidAt === null ? "Marcar como pago" : "Desfazer pago"}
          </Button>
        )}
        {togglePaid.isError && <p role="alert" className={classes.error}>{describeError(togglePaid.error)}</p>}
```

com `const { restaurantId } = useSessionUser(); const togglePaid = useTogglePaid(restaurantId);` no `OrderDetailView`, e em `OrderDrawer.module.css`:

```css
.paidToggle {
  justify-self: start;
}
```

(conferir se `classes.error` já existe no módulo; se não, criar com `margin: 0; font-size: 13.5px; color: var(--mc-danger);`.)

`test/fixtures.ts`, `makeOrder`: `paidAt: null,`.

- [ ] **Step 4: Ver passar**

Run: `cd apps/panel && pnpm exec vitest run && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/panel
git commit -m "feat(panel): ✨ marca o pedido como pago no detalhe"
```

---

### Task 9: Documentação e verificação final

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/specs/2026-09-19-painel-da-loja-parte-1-design.md`, `docs/superpowers/specs/2026-09-28-pedido-numero-andamento-pagamento-design.md` (estado → implementado)

- [ ] **Step 1: `CLAUDE.md`**
  - Seção **Pedidos**: parágrafo sobre `order_number` (contador na loja, mesma transação, sem buraco; a coluna não é `number` porque essa é do endereço) e sobre `paid_at` (a loja marca; outro eixo que o status; `mark-paid` mantém a primeira hora; cancelado é 409).
  - Seção **Máquina de status**: "toda transição grava um evento em `order_status_events` dentro de `updateStatus`; o detalhe do painel devolve `statusHistory`; pedidos antigos só têm chegada e status atual."
  - Seção **Horário de funcionamento**: `findOpeningStatus`, a fusão das faixas encostadas (grade 24x7), o instante de referência para teste, e que só o GET por id calcula.
  - Seção **Painel**: `#${number}` substitui `orderCode`; rail com os quatro estados e o `keepOpeningStatus` nas gravações de cache.
- [ ] **Step 2: Spec da parte 1** — na tabela "Onde este desenho diverge do handoff", remover as linhas `#1042 sequencial`, `hora real em toda etapa do Andamento`, `"Pix · pago"` e `"Aberta · fecha 23:30" no rail`; acrescentar as duas linhas novas da tabela de desvios desta spec.
- [ ] **Step 3: Verificação**

Run: `unset -f node pnpm npm npx 2>/dev/null; pnpm lint && pnpm build && pnpm --filter @menuclick/api test && pnpm --filter @menuclick/panel test`
Expected: tudo verde. Conferir no navegador (dev): cartão com `#N`, Andamento com horas, rail "Aberta · fecha …", "Marcar como pago" → "Pix · pago".

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs
git commit -m "docs: 📝 documenta número, andamento, horário da loja e pagamento"
```
