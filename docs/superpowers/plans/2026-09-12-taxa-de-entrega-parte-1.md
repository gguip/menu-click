# Taxa de entrega, Parte 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O restaurante cobra frete por bairro ou taxa fixa, com entrega grátis e "a combinar", e o pedido de entrega guarda o frete congelado dentro do total.

**Architecture:** Configuração no restaurante (modo + colunas) e uma tabela de bairros atendidos. O cálculo é função pura no domínio, consumida por dois lugares: o endpoint público de cotação (informa) e a criação do pedido (decide e congela). Nenhuma chamada externa — distância e Nominatim são a Parte 2.

**Tech Stack:** TypeScript nativo do Node (type stripping, Node >= 23.6), Fastify 5, Postgres via `pg` cru, node-pg-migrate, Vitest contra Postgres real.

**Spec:** `docs/superpowers/specs/2026-09-12-taxa-de-entrega-design.md` — a autoridade. O plano argumenta a partir dela; conflito se resolve a favor da spec.

## Global Constraints

- **Runtime:** Node >= 23.6 com type stripping. Imports locais **com extensão `.ts`**. Só sintaxe apagável: **sem `enum`**, sem `namespace` com valor, sem parameter properties. `import type` para tipos (`verbatimModuleSyntax`). Não existe `dist/`; `build` é `tsc --noEmit`.
- **Três camadas:** rota (HTTP/JSON Schema) → serviço (regra, lança erro tipado) → repositório (só SQL). Rota **nunca** escreve SQL nem importa `pool`. Serviço nunca conhece Fastify.
- **Erro de negócio é erro tipado do serviço** (`NotFoundError`, `ConflictError`, `ValidationError` de `src/errors.ts`), traduzido pelo `setErrorHandler()` central. Nenhuma rota monta corpo de erro nem escolhe status de negócio.
- **Todo valor do cliente vai como `$n`.** `$n` é só para valor: identificador precisa de allowlist. Sem mass assignment — percorra mapa fixo de colunas, nunca as chaves do body.
- **`schema.response` por status code é obrigatório** — é controle de segurança: o `fast-json-stringify` só serializa campo declarado.
- **Soft delete:** nada é apagado; toda leitura filtra `deleted_at is null`; cascata é explícita e transacional; índices parciais.
- **Recurso de outro dono é 404**, nunca 403. Toda rota escopada em restaurante chama o parâmetro de `restaurantId`.
- **Dinheiro em centavos inteiros**, e arredonda uma vez só. O total é sempre calculado no servidor — nunca aceito do corpo.
- **Migration nunca é editada depois de aplicada**; `seed.sql` **precisa** ser idempotente (ids fixos, `on conflict do nothing`).
- Comentários em **pt-BR**, identificadores em **inglês**.
- Commit `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente do indicativo, minúscula, sem ponto final. Um commit = uma mudança lógica.
- Toda rota declara `tags`, `summary`, `description`, `operationId`; rodar `pnpm --filter @menuclick/api openapi:generate` no mesmo commit.
- Teste: um único `describe` de topo por arquivo. Baseline da suíte: **437**.

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `migrations/<ts>_add-delivery-fee.sql` | colunas do restaurante, `delivery_neighborhoods`, `orders.delivery_fee_in_cents` |
| `src/domain/delivery.ts` | tipos, `DELIVERY_FEE_MODES`, `normalizeNeighborhood()`, `quoteDelivery()` — **função pura, o coração** |
| `src/repositories/delivery-neighborhoods.ts` | só SQL dos bairros |
| `src/services/delivery.ts` | compõe restaurante + bairros + subtotal e devolve a cotação |
| `src/routes/delivery-neighborhoods.ts` | `PUT`/`GET` da lista, autenticadas |
| `src/routes/menu.ts` | ganha `POST /menu/:slug/delivery-quote` |
| `src/services/orders.ts` | calcula o frete, soma no total, recusa 409 |
| `test/delivery-quote.test.ts` | cotação ponta a ponta |
| `test/delivery-neighborhoods.test.ts` | CRUD dos bairros |

---

### Task 1: Migration

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-delivery-fee.sql` (via `migrate:create`, D21 — nunca escreva o arquivo à mão)

**Interfaces:**
- Produz: as colunas e a tabela que as Tasks 2–6 usam.

- [ ] **Step 1: Criar o arquivo**

```bash
pnpm --filter @menuclick/api migrate:create add-delivery-fee
```

- [ ] **Step 2: Escrever o Up**

```sql
-- Up Migration

-- O modo de cobrança. Um restaurante cobra de UMA forma: vários modos
-- simultâneos exigiriam uma regra de precedência que ninguém pediu e que o dono
-- não saberia explicar ao cliente.
--
-- ⚠️ O default 'fixed' com taxa 0 preserva EXATAMENTE o comportamento de hoje:
-- delivery hoje é de graça, e todo restaurante já cadastrado continua assim até
-- o dono configurar. A migration anterior de horário ensinou isso do jeito
-- caro — ela criou a tabela vazia e um bloqueio posterior fechou todo
-- restaurante existente no deploy. Aqui o default É o backfill.
alter table restaurants
  add column delivery_fee_mode text not null default 'fixed'
    check (delivery_fee_mode in ('neighborhood', 'distance', 'fixed')),
  -- zero é entrega grátis, não "não configurado"
  add column delivery_fixed_fee_in_cents integer not null default 0
    check (delivery_fixed_fee_in_cents >= 0),
  -- nulo = a promoção não existe. Vale nos três modos.
  add column free_delivery_above_in_cents integer
    check (free_delivery_above_in_cents is null or free_delivery_above_in_cents >= 0),
  -- o "a combinar": quando a cotação não consegue decidir, aceita mesmo assim
  add column delivery_fee_to_arrange boolean not null default false;

-- Bairros atendidos, com o preço de cada um.
create table delivery_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id),
  -- o nome como o dono digitou, que é o que volta na resposta
  name text not null,
  -- a chave de comparação: sem acento e em minúsculas. Sem ela, "Jardim
  -- América" e "jardim america" conviveriam como dois bairros — o mesmo
  -- problema que fez `categories` indexar por lower(name).
  normalized_name text not null,
  fee_in_cents integer not null check (fee_in_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- unicidade parcial (D6): índice comum impediria recadastrar um bairro removido
create unique index delivery_neighborhoods_active_name_key
  on delivery_neighborhoods (restaurant_id, normalized_name)
  where deleted_at is null;

create index delivery_neighborhoods_active_by_restaurant_idx
  on delivery_neighborhoods (restaurant_id, name)
  where deleted_at is null;

-- O frete congelado no pedido. Nulável, e os três estados são distintos:
-- valor > 0 é o frete, 0 é entrega grátis, null é "a combinar" (ou pedido que
-- não é delivery). Confundir grátis com a-combinar entregaria de graça por
-- acidente.
alter table orders
  add column delivery_fee_in_cents integer
    check (delivery_fee_in_cents is null or delivery_fee_in_cents >= 0);

-- Só pedido de entrega pode ter frete. É a mesma rede que o endereço já tem.
alter table orders
  add constraint orders_delivery_fee_check
    check (delivery_fee_in_cents is null or type = 'delivery');
```

- [ ] **Step 3: Escrever o Down**

```sql
-- Down Migration
--
-- ⚠️ PERDA DE INFORMAÇÃO: a configuração de frete de todos os restaurantes, a
-- lista inteira de bairros atendidos e o frete cobrado em cada pedido de
-- entrega desaparecem. Não há onde guardar — as colunas não existem no schema
-- anterior.
--
-- O total dos pedidos NÃO é recalculado: ele fica com o frete embutido e sem o
-- campo que explicava a diferença. Se o objetivo for só parar de cobrar frete,
-- ponha os restaurantes em modo 'fixed' com taxa 0 em vez de descer a migration.

alter table orders
  drop constraint orders_delivery_fee_check,
  drop column delivery_fee_in_cents;

drop index delivery_neighborhoods_active_by_restaurant_idx;
drop index delivery_neighborhoods_active_name_key;
drop table delivery_neighborhoods;

alter table restaurants
  drop column delivery_fee_to_arrange,
  drop column free_delivery_above_in_cents,
  drop column delivery_fixed_fee_in_cents,
  drop column delivery_fee_mode;
```

- [ ] **Step 4: Aplicar e sondar**

```bash
pnpm --filter @menuclick/api migrate:up
```

Sondas (cada uma num `-c` separado — juntar duas põe as duas na mesma transação implícita, e a falha esperada da primeira desfaz a linha que a segunda precisa):

```bash
# 1. restaurante existente nasce com frete grátis (preserva o de hoje)
docker exec -i capstone-db psql -U postgres -d capstone -qtA -c \
  "select delivery_fee_mode, delivery_fixed_fee_in_cents, delivery_fee_to_arrange from restaurants limit 1"
# esperado: fixed|0|f

# 2. modo inválido é recusado
docker exec -i capstone-db psql -U postgres -d capstone -qtA -c \
  "update restaurants set delivery_fee_mode = 'por_lua' where id = (select id from restaurants limit 1)"
# esperado: FALHA no check

# 3. frete em pedido que não é delivery é recusado
docker exec -i capstone-db psql -U postgres -d capstone -qtA -c \
  "update orders set delivery_fee_in_cents = 500 where type <> 'delivery'"
# esperado: FALHA em orders_delivery_fee_check
```

- [ ] **Step 5: Verificar o Down num banco descartável**

```bash
docker exec capstone-db psql -U postgres -q -c 'drop database if exists mig_probe with (force)'
docker exec capstone-db psql -U postgres -q -c 'create database mig_probe'
cd apps/api && DB_HOST=localhost DB_PORT=5432 DB_USER=postgres DB_PASSWORD=senha123 DB_NAME=mig_probe \
  node src/db/migrate.ts up && DB_NAME=mig_probe ... node src/db/migrate.ts down
docker exec capstone-db psql -U postgres -q -c 'drop database mig_probe with (force)'
```

Esperado: sobe e desce sem erro; a tabela some e `restaurants` volta a não ter nenhuma coluna `delivery_%` nova.

- [ ] **Step 6: Commit**

```
chore(db): 🔧 cria as colunas e a tabela de taxa de entrega

O default 'fixed' com taxa 0 preserva o comportamento atual: delivery hoje é de
graça, e restaurante já cadastrado continua assim até o dono configurar. É o
backfill embutido no default, em vez de uma migration separada depois — a
lacuna que a feature de horário só descobriu na revisão final da branch.
```

---

### Task 2: Configuração do frete no restaurante

**Files:**
- Modify: `apps/api/src/domain/restaurant.ts`, `apps/api/src/repositories/restaurants.ts`, `apps/api/src/routes/schemas.ts`
- Test: `apps/api/test/restaurants.crud.test.ts`

**Interfaces:**
- Consome: as colunas da Task 1.
- Produz: `DeliveryFeeMode`, e os campos `deliveryFeeMode`, `deliveryFixedFeeInCents`, `freeDeliveryAboveInCents`, `deliveryFeeToArrange` em `Restaurant`.

- [ ] **Step 1: Escrever os testes que falham**

Em `test/restaurants.crud.test.ts`, dentro do `describe` de topo:

```ts
it("configura o frete por PATCH e devolve na leitura", async () => {
  const restaurant = await createRestaurant(app, { slug: "com-frete" });

  const response = await app.inject({
    method: "PATCH",
    url: `/restaurants/${restaurant.id}`,
    headers: restaurant.headers,
    payload: {
      deliveryFeeMode: "fixed",
      deliveryFixedFeeInCents: 700,
      freeDeliveryAboveInCents: 5000,
      deliveryFeeToArrange: true,
    },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({
    deliveryFeeMode: "fixed",
    deliveryFixedFeeInCents: 700,
    freeDeliveryAboveInCents: 5000,
    deliveryFeeToArrange: true,
  });
});

it("restaurante nasce com entrega grátis, como era antes", async () => {
  const restaurant = await createRestaurant(app, { slug: "novo-frete" });

  const response = await app.inject({
    method: "GET",
    url: `/restaurants/${restaurant.id}`,
    headers: restaurant.headers,
  });

  // o default da coluna é o comportamento de hoje: delivery de graça
  expect(response.json()).toMatchObject({
    deliveryFeeMode: "fixed",
    deliveryFixedFeeInCents: 0,
    deliveryFeeToArrange: false,
  });
  expect(response.json().freeDeliveryAboveInCents).toBeUndefined();
});

it("recusa modo de cobrança inventado com 400", async () => {
  const restaurant = await createRestaurant(app, { slug: "modo-ruim" });

  const response = await app.inject({
    method: "PATCH",
    url: `/restaurants/${restaurant.id}`,
    headers: restaurant.headers,
    payload: { deliveryFeeMode: "por_lua" },
  });

  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node pnpm 2>/dev/null
pnpm --filter @menuclick/api exec vitest run test/restaurants.crud.test.ts
```

Esperado: FAIL — os campos saem `undefined`.

- [ ] **Step 3: O domínio**

Em `src/domain/delivery.ts` (arquivo novo):

```ts
/**
 * Taxa de entrega — tipos e o cálculo, sem runtime de infraestrutura.
 *
 * O cálculo mora aqui, e não no serviço, porque é função pura de
 * (configuração, endereço, subtotal) para (cotação). Isso o torna testável sem
 * banco e sem HTTP, que é o que uma regra de dinheiro precisa.
 */

/** Como o restaurante cobra. União `as const`: o runtime proíbe `enum`. */
export const DELIVERY_FEE_MODES = ["neighborhood", "distance", "fixed"] as const;
export type DeliveryFeeMode = (typeof DELIVERY_FEE_MODES)[number];
```

Em `src/domain/restaurant.ts`, `CreateRestaurantInput` ganha (e `Restaurant` herda):

```ts
  /**
   * Como o restaurante cobra o frete. Opcional aqui porque a coluna tem default
   * (`fixed` com taxa 0 = entrega grátis, o comportamento de antes da feature).
   *
   * Mora neste tipo para chegar ao `Restaurant` e ao `UpdateRestaurantInput`,
   * que derivam dele.
   */
  deliveryFeeMode?: DeliveryFeeMode;
  /** Usada só no modo `fixed`. Zero é entrega grátis, não ausência de config. */
  deliveryFixedFeeInCents?: number;
  /** Nulo/ausente = a promoção não existe. Vale nos três modos. */
  freeDeliveryAboveInCents?: number;
  /** Aceita o pedido mesmo sem conseguir cotar, para acertar por fora. */
  deliveryFeeToArrange?: boolean;
```

E em `Restaurant`, o estreitamento dos que a coluna garante:

```ts
  /** A coluna é `not null default 'fixed'`. */
  deliveryFeeMode: DeliveryFeeMode;
  /** Idem: `not null default 0`. */
  deliveryFixedFeeInCents: number;
  /** Idem: `not null default false`. */
  deliveryFeeToArrange: boolean;
```

`freeDeliveryAboveInCents` **não** é estreitado: a coluna é nulável de verdade.

- [ ] **Step 4: O repositório**

Em `repositories/restaurants.ts`: o tipo de linha ganha as quatro colunas
(`delivery_fee_mode: DeliveryFeeMode`, `delivery_fixed_fee_in_cents: number`,
`free_delivery_above_in_cents: number | null`, `delivery_fee_to_arrange: boolean`),
o mapper as traduz, e o mapa de colunas editáveis ganha as quatro entradas.

⚠️ `freeDeliveryAboveInCents` é opcional na resposta: siga o padrão do
`logoUrl`, que só entra na chave quando não é nulo.

```ts
    ...(row.free_delivery_above_in_cents === null
      ? {}
      : { freeDeliveryAboveInCents: row.free_delivery_above_in_cents }),
```

O `insert` **não** muda: nenhum dos quatro entra no corpo de criação, e as
colunas têm default.

- [ ] **Step 5: Os schemas**

Em `routes/schemas.ts`, `updateRestaurantBodySchema` e `restaurantResponseSchema`
ganham os quatro. **Não** entram no corpo de criação — configurar frete é ato
posterior ao cadastro, e oferecê-lo no signup é ruído.

```ts
    deliveryFeeMode: { type: "string", enum: [...SELECTABLE_DELIVERY_FEE_MODES] },
    deliveryFixedFeeInCents: { type: "integer", minimum: 0 },
    freeDeliveryAboveInCents: { type: "integer", minimum: 0 },
    deliveryFeeToArrange: { type: "boolean" },
```

⚠️ **`SELECTABLE_...`, não `DELIVERY_FEE_MODES`.** O banco aceita os três modos
(o `check` da migration), mas a Parte 1 não implementa `distance` — sem as
faixas de km ele não decide nada. Oferecê-lo no schema deixaria a loja entrar
num estado quebrado por conta própria. A Parte 2 acrescenta o modo à lista
selecionável, **sem** precisar de migration para mexer no `check`.

Em `src/domain/delivery.ts`:

```ts
/** Todos os modos que a coluna aceita. */
export const DELIVERY_FEE_MODES = ["neighborhood", "distance", "fixed"] as const;

/**
 * Os modos que a API deixa a loja escolher HOJE. `distance` só entra quando as
 * faixas de km e o Nominatim existirem (Parte 2): até lá ele não calcula nada,
 * e deixar a loja selecioná-lo seria oferecer um estado quebrado.
 */
export const SELECTABLE_DELIVERY_FEE_MODES = ["neighborhood", "fixed"] as const;
```

E um teste a mais, que prende essa restrição de propósito:

```ts
it("ainda não deixa escolher o modo por distância", async () => {
  const restaurant = await createRestaurant(app, { slug: "modo-distancia" });

  const response = await app.inject({
    method: "PATCH",
    url: `/restaurants/${restaurant.id}`,
    headers: restaurant.headers,
    payload: { deliveryFeeMode: "distance" },
  });

  // o banco aceitaria; quem recusa é o schema da rota, até a Parte 2
  expect(response.statusCode).toBe(400);
});
```

⚠️ O `enum` do JSON Schema é palavra reservada do schema, não o `enum` do
TypeScript que o runtime proíbe. São coisas diferentes.

- [ ] **Step 6: Rodar, type-check, lint**

```bash
pnpm --filter @menuclick/api exec vitest run test/restaurants.crud.test.ts
pnpm --filter @menuclick/api build && pnpm lint
```

- [ ] **Step 7: Verificar por mutação**

Tire `deliveryFeeMode` do `restaurantColumns` (o mapa de colunas editáveis).
Esperado: **FALHA** em "configura o frete por PATCH".

Troque o `minimum: 0` de `deliveryFixedFeeInCents` por nada e mande `-500`.
Esperado: o banco recusa com 500 em vez de 400 — o que mostra que o schema é a
primeira barreira, não a única.

- [ ] **Step 8: OpenAPI, suíte, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
```

```
feat(restaurants): ✨ configura o modo e a taxa de entrega
```

---

### Task 3: Bairros atendidos (CRUD)

**Files:**
- Create: `apps/api/src/repositories/delivery-neighborhoods.ts`, `apps/api/src/services/delivery-neighborhoods.ts`, `apps/api/src/routes/delivery-neighborhoods.ts`, `apps/api/test/delivery-neighborhoods.test.ts`
- Modify: `apps/api/src/app.ts` (registrar o plugin), `apps/api/src/domain/delivery.ts`, `apps/api/test/helpers.ts`

**Interfaces:**
- Consome: `delivery_neighborhoods` da Task 1.
- Produz: `normalizeNeighborhood()`, `DeliveryNeighborhood`, `findByRestaurant()`, e o helper de teste `setDeliveryNeighborhoods`.

Espelha o trio da grade de horário (`opening-hours.ts` nas quatro camadas) — leia aqueles arquivos antes de escrever, e siga a mesma forma.

- [ ] **Step 1: Escrever os testes que falham**

`test/delivery-neighborhoods.test.ts`, um único `describe` de topo:

```ts
describe("bairros atendidos", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildTestApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it("substitui a lista inteira e devolve na ordem do nome", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairros" });

    const put = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: { neighborhoods: [
        { name: "Jardim América", feeInCents: 900 },
        { name: "Centro", feeInCents: 500 },
      ] },
    });

    expect(put.statusCode).toBe(200);
    expect(put.json().neighborhoods).toEqual([
      { name: "Centro", feeInCents: 500 },
      { name: "Jardim América", feeInCents: 900 },
    ]);
  });

  it("recusa dois bairros que só diferem por acento ou caixa", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairro-dup" });

    const response = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: { neighborhoods: [
        { name: "Jardim América", feeInCents: 900 },
        { name: "jardim america", feeInCents: 400 },
      ] },
    });

    // 409: é o mesmo raciocínio do nome de categoria — o nome foi digitado por
    // quem edita, então repetido é conflito, nunca sufixo automático
    expect(response.statusCode).toBe(409);
  });

  it("bairro com taxa zero é entrega grátis, e é aceito", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairro-gratis" });

    const response = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: { neighborhoods: [{ name: "Vizinhança", feeInCents: 0 }] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().neighborhoods[0].feeInCents).toBe(0);
  });

  it("lista vazia limpa a configuração", async () => {
    const restaurant = await createRestaurant(app, { slug: "bairro-limpa" });
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: "Centro", feeInCents: 500 },
    ]);

    await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
      payload: { neighborhoods: [] },
    });

    const get = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
      headers: restaurant.headers,
    });
    expect(get.json().neighborhoods).toEqual([]);
  });

  it("bairro de outro dono responde 404", async () => {
    const dono = await createRestaurant(app, { slug: "dono-b" });
    const alheio = await createRestaurant(app, { slug: "alheio-b" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${dono.id}/delivery-neighborhoods`,
      headers: alheio.headers,
    });

    // 404, nunca 403: 403 confirmaria que aquele restaurante existe (S19)
    expect(response.statusCode).toBe(404);
  });

  it("remover o restaurante marca os bairros na mesma transação", async () => {
    const restaurant = await createRestaurant(app, { slug: "cascata-b" });
    await setDeliveryNeighborhoods(app, restaurant, [
      { name: "Centro", feeInCents: 500 },
    ]);

    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
    });

    const { rows } = await pool.query(
      `select count(*)::int as vivos from delivery_neighborhoods
        where restaurant_id = $1 and deleted_at is null`,
      [restaurant.id],
    );
    expect(rows[0].vivos).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — a rota não existe (404 em tudo).

- [ ] **Step 3: A normalização, no domínio**

Em `src/domain/delivery.ts`:

```ts
/**
 * A chave de comparação de um bairro: sem acento, sem caixa, sem espaço
 * sobrando.
 *
 * Usa a mesma técnica do `slugify` (`normalize("NFD")` separa a letra do
 * acento, e o filtro de `\p{M}` tira só o acento), mas **não** é o `slugify`:
 * aquele produz URL — corta no tamanho, troca espaço por hífen. Este produz
 * chave de igualdade, e precisa que "Jardim América" e "jardim  america"
 * colidam sem virar "jardim-america".
 */
export function normalizeNeighborhood(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export type DeliveryNeighborhoodInput = {
  name: string;
  feeInCents: number;
};

export type DeliveryNeighborhood = DeliveryNeighborhoodInput;
```

- [ ] **Step 4: Repositório, serviço e rota**

Siga `opening-hours.ts` nas quatro camadas. Pontos que diferem:

- `replaceForRestaurant(restaurantId, neighborhoods, client)` faz soft delete de
  todos e insere os novos, dentro da transação que o serviço abriu — **sem
  diff**. Mesma decisão da grade de horário: diff exigiria comparar por chave
  natural e não ganharia nada num conjunto deste tamanho.
- O `normalized_name` é calculado no **serviço**, não no repositório: é regra de
  domínio (o que conta como "mesmo bairro"), não acesso a dado.
- **Duplicata é detectada no serviço, antes do insert**, comparando os
  normalizados do payload — e lança `ConflictError` (409). O índice único é a
  rede, não a primeira barreira: deixar o 23505 subir daria 500.
- A ordenação sai do SQL: `order by name`. Quem lê a lista quer alfabética.
- O serviço de remoção do restaurante (`services/restaurants.ts`) ganha a
  chamada de `softDeleteByRestaurant` **dentro** da mesma transação (D3).

- [ ] **Step 5: O helper de teste**

Em `test/helpers.ts`:

```ts
/** Define a lista de bairros atendidos de um restaurante de teste. */
export async function setDeliveryNeighborhoods(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  neighborhoods: { name: string; feeInCents: number }[],
) {
  const response = await app.inject({
    method: "PUT",
    url: `/restaurants/${restaurant.id}/delivery-neighborhoods`,
    headers: restaurant.headers,
    payload: { neighborhoods },
  });
  if (response.statusCode !== 200) {
    throw new Error(`setDeliveryNeighborhoods falhou: ${response.body}`);
  }
  return response.json();
}
```

- [ ] **Step 6: Registrar o plugin e rodar**

`app.ts` registra o plugin novo. Rode o arquivo de teste, depois a suíte inteira.

- [ ] **Step 7: Verificar por mutação**

Tire o `trim()`/colapso de espaço do `normalizeNeighborhood`.
Esperado: **FALHA** no teste de duplicata? **Não necessariamente** — o teste usa
"Jardim América" vs "jardim america", que difere por acento e caixa, não por
espaço. Se não falhar, **acrescente** um caso com espaço duplo em vez de
afirmar cobertura que não existe.

Tire o `order by name` do repositório.
Esperado: **FALHA** no teste de ordem — confirme; se passar por sorte da ordem
de inserção, diga isso no relatório.

Tire a checagem de duplicata do serviço.
Esperado: **FALHA** com 500 em vez de 409.

- [ ] **Step 8: OpenAPI, suíte, commit**

```
feat(restaurants): ✨ define os bairros atendidos e o preço de cada um
```

---

### Task 4: O cálculo do frete

**Files:**
- Modify: `apps/api/src/domain/delivery.ts`
- Create: `apps/api/test/delivery-quote.unit.test.ts`

**Interfaces:**
- Consome: `DeliveryNeighborhood`, `normalizeNeighborhood` (Task 3).
- Produz: `quoteDelivery(input): DeliveryQuote` — consumida pela Task 5 (endpoint) e pela Task 6 (criação do pedido).

Esta é a tarefa mais importante do plano. É função **pura**: sem banco, sem
HTTP, sem relógio. Tudo que ela precisa chega por parâmetro, e é isso que
permite testá-la exaustivamente.

- [ ] **Step 1: Escrever os testes que falham**

`test/delivery-quote.unit.test.ts` — note que este arquivo **não sobe o app**;
é teste de função pura, então não precisa de `buildTestApp` nem de banco.

```ts
import { describe, expect, it } from "vitest";
import { quoteDelivery } from "../src/domain/delivery.ts";

describe("cotação de frete", () => {
  const base = {
    mode: "fixed" as const,
    fixedFeeInCents: 700,
    freeAboveInCents: undefined,
    toArrange: false,
    neighborhoods: [],
    addressNeighborhood: "Centro",
    subtotalInCents: 3000,
  };

  it("taxa fixa devolve a taxa", () => {
    expect(quoteDelivery(base)).toEqual({
      deliversTo: true, feeInCents: 700, isFree: false, toArrange: false,
    });
  });

  it("taxa fixa zero é entrega grátis", () => {
    expect(quoteDelivery({ ...base, fixedFeeInCents: 0 })).toEqual({
      deliversTo: true, feeInCents: 0, isFree: true, toArrange: false,
    });
  });

  it("bairro cadastrado devolve o preço dele", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      neighborhoods: [
        { name: "Centro", feeInCents: 500 },
        { name: "Jardim América", feeInCents: 900 },
      ],
      addressNeighborhood: "Jardim América",
    });
    expect(quote).toEqual({
      deliversTo: true, feeInCents: 900, isFree: false, toArrange: false,
    });
  });

  it("casa o bairro ignorando acento, caixa e espaço", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      neighborhoods: [{ name: "Jardim América", feeInCents: 900 }],
      addressNeighborhood: "  jardim   AMERICA ",
    });
    expect(quote.feeInCents).toBe(900);
  });

  it("bairro fora da lista não entrega, quando não há 'a combinar'", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      neighborhoods: [{ name: "Centro", feeInCents: 500 }],
      addressNeighborhood: "Outro Lugar",
    });
    expect(quote).toEqual({
      deliversTo: false, feeInCents: null, isFree: false, toArrange: false,
    });
  });

  it("bairro fora da lista vira 'a combinar' quando a loja liga a opção", () => {
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      toArrange: true,
      neighborhoods: [{ name: "Centro", feeInCents: 500 }],
      addressNeighborhood: "Outro Lugar",
    });
    expect(quote).toEqual({
      deliversTo: true, feeInCents: null, isFree: false, toArrange: true,
    });
  });

  it("modo bairro SEM bairro cadastrado não é frete zero", () => {
    // ausência de configuração é ausência de serviço, nunca serviço de graça
    const quote = quoteDelivery({ ...base, mode: "neighborhood", neighborhoods: [] });
    expect(quote.deliversTo).toBe(false);
    expect(quote.feeInCents).toBeNull();
  });

  it("grátis acima de X zera a taxa", () => {
    const quote = quoteDelivery({ ...base, freeAboveInCents: 3000 });
    expect(quote).toEqual({
      deliversTo: true, feeInCents: 0, isFree: true, toArrange: false,
    });
  });

  it("grátis acima de X compara com o SUBTOTAL, e o limite é inclusivo", () => {
    // exatamente no limite: grátis
    expect(quoteDelivery({ ...base, freeAboveInCents: 3000, subtotalInCents: 3000 }).isFree).toBe(true);
    // um centavo abaixo: cobra
    expect(quoteDelivery({ ...base, freeAboveInCents: 3000, subtotalInCents: 2999 }).feeInCents).toBe(700);
  });

  it("grátis acima de X não resgata endereço que a loja não atende", () => {
    // a promoção é desconto sobre um frete que dá para calcular; ela não
    // significa "entrega em qualquer lugar"
    const quote = quoteDelivery({
      ...base,
      mode: "neighborhood",
      freeAboveInCents: 1000,
      neighborhoods: [{ name: "Centro", feeInCents: 500 }],
      addressNeighborhood: "Outro Lugar",
    });
    expect(quote.deliversTo).toBe(false);
  });

  it("modo distância ainda não decide nada na Parte 1", () => {
    // as faixas de km chegam com o Nominatim; até lá o modo cai no caminho de
    // "não consegue determinar", que é honesto
    const quote = quoteDelivery({ ...base, mode: "distance", toArrange: true });
    expect(quote.toArrange).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @menuclick/api exec vitest run test/delivery-quote.unit.test.ts
```

Esperado: FAIL — `quoteDelivery` não existe.

- [ ] **Step 3: Implementar**

Em `src/domain/delivery.ts`:

```ts
export type DeliveryQuoteInput = {
  mode: DeliveryFeeMode;
  fixedFeeInCents: number;
  freeAboveInCents?: number;
  toArrange: boolean;
  neighborhoods: DeliveryNeighborhood[];
  addressNeighborhood: string;
  /** Só os itens. Nunca o total — ver o comentário de `quoteDelivery`. */
  subtotalInCents: number;
};

export type DeliveryQuote = {
  deliversTo: boolean;
  /** `null` quando não entrega ou quando é "a combinar". `0` é grátis. */
  feeInCents: number | null;
  isFree: boolean;
  toArrange: boolean;
};

/**
 * Quanto custa entregar neste endereço — ou se dá para entregar.
 *
 * A ordem das decisões importa e não é arbitrária:
 *
 * 1. **Descobrir a taxa base pelo modo.** Só aqui se decide se a loja atende o
 *    endereço. Modo sem configuração (bairro sem lista, distância sem faixas)
 *    **não** é taxa zero: é ausência de serviço. Tratar vazio como zero faria a
 *    loja entregar de graça para a cidade inteira por esquecimento.
 * 2. **Se não deu para determinar**, o `toArrange` da loja decide entre aceitar
 *    para acertar por fora e recusar.
 * 3. **Só então aplicar o "grátis acima de X".** É desconto sobre um frete que
 *    já se sabe calcular — não uma licença para entregar onde a loja não
 *    atende. Por isso ele não roda antes do passo 1.
 *
 * ⚠️ O "grátis acima de X" compara com o **subtotal dos itens**, nunca com o
 * total. Comparar com o total seria circular: o total inclui o frete, que é
 * justamente o que está sendo decidido.
 */
export function quoteDelivery(input: DeliveryQuoteInput): DeliveryQuote {
  const base = taxaBase(input);

  if (base === undefined) {
    return input.toArrange
      ? { deliversTo: true, feeInCents: null, isFree: false, toArrange: true }
      : { deliversTo: false, feeInCents: null, isFree: false, toArrange: false };
  }

  // o limite é inclusivo: "grátis acima de R$ 50" com pedido de R$ 50 é grátis.
  // Exclusivo faria o cliente de R$ 50,00 pagar frete e o de R$ 50,01 não, o
  // que ninguém consegue explicar no balcão.
  const gratisPorValor =
    input.freeAboveInCents !== undefined &&
    input.subtotalInCents >= input.freeAboveInCents;

  const fee = gratisPorValor ? 0 : base;
  return { deliversTo: true, feeInCents: fee, isFree: fee === 0, toArrange: false };
}

/** A taxa antes de qualquer promoção. `undefined` = não deu para determinar. */
function taxaBase(input: DeliveryQuoteInput): number | undefined {
  if (input.mode === "fixed") return input.fixedFeeInCents;

  if (input.mode === "neighborhood") {
    const alvo = normalizeNeighborhood(input.addressNeighborhood);
    const achado = input.neighborhoods.find(
      (bairro) => normalizeNeighborhood(bairro.name) === alvo,
    );
    return achado?.feeInCents;
  }

  // `distance` chega na Parte 2, com as faixas de km e o Nominatim. Até lá cai
  // no caminho de "não consegue determinar" — que é o comportamento honesto, e
  // o motivo de o schema da rota ainda não oferecer este modo.
  return undefined;
}
```

- [ ] **Step 4: Rodar, type-check, lint**

Esperado: PASS, 11 testes.

- [ ] **Step 5: Verificar por mutação**

Mova a aplicação do "grátis acima de X" para **antes** do `taxaBase`.
Esperado: **FALHA** em "não resgata endereço que a loja não atende".

Troque `>=` por `>` no `gratisPorValor`.
Esperado: **FALHA** em "o limite é inclusivo".

Faça `taxaBase` devolver `0` em vez de `undefined` no modo bairro sem lista.
Esperado: **FALHA** em "modo bairro SEM bairro cadastrado não é frete zero".

- [ ] **Step 6: Commit**

```
feat(delivery): ✨ calcula o frete por bairro, taxa fixa e grátis acima de X
```

---

### Task 5: O endpoint de cotação

**Files:**
- Create: `apps/api/src/services/delivery.ts`, `apps/api/test/delivery-quote.test.ts`
- Modify: `apps/api/src/routes/menu.ts`, `apps/api/src/limits.ts`

**Interfaces:**
- Consome: `quoteDelivery` (Task 4), `findByRestaurant` dos bairros (Task 3).
- Produz: `deliveryService.quote(slug, address, subtotalInCents)` — para a rota pública, que só tem o slug.

⚠️ A Task 6 **não** reusa esta função: ela acrescenta uma irmã,
`quoteForOrder(restaurant, type, address, subtotalInCents, client)`. Os dois
caminhos chamam o mesmo `quoteDelivery` do domínio, mas partem de pontos
diferentes — a criação do pedido já resolveu o restaurante e já está dentro de
uma transação, então buscá-lo de novo pelo slug seria uma query a mais e uma
leitura fora da transação.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("cota o frete pelo bairro, sem precisar de sessão", async () => {
  const restaurant = await createRestaurant(app, { slug: "cota" });
  await app.inject({ method: "PATCH", url: `/restaurants/${restaurant.id}`,
    headers: restaurant.headers, payload: { deliveryFeeMode: "neighborhood" } });
  await setDeliveryNeighborhoods(app, restaurant, [
    { name: "Centro", feeInCents: 500 },
  ]);

  // sem headers: a rota é pública, como o cardápio
  const response = await app.inject({
    method: "POST",
    url: "/menu/cota/delivery-quote",
    payload: { address: validDeliveryAddress, subtotalInCents: 3000 },
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ deliversTo: true, isFree: false });
});

it("devolve a lista de bairros atendidos, para a tela oferecer seletor", async () => {
  // ... modo bairro com dois bairros
  expect(response.json().servedNeighborhoods).toEqual(["Centro", "Jardim América"]);
});

it("slug que não existe responde 404", async () => {
  const response = await app.inject({
    method: "POST", url: "/menu/nao-existe/delivery-quote",
    payload: { address: validDeliveryAddress, subtotalInCents: 1000 },
  });
  expect(response.statusCode).toBe(404);
});

it("não devolve nada além do que a cotação precisa", async () => {
  // a resposta é superfície pública: o schema decide o que sai (S10)
  const corpo = response.json();
  expect(Object.keys(corpo).sort()).toEqual(
    ["deliversTo", "feeInCents", "isFree", "servedNeighborhoods", "toArrange"].sort(),
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: O serviço**

`src/services/delivery.ts` resolve o restaurante pelo slug (404 se não existe),
busca os bairros quando o modo é `neighborhood`, e chama `quoteDelivery`.

⚠️ **Só busca bairros no modo que os usa.** Buscar sempre custaria uma query
inútil em toda cotação de taxa fixa.

- [ ] **Step 4: A rota**

Em `routes/menu.ts`, `POST /menu/:slug/delivery-quote`, com
`config: { public: true }`.

⚠️ **O endereço vai no CORPO, não na querystring.** URL entra em log de acesso,
de proxy e no histórico do navegador; endereço de cliente não deve morar lá — é
o mesmo raciocínio do S21 sobre credencial em URL.

O `schema.response` do 200 declara exatamente os cinco campos, e o 404 usa o
`errorResponseSchema` compartilhado.

- [ ] **Step 5: Teto próprio da rota**

Em `limits.ts`:

```ts
/**
 * A cotação é anônima e vai disparar chamada externa na Parte 2 (Nominatim,
 * que limita 1 req/s e bane quem abusa). Teto próprio pelo mesmo motivo do
 * `/auth/login` (S25): rota anônima e cara não pode dividir o teto geral com
 * as baratas.
 */
export const DELIVERY_QUOTE_RATE_LIMIT_MAX = 20;
```

Aplicado como `config.rateLimit` da rota, do mesmo jeito que o login faz.

- [ ] **Step 6: Rodar, type-check, lint, OpenAPI**

- [ ] **Step 7: Verificar por mutação**

Tire `servedNeighborhoods` do `schema.response`.
Esperado: **FALHA** no teste do seletor — e é a demonstração de que o schema
filtra a saída de verdade.

Tire o `config: { public: true }`.
Esperado: **FALHA** com 401 — a rota nasce fechada (S17).

- [ ] **Step 8: Commit**

```
feat(menu): ✨ cota o frete antes de o cliente montar o pedido
```

---

### Task 6: O frete no pedido

**Files:**
- Modify: `apps/api/src/domain/order.ts`, `apps/api/src/repositories/orders.ts`, `apps/api/src/services/orders.ts`, `apps/api/src/routes/orders.ts`, `apps/api/src/routes/tracking.ts`
- Test: `apps/api/test/delivery-quote.test.ts` (seção nova)

**Interfaces:**
- Consome: `deliveryService` (Task 5).
- Produz: `order.deliveryFeeInCents` nas cinco superfícies, e
  `deliveryService.quoteForOrder(restaurant, type, address, subtotalInCents, client)`.

⚠️ `quoteForOrder` devolve `{ deliversTo: true, feeInCents: null }` quando o
pedido **não** é `delivery`, sem consultar nada: salão e retirada não têm frete,
e o `check` do banco recusaria um valor ali de qualquer forma.

🚨 **Esta tarefa toca CINCO superfícies de leitura**, e a PR dos grupos de
opções embarcou um defeito por esquecer uma delas — o recibo do cliente ficou
com valores velhos e não fechava com o próprio total, depois de nove revisões
passarem. As cinco: criação, detalhe do restaurante, **listagem do
restaurante**, recibo do cliente (`routes/tracking.ts`) e o `openapi.json`.

O WebSocket **não** muda: ele transmite mudança de estado, não conteúdo.

⚠️ **Busque uma resposta real de cada uma das cinco antes de commitar.** Ler o
diff foi exatamente o que falhou da outra vez.

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("soma o frete no total e guarda o valor congelado", async () => {
  // loja em modo bairro, Centro = R$ 5,00; produto de R$ 30,00
  const response = await pedirEntrega(restaurant, produto, { quantity: 2 });

  const corpo = response.json();
  expect(corpo.deliveryFeeInCents).toBe(500);
  // 2 x 3000 + 500
  expect(corpo.totalInCents).toBe(6500);
  const soma = corpo.items.reduce((s, i) => s + i.unitPriceInCents * i.quantity, 0);
  expect(soma + corpo.deliveryFeeInCents).toBe(corpo.totalInCents);
});

it("recusa com 409 quando a loja não entrega naquele endereço", async () => {
  // modo bairro, lista só com "Centro", endereço em outro bairro, toArrange off
  expect(response.statusCode).toBe(409);
});

it("aceita com frete nulo quando a loja escolheu 'a combinar'", async () => {
  expect(response.json().deliveryFeeInCents).toBeNull();
  // o total é só os itens: não há frete para somar
  expect(response.json().totalInCents).toBe(6000);
});

it("pedido que não é entrega não tem frete", async () => {
  // takeaway
  expect(response.json().deliveryFeeInCents).toBeNull();
});

it("o troco é conferido contra o total COM frete", async () => {
  // itens 3000 + frete 500 = 3500; troco de 3200 não cobre
  expect(response.statusCode).toBe(400);
  expect(response.json().message).toContain("3500");
});

it("ignora um frete mandado no corpo", async () => {
  // mesmo raciocínio do totalInCents: quem paga não escolhe o preço
  const response = await pedirEntrega(restaurant, produto, {
    deliveryFeeInCents: 1,
  });
  expect(response.json().deliveryFeeInCents).toBe(500);
});

it("o recibo do cliente fecha com o próprio total", async () => {
  // GET /orders/:id?token= — a superfície que quebrou da última vez
  const recibo = await app.inject({ method: "GET", url: `/orders/${id}?token=${token}` });
  const corpo = recibo.json();
  const soma = corpo.items.reduce((s, i) => s + i.unitPriceInCents * i.quantity, 0);
  expect(soma + (corpo.deliveryFeeInCents ?? 0)).toBe(corpo.totalInCents);
});

it("a listagem do restaurante mostra o frete", async () => {
  const lista = await app.inject({ method: "GET",
    url: `/restaurants/${restaurant.id}/orders`, headers: restaurant.headers });
  expect(lista.json().data[0].deliveryFeeInCents).toBe(500);
});
```

- [ ] **Step 2: Rodar e ver falhar**

- [ ] **Step 3: O serviço**

Em `services/orders.ts`, dentro da transação de criação, **depois** de calcular
o subtotal dos itens e **antes** do `assertTrocoCoerente`:

```ts
// O frete sai da mesma cotação que o endpoint público usa, recalculada aqui:
// aquele endpoint informa, esta criação decide. Entre cotar e pedir cabe o
// tempo de montar o carrinho, e cabe um cliente batendo direto na API.
const frete = await deliveryService.quoteForOrder(
  restaurant,
  input.type,
  input.deliveryAddress,
  subtotalInCents,
  client,
);

if (!frete.deliversTo) {
  throw new ConflictError(
    "A loja não entrega neste endereço",
  );
}

// null quando é "a combinar" ou quando não é entrega: não há o que somar
const totalInCents = subtotalInCents + (frete.feeInCents ?? 0);
assertTrocoCoerente(input.paymentMethod, input.changeForInCents, totalInCents);
```

⚠️ Renomeie a variável de hoje (`totalInCents`, a soma dos itens) para
`subtotalInCents`. O nome antigo passaria a mentir.

- [ ] **Step 4: Repositório e schemas**

`insertOrder` grava `delivery_fee_in_cents`; o tipo de linha e o mapper leem.
Como listagem e detalhe usam o mesmo `selectOrderWithCustomer`, os dois ganham
o campo de uma vez — mas o `trackedOrderResponseSchema` de `routes/tracking.ts`
é **separado**, e é exatamente o que ficou para trás da última vez.

- [ ] **Step 5: As cinco superfícies, no fio**

Crie um pedido de entrega real e busque-o de volta de cada uma:

```bash
# criação, detalhe, listagem, recibo, e o openapi
```

Registre no relatório o `totalInCents`, o `deliveryFeeInCents` e a soma dos
itens vista em **cada** uma, e confirme que fecham.

- [ ] **Step 6: Rodar a suíte inteira**

⚠️ Testes antigos de pedido de entrega vão quebrar se algum deles afirmar
`Σ itens = total`. Isso é **sinal, não trabalho de edição**: a invariante mudou
de propósito. Ajuste a asserção para `Σ itens + frete = total` — e se um teste
não for sobre frete, prefira deixar a loja em taxa fixa 0 (o default) a mexer
na asserção.

- [ ] **Step 7: Verificar por mutação**

Tire o `+ (frete.feeInCents ?? 0)` do total.
Esperado: **FALHA** em "soma o frete no total".

Passe `subtotalInCents` para o `assertTrocoCoerente` em vez do total.
Esperado: **FALHA** em "o troco é conferido contra o total COM frete".

Tire `deliveryFeeInCents` do `trackedOrderResponseSchema`.
Esperado: **FALHA** em "o recibo do cliente fecha com o próprio total".

- [ ] **Step 8: OpenAPI, suíte, commit**

```
feat(orders)!: ✨ cobra o frete no pedido de entrega

BREAKING CHANGE: `totalInCents` passa a incluir o frete nos pedidos de entrega.
Até aqui toda leitura satisfazia `Σ(unitPrice × quantity) = total`; agora os de
entrega satisfazem `Σ(unitPrice × quantity) + frete = total`.
```

---

### Task 7: Cardápio, seed, e2e e documentação

**Files:**
- Modify: `apps/api/src/domain/menu.ts`, `apps/api/src/services/menu.ts`, `apps/api/src/routes/menu.ts`, `apps/api/src/db/seed.sql`, `CLAUDE.md`

- [ ] **Step 1: O cardápio anuncia o frete**

`MenuRestaurant` ganha `deliveryFeeMode` e `freeDeliveryAboveInCents`, para a
tela poder dizer "frete grátis acima de R$ 50" antes de a pessoa montar o
carrinho.

⚠️ `MenuRestaurant` é um `Pick` explícito desde a feature de horário, **não** um
`Omit`. Campo novo em `Restaurant` **não** chega ao cardápio sozinho: entre nos
três lugares (o `Pick`, o `toMenuRestaurant` e o `menuRestaurantResponseSchema`)
ou ele some sem erro e sem teste vermelho.

⚠️ As colunas de configuração **crua** (`deliveryFixedFeeInCents`,
`deliveryFeeToArrange`) **não** entram: o cliente não precisa saber a taxa base
antes de informar o endereço, e a cotação já devolve o número certo (S10).

- [ ] **Step 2: Seed**

Os restaurantes de exemplo ganham configuração de frete — um em modo bairro com
três bairros, outro em taxa fixa com "grátis acima de X" —, com ids fixos e
`on conflict do nothing`. Verifique rodando `db:seed` **duas vezes** e
confirmando contagens idênticas.

- [ ] **Step 3: E2E adversarial**

Percorra como cliente e como loja: configura o frete, cota um endereço atendido
e um não atendido, cria o pedido, e lê de volta das quatro superfícies
comparando os **números entre si** — não só a presença dos campos. Se achar
divergência, reporte com destaque em vez de corrigir quieto.

- [ ] **Step 4: Documentação**

Seção nova no `CLAUDE.md`, no estilo do arquivo (explica **por quê** e o que
quebra na alternativa, não o que o código faz). Pontos que vão enganar alguém
depois:

- `total_in_cents` **inclui** o frete; a invariante da soma dos itens mudou.
- Os três estados do frete: valor, `0` (grátis), `null` (a combinar).
- Configuração ausente **não** é frete zero.
- "Grátis acima de X" compara com o **subtotal**.
- O modo `distance` existe no banco mas **não** é oferecido pelo schema da rota
  até a Parte 2 — e por quê.
- A cotação informa; a criação decide.

- [ ] **Step 5: Commits separados**

Seed/e2e e documentação são mudanças lógicas diferentes: dois commits.
