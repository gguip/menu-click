# Horário, pausa e forma de pagamento — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir pedido fora do horário e fazer o restaurante saber como cada pedido será pago.

**Architecture:** Uma tabela `opening_hours` com faixas por dia da semana (várias por dia, e uma faixa pode atravessar a meia-noite), mais uma pausa manual no restaurante. "Está aberto?" é calculado **no Postgres**, no fuso do restaurante, pelo mesmo motivo do filtro de período do painel. Pagamento espelha o padrão que já existe para modalidade: flags booleanas no restaurante, campo no pedido, recusa 409.

**Tech Stack:** TypeScript nativo no Node (type stripping, imports com `.ts`, sem `enum`), Fastify 5, Postgres via `pg` sem ORM, node-pg-migrate com SQL puro, Vitest contra Postgres real.

**Spec:** `docs/superpowers/specs/2026-09-04-horario-e-pagamento-design.md`

## Global Constraints

Valem para **toda** tarefa. Vêm de `CLAUDE.md` e `.claude/rules/`.

- **Node >= 23.6**, TypeScript executado direto: imports locais **com extensão `.ts`**, `import type` para tipos, **sem `enum`** (uniões `as const`), sem parameter properties.
- **Soft delete obrigatório (D1/D2):** nenhum `delete from` no código da aplicação; toda leitura filtra `deleted_at is null`.
- **Cascata explícita e transacional (D3):** sem `on delete cascade`; dentro de transação use sempre o `client` recebido.
- **Índices parciais (D5) e unicidade parcial (D6):** `where deleted_at is null`.
- **Ordenação determinística (D11):** `order by <campo>, id`.
- **`snake_case` no banco, `camelCase` na API (D12)**, traduzido por mapper; `isUuid()` antes de consultar por id (D14/S9).
- ⚠️ **D13 (`timestamptz` sempre) não se aplica a `opens_at`/`closes_at`.** Eles são `time`: hora de parede, deliberadamente sem fuso, e o fuso entra na comparação vindo de `restaurants.timezone`. A regra existe para **instantes**; aqui não há instante. Está justificado na spec — não "corrija" para `timestamptz`.
- **Migration só por `migrate:create` (D21)**, nunca `if not exists` (D18), com `Down` que desfaz de verdade (D17), e no mesmo commit do código (D20).
- **Todo valor do cliente vai como `$n` (S1/S2).** Identificador nunca é parametrizável: allowlist/mapa fixo (S3).
- **`schema.response` por status code é obrigatório (F10/S10)** e é controle de segurança.
- **Erro de negócio nunca vira status na rota (S11):** o serviço lança `NotFoundError`/`ConflictError`/`ValidationError` e o `setErrorHandler` do `app.ts` traduz.
- **Rota nasce fechada (S17).** Rota escopada em restaurante **precisa** chamar o parâmetro de `restaurantId` (S18). Recurso de outro dono é 404 (S19).
- **Toda rota declara `tags`, `summary`, `description` e `operationId`**, e `pnpm --filter @menuclick/api openapi:generate` roda no mesmo commit.
- **Comentários e docs em pt-BR; identificadores em inglês.**
- **Commits:** `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, **verbo no presente do indicativo**, minúscula, sem ponto final.
- **Toda garantia nova é verificada por mutação:** quebre o código que a sustenta e confirme que o teste falha. Garantia cuja mutação não acusa é **documentada como tal**, nunca prometida.
- **Sem dependência nova.**

### Conferência de conformidade (aprendida em execução)

Antes de despachar a Task 1, passe os artefatos que este plano prescreve — nomes de identificador, mensagens de commit, formato de teste — contra `.claude/rules/` e o `CLAUDE.md`. No plano anterior, três defeitos chegaram à revisão por falta desse passo, e os três eram mecanicamente detectáveis.

### Comandos

```bash
unset -f node pnpm                                          # nvm define funções que recursam
pnpm --filter @menuclick/api migrate:create <nome>
pnpm --filter @menuclick/api build                          # tsc --noEmit
pnpm --filter @menuclick/api test                           # vitest run
pnpm --filter @menuclick/api exec vitest run test/<arquivo>
pnpm --filter @menuclick/api openapi:generate
pnpm lint                                                    # da raiz
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
```

O banco de teste **não** é re-migrado se já existir: derrube-o antes de rodar a suíte depois de escrever migration.

Postgres roda em Docker como `capstone-db`, usuário `postgres`. Use `docker exec -i capstone-db psql -U postgres -d <db> -qtA -c "…"`; **nunca** `dropdb`/`createdb` do host, que travam pedindo senha.

Arquivos de teste usam **um `describe` de topo** — `app.close()` dispara um `onClose` que chama `pool.end()` no pool singleton, então um segundo bloco de topo encontra o pool fechado.

⚠️ **Nunca deixe um loop de verificação rodando em background.** Um deles, contra o mesmo banco de teste, produziu 174 falhas fantasma numa execução alheia.

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `apps/api/migrations/<ts>_add-opening-hours-and-payment.sql` | a tabela, a pausa, as 4 flags e os 2 campos do pedido |
| `apps/api/src/domain/opening-hours.ts` | tipos das faixas + `WEEKDAYS` |
| `apps/api/src/domain/payment.ts` | `PAYMENT_METHODS` e o tipo |
| `apps/api/src/repositories/opening-hours.ts` | SQL das faixas e a checagem de "aberto agora" |
| `apps/api/src/services/opening-hours.ts` | regras das faixas |
| `apps/api/src/routes/opening-hours.ts` | `PUT` e `GET` da grade |
| `apps/api/test/opening-hours.test.ts` | CRUD da grade |
| `apps/api/test/store-open.test.ts` | "está aberto?" — fuso, meia-noite, pausa, e o bloqueio na criação |
| `apps/api/test/orders-payment.test.ts` | forma de pagamento e troco |

**Modificar:**

| Arquivo | O quê |
| --- | --- |
| `apps/api/src/domain/restaurant.ts` | `acceptingOrders` + as 4 flags |
| `apps/api/src/domain/order.ts` | `paymentMethod`, `changeForInCents` |
| `apps/api/src/domain/menu.ts` | `MenuRestaurant` ganha `isOpen`, `openingHours`, `paymentMethods` |
| `apps/api/src/repositories/restaurants.ts` | linha, mapper, mapa de colunas, insert |
| `apps/api/src/repositories/orders.ts` | grava e lê os 2 campos |
| `apps/api/src/services/restaurants.ts` | cascata alcança `opening_hours` |
| `apps/api/src/services/orders.ts` | valida pagamento e recusa loja fechada |
| `apps/api/src/services/menu.ts` | compõe `isOpen` e `paymentMethods` |
| `apps/api/src/routes/schemas.ts` | corpo/resposta do restaurante |
| `apps/api/src/routes/orders.ts` | corpo e respostas do pedido |
| `apps/api/src/routes/menu.ts` | resposta do restaurante público |
| `apps/api/src/routes/tracking.ts` | recibo do cliente |
| `apps/api/src/app.ts`, `src/openapi.ts` | registro e tag |
| `apps/api/src/db/seed.sql`, `CLAUDE.md`, `test/helpers.ts` | exemplo, documentação, helpers |

---

### Task 1: A migration

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-opening-hours-and-payment.sql` (gerado pelo comando, nunca à mão)

**Interfaces:**
- Consumes: nada.
- Produces: tabela `opening_hours`; `restaurants.accepting_orders`, `.accepts_cash`, `.accepts_card_on_delivery`, `.accepts_pix`, `.accepts_meal_voucher`; `orders.payment_method`, `.change_for_in_cents`.

- [ ] **Step 1: Criar o arquivo pelo comando**

```bash
unset -f node pnpm
pnpm --filter @menuclick/api migrate:create add-opening-hours-and-payment
```

- [ ] **Step 2: Escrever o `Up` e o `Down`**

```sql
-- Up Migration

-- O horário de funcionamento. Até aqui `restaurants` não tinha nenhuma coluna
-- de horário: dava para pedir às 4 da manhã, e o restaurante descobria o
-- pedido ao abrir.

create table opening_hours (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references restaurants (id),
  -- 0 = domingo … 6 = sábado, igual ao `extract(dow from ...)` do Postgres.
  -- Alinhar com o Postgres e não com o JavaScript não é gosto: a checagem de
  -- "está aberto agora?" roda no banco, e converter no meio seria mais um
  -- lugar para errar por um.
  weekday       integer     not null check (weekday between 0 and 6),
  -- `time`, e NÃO `timestamptz`: isto é hora de parede, deliberadamente sem
  -- fuso. O fuso entra na comparação, vindo de `restaurants.timezone`. A D13
  -- existe para INSTANTES, e aqui não há instante — guardar como timestamptz
  -- exigiria inventar uma data para informação que não tem data.
  opens_at      time        not null,
  closes_at     time        not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- Faixa de duração zero não significa nada. `closes_at < opens_at` NÃO é
  -- erro: significa que fecha no dia seguinte (18:00–02:00 é a pizzaria que
  -- atende até as duas). Por isso só a igualdade é proibida.
  constraint opening_hours_range_check check (opens_at <> closes_at)
);

create index opening_hours_active_by_restaurant_idx
  on opening_hours (restaurant_id, weekday, opens_at)
  where deleted_at is null;

-- A pausa manual. Fecha a loja na hora, sem tocar no horário cadastrado — é o
-- caso real mais frequente (cozinha lotada, faltou insumo). Sem ela, a única
-- saída do restaurante é editar o horário e lembrar de desfazer depois.
--
-- O nome é positivo (`accepting_orders`, não `paused`) porque é assim que o
-- código o lê o tempo todo, e negativa dupla em condição é onde nasce erro.
alter table restaurants
  add column accepting_orders boolean not null default true;

-- O que o restaurante aceita como pagamento. Colunas planas espelhando
-- `is_delivery`/`is_takeaway`/`is_qrcode`, que já resolveram exatamente esta
-- forma de problema neste projeto.
--
-- `accepts_meal_voucher` nasce false porque vale-refeição exige credenciamento
-- com a bandeira: quem tem, liga; os outros não descobrem um "sim" que não
-- conseguem honrar.
alter table restaurants
  add column accepts_cash             boolean not null default true,
  add column accepts_card_on_delivery boolean not null default true,
  add column accepts_pix              boolean not null default true,
  add column accepts_meal_voucher     boolean not null default false;

-- Como o pedido será pago. O default existe SÓ para a coluna poder nascer
-- `not null` num banco com pedidos; a rota exige o campo. Pedido antigo fica
-- `cash`, o palpite menos errado para delivery brasileiro anterior a isto.
alter table orders
  add column payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card_on_delivery', 'pix', 'meal_voucher')),
  -- "troco para R$ 50". Só faz sentido em dinheiro, e o check garante isso no
  -- banco — sem ele, um pedido no Pix poderia carregar troco e ninguém veria.
  add column change_for_in_cents integer,
  add constraint orders_change_for_check check (
    change_for_in_cents is null
    or (payment_method = 'cash' and change_for_in_cents >= 0)
  );

-- Down Migration

alter table orders
  drop constraint orders_change_for_check,
  drop column change_for_in_cents,
  drop column payment_method;

alter table restaurants
  drop column accepts_meal_voucher,
  drop column accepts_pix,
  drop column accepts_card_on_delivery,
  drop column accepts_cash,
  drop column accepting_orders;

drop index opening_hours_active_by_restaurant_idx;
drop table opening_hours;
```

- [ ] **Step 3: Verificar `up` → `down` → `up` num banco descartável, com dado**

```bash
unset -f node pnpm
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_hp with (force)'
docker exec capstone-db psql -U postgres -q -c 'create database capstone_hp'
export DB_NAME=capstone_hp
pnpm --filter @menuclick/api migrate:up | tail -1
```

Agora exercite **cada `check`** numa chamada `psql` **separada** — dois statements num `-c` só ficam na mesma transação implícita, e a falha do primeiro desfaz o insert de que o segundo depende (isso já custou uma correção neste projeto):

```bash
p() { docker exec -i capstone-db psql -U postgres -d capstone_hp -qtA -c "$1"; }
p "insert into restaurants (id,name,slug,cuisine_type,street,number,neighborhood,city,state,zip_code,is_delivery,is_takeaway,is_qrcode) values ('11111111-1111-1111-1111-111111111111','R','r','J','x','1','y','z','SP','0',true,true,true)"
# weekday fora da faixa
p "insert into opening_hours (restaurant_id,weekday,opens_at,closes_at) values ('11111111-1111-1111-1111-111111111111',7,'11:00','15:00')"
# faixa de duração zero
p "insert into opening_hours (restaurant_id,weekday,opens_at,closes_at) values ('11111111-1111-1111-1111-111111111111',1,'11:00','11:00')"
# faixa que atravessa a meia-noite: DEVE ser aceita
p "insert into opening_hours (restaurant_id,weekday,opens_at,closes_at) values ('11111111-1111-1111-1111-111111111111',1,'18:00','02:00')"
```

Esperado, em ordem: sucesso; `violates check constraint "opening_hours_weekday_check"`; `violates check constraint "opening_hours_range_check"`; **sucesso** (a faixa noturna não é erro).

```bash
pnpm --filter @menuclick/api migrate:down | tail -1
p "select to_regclass('opening_hours') is null as sumiu"
pnpm --filter @menuclick/api migrate:up | tail -1
docker exec capstone-db psql -U postgres -q -c 'drop database capstone_hp with (force)'
unset DB_NAME
```

- [ ] **Step 4: Recriar o banco de teste e rodar a suíte**

```bash
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
pnpm --filter @menuclick/api test
```

Esperado: PASS, sem mudança — a migration ainda não muda comportamento.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/
git commit -m "feat(restaurants): ✨ cria o horário de funcionamento e o pagamento

A tabela guarda faixas por dia da semana, várias por dia, porque restaurante
que fecha entre almoço e jantar é o caso comum — com uma faixa por dia ele
declararia 11:00-23:00 e aceitaria pedido às 16:00.

\`closes_at < opens_at\` NÃO é erro: significa que fecha no dia seguinte, que é
metade do mercado de delivery noturno.

As horas são \`time\` e não \`timestamptz\` porque são hora de parede: o fuso
entra na comparação, vindo de restaurants.timezone. A D13 vale para instantes."
```

---

### Task 2: A grade de horário (CRUD)

**Files:**
- Create: `apps/api/src/domain/opening-hours.ts`, `apps/api/src/repositories/opening-hours.ts`, `apps/api/src/services/opening-hours.ts`, `apps/api/src/routes/opening-hours.ts`, `apps/api/test/opening-hours.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/openapi.ts`, `apps/api/src/services/restaurants.ts`, `apps/api/test/helpers.ts`

**Interfaces:**
- Consumes: a tabela da Task 1.
- Produces:
  - `WEEKDAYS: readonly [0,1,2,3,4,5,6]`, `type Weekday`
  - `type OpeningHour = { id: string; restaurantId: string; weekday: Weekday; opensAt: string; closesAt: string; createdAt: string; updatedAt: string }`
  - `type OpeningHourInput = { weekday: Weekday; opensAt: string; closesAt: string }`
  - repositório: `replaceForRestaurant(restaurantId, faixas, client)`, `findByRestaurant(restaurantId, db?)`, `softDeleteByRestaurant(restaurantId, db)`
  - serviço: `replaceForRestaurant(restaurantId, faixas)`, `listByRestaurant(restaurantId)`
  - rota: `openingHoursRoutes(app)`
  - helper de teste: `setOpeningHours(app, restaurant, faixas)`

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/opening-hours.test.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";

/**
 * A grade de horário do restaurante.
 *
 * Um `PUT` define a semana inteira, como a tela faz: a pessoa edita a grade e
 * salva. Dia sem faixa é dia fechado — a ausência é a informação, e uma flag
 * de "fechado" permitiria o estado incoerente de "fechado, das 11 às 15".
 */
describe("grade de horário", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("define a semana e devolve na ordem", async () => {
    const restaurant = await createRestaurant(app);

    const response = await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
      { weekday: 2, opensAt: "11:00", closesAt: "15:00" },
    ]);

    expect(response.statusCode).toBe(200);
    expect(
      response.json().openingHours.map((f: { weekday: number; opensAt: string }) =>
        `${f.weekday} ${f.opensAt}`,
      ),
    ).toEqual(["1 11:00", "1 18:00", "2 11:00"]);
  });

  it("várias faixas no mesmo dia — a pausa da tarde", async () => {
    const restaurant = await createRestaurant(app);

    const response = await setOpeningHours(app, restaurant, [
      { weekday: 3, opensAt: "11:00", closesAt: "15:00" },
      { weekday: 3, opensAt: "18:00", closesAt: "23:00" },
    ]);

    expect(response.json().openingHours).toHaveLength(2);
  });

  /** Metade do delivery noturno. Não é erro de digitação. */
  it("aceita faixa que atravessa a meia-noite", async () => {
    const restaurant = await createRestaurant(app);

    const response = await setOpeningHours(app, restaurant, [
      { weekday: 5, opensAt: "18:00", closesAt: "02:00" },
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json().openingHours[0]).toMatchObject({
      opensAt: "18:00",
      closesAt: "02:00",
    });
  });

  it("é idempotente: mandar a mesma grade duas vezes não duplica", async () => {
    const restaurant = await createRestaurant(app);
    const grade = [{ weekday: 1, opensAt: "11:00", closesAt: "15:00" }];

    await setOpeningHours(app, restaurant, grade);
    const segunda = await setOpeningHours(app, restaurant, grade);

    expect(segunda.json().openingHours).toHaveLength(1);
  });

  it("lista vazia fecha a semana inteira", async () => {
    const restaurant = await createRestaurant(app);
    await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
    ]);

    const response = await setOpeningHours(app, restaurant, []);

    expect(response.json().openingHours).toEqual([]);
  });

  it("GET devolve a grade gravada", async () => {
    const restaurant = await createRestaurant(app);
    await setOpeningHours(app, restaurant, [
      { weekday: 0, opensAt: "12:00", closesAt: "20:00" },
    ]);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/opening-hours`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().openingHours).toHaveLength(1);
  });

  describe("entradas recusadas", () => {
    it("400 com weekday fora de 0–6", async () => {
      const restaurant = await createRestaurant(app);

      const response = await setOpeningHours(app, restaurant, [
        { weekday: 7, opensAt: "11:00", closesAt: "15:00" },
      ]);

      expect(response.statusCode).toBe(400);
    });

    it("400 com abertura igual ao fechamento", async () => {
      const restaurant = await createRestaurant(app);

      const response = await setOpeningHours(app, restaurant, [
        { weekday: 1, opensAt: "11:00", closesAt: "11:00" },
      ]);

      expect(response.statusCode).toBe(400);
    });

    it("400 com hora fora do formato HH:MM", async () => {
      const restaurant = await createRestaurant(app);

      const response = await setOpeningHours(app, restaurant, [
        { weekday: 1, opensAt: "11h", closesAt: "15:00" },
      ]);

      expect(response.statusCode).toBe(400);
    });
  });

  it("a grade de outro restaurante é 404", async () => {
    const dono = await createRestaurant(app);
    const intruso = await createRestaurant(app);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${dono.id}/opening-hours`,
      headers: intruso.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("remover o restaurante remove a grade (D3)", async () => {
    const restaurant = await createRestaurant(app);
    await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "11:00", closesAt: "15:00" },
    ]);

    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
    });

    const { rows } = await pool.query<{ n: string }>(
      `select count(*) as n from opening_hours
        where restaurant_id = $1 and deleted_at is null`,
      [restaurant.id],
    );
    expect(Number(rows[0].n)).toBe(0);
  });
});
```

E o helper em `apps/api/test/helpers.ts`:

```ts
/** Define a grade de horário inteira de um restaurante, via API. */
export function setOpeningHours(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  openingHours: { weekday: number; opensAt: string; closesAt: string }[],
) {
  return app.inject({
    method: "PUT",
    url: `/restaurants/${restaurant.id}/opening-hours`,
    headers: restaurant.headers,
    payload: { openingHours },
  });
}
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node pnpm
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
pnpm --filter @menuclick/api exec vitest run test/opening-hours.test.ts
```

Esperado: FAIL — 404 em tudo, a rota não existe.

- [ ] **Step 3: O domínio**

Crie `apps/api/src/domain/opening-hours.ts`:

```ts
/**
 * O horário de funcionamento — as faixas em que o restaurante aceita pedido.
 * Só tipos, mais a lista de dias.
 *
 * Um dia pode ter várias faixas (a pausa entre almoço e jantar), e **dia sem
 * faixa é dia fechado**: a ausência é a informação, e uma flag de "fechado"
 * permitiria o estado incoerente de "fechado, das 11 às 15".
 */

/**
 * 0 = domingo … 6 = sábado.
 *
 * A numeração é a do `extract(dow from ...)` do Postgres, e não a do
 * JavaScript por acaso — as duas coincidem, mas quem manda aqui é o banco,
 * porque é lá que "está aberto agora?" é calculado.
 */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Uma faixa como o cliente a envia. Horas em `HH:MM`, no fuso do restaurante. */
export type OpeningHourInput = {
  weekday: Weekday;
  opensAt: string;
  closesAt: string;
};

/**
 * Uma faixa como está guardada.
 *
 * `closesAt` menor que `opensAt` significa que a faixa **atravessa a
 * meia-noite** — 18:00–02:00 é a pizzaria que atende até as duas. Não é erro
 * de digitação, e é por isso que só a igualdade entre as duas é proibida.
 */
export type OpeningHour = OpeningHourInput & {
  id: string;
  restaurantId: string;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 4: O repositório**

Crie `apps/api/src/repositories/opening-hours.ts`. Espelhe o estilo de `repositories/categories.ts` (tipo de linha em snake_case, mapper `toX`, `Queryable` opcional no fim). Duas particularidades:

```ts
/**
 * Troca a grade inteira pela informada.
 *
 * Apaga tudo e reinsere, em vez de calcular diferença — é o mesmo desenho do
 * `replaceProductLinks` do vínculo produto↔grupo, e pelo mesmo motivo: é
 * tabela de configuração, a rotatividade de linha não custa nada, e código que
 * calcula diferença é onde mora o bug que ninguém vê.
 *
 * Recebe o `client` porque as duas metades valem juntas ou não valem.
 */
export async function replaceForRestaurant(
  restaurantId: string,
  faixas: OpeningHourInput[],
  client: PoolClient,
): Promise<void> {
  await client.query(
    `update opening_hours set deleted_at = now()
      where restaurant_id = $1 and deleted_at is null`,
    [restaurantId],
  );

  if (faixas.length === 0) return;

  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const faixa of faixas) {
    values.push(restaurantId, faixa.weekday, faixa.opensAt, faixa.closesAt);
    // os `$n` saem do TAMANHO do array, nunca de algo vindo do cliente (S2)
    const n = values.length;
    tuples.push(`($${n - 3}, $${n - 2}, $${n - 1}, $${n})`);
  }

  await client.query(
    `insert into opening_hours (restaurant_id, weekday, opens_at, closes_at)
     values ${tuples.join(", ")}`,
    values,
  );
}
```

O mapper devolve as horas como `HH:MM`, não `HH:MM:SS`: o driver traz `time` como string `"18:00:00"`, e o contrato da API é `HH:MM`. Converta no mapper, num lugar só — `row.opens_at.slice(0, 5)`.

`findByRestaurant` ordena por `weekday, opens_at, id` (D11). `softDeleteByRestaurant(restaurantId, db)` existe para a cascata.

- [ ] **Step 5: O serviço**

Crie `apps/api/src/services/opening-hours.ts`, espelhando `services/categories.ts` (`restaurantsService.ensureExists` antes de tudo). A regra própria:

```ts
/**
 * Recusa faixa de duração zero.
 *
 * `closesAt < opensAt` é legítimo — significa que fecha no dia seguinte. Só a
 * igualdade não descreve nada. O `check` do banco é a rede de segurança; a
 * mensagem útil é escrita aqui.
 */
function assertFaixasValidas(faixas: OpeningHourInput[]): void {
  for (const faixa of faixas) {
    if (faixa.opensAt === faixa.closesAt) {
      throw new ValidationError(
        `A faixa de ${faixa.opensAt} não tem duração: abre e fecha na mesma hora`,
      );
    }
  }
}
```

`replaceForRestaurant` chama isso, depois abre `withTransaction` e delega ao repositório, e devolve a grade relida.

- [ ] **Step 6: As rotas**

Crie `apps/api/src/routes/opening-hours.ts`, com `installRouteValidators(app)`:

```ts
/** `HH:MM` em 24 horas. O `pattern` é o que recusa "11h" e "25:00". */
const timeSchema = { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" };

const openingHourSchema = {
  type: "object",
  additionalProperties: false,
  required: ["weekday", "opensAt", "closesAt"],
  properties: {
    weekday: { type: "integer", minimum: 0, maximum: 6 },
    opensAt: timeSchema,
    closesAt: timeSchema,
  },
};

const openingHoursBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["openingHours"],
  properties: {
    // lista vazia é válida e significa fechado todos os dias
    openingHours: { type: "array", items: openingHourSchema },
  },
};

const openingHoursResponseSchema = {
  type: "object",
  properties: {
    openingHours: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          weekday: { type: "integer" },
          opensAt: { type: "string" },
          closesAt: { type: "string" },
        },
      },
    },
  },
};
```

Duas rotas em `/restaurants/:restaurantId/opening-hours`: `PUT` (200) e `GET` (200), ambas com `404: errorResponseSchema` e `400` no `PUT`. Sem envelope de paginação — uma semana tem um punhado de faixas.

Registre `openingHoursRoutes` no `app.ts` e acrescente a tag em `openapi.ts`:

```ts
{
  name: "Horário",
  description:
    "As faixas em que o restaurante aceita pedido, no fuso dele. Dia sem " +
    "faixa é dia fechado, e uma faixa pode atravessar a meia-noite.",
},
```

- [ ] **Step 7: A cascata**

Em `src/services/restaurants.ts`, dentro da transação de `remove` que já existe, acrescente:

```ts
await openingHoursRepository.softDeleteByRestaurant(id, client);
```

- [ ] **Step 8: Rodar, type-check, lint**

```bash
pnpm --filter @menuclick/api build
pnpm --filter @menuclick/api exec vitest run test/opening-hours.test.ts
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
```

Esperado: PASS, 11 testes.

- [ ] **Step 9: Verificar por mutação**

Remova `softDeleteByRestaurant` da cascata do restaurante.
Esperado: **FALHA** em "remover o restaurante remove a grade (D3)".

Troque o `pattern` de `timeSchema` por `{ type: "string" }`.
Esperado: **FALHA** em "400 com hora fora do formato HH:MM".

Desfaça as duas.

- [ ] **Step 10: OpenAPI, suíte, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(restaurants): ✨ define a grade de horário do restaurante"
```

---

### Task 3: "Está aberto agora?" — a checagem e o cardápio

A tarefa mais sutil do plano: fuso, meia-noite e pausa se combinam aqui.

**Files:**
- Modify: `apps/api/src/repositories/opening-hours.ts`, `apps/api/src/domain/menu.ts`, `apps/api/src/services/menu.ts`, `apps/api/src/routes/menu.ts`, `apps/api/src/domain/restaurant.ts`, `apps/api/src/repositories/restaurants.ts`, `apps/api/src/routes/schemas.ts`
- Create: `apps/api/test/store-open.test.ts`

**Interfaces:**
- Consumes: `findByRestaurant` e a tabela (Task 2); `restaurants.timezone` (já existe).
- Produces:
  - repositório: `isOpenNow(restaurantId: string, timezone: string, db?): Promise<boolean>`
  - `Restaurant` ganha `acceptingOrders: boolean`
  - `MenuRestaurant` ganha `isOpen: boolean`, `acceptingOrders: boolean`, `openingHours: { weekday, opensAt, closesAt }[]`

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/store-open.test.ts`. Um helper fixa a grade em torno da hora **atual do restaurante**, para o teste valer a qualquer hora do dia — a lição do teste de fuso que falhava uma hora por dia:

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import { buildTestApp, createRestaurant, setOpeningHours } from "./helpers.ts";
import type { TestRestaurant } from "./helpers.ts";

/**
 * "A loja está aberta agora?"
 *
 * Três coisas se combinam aqui, e cada uma sozinha já é fonte de erro: o fuso
 * do restaurante, a faixa que atravessa a meia-noite, e a pausa manual.
 *
 * Os testes montam a grade a partir da hora ATUAL no fuso do restaurante, em
 * vez de horas fixas. Horas fixas fariam o teste passar de manhã e falhar à
 * noite — e este projeto já pagou por isso uma vez, com três testes que
 * assumiam que São Paulo e Manaus estão sempre na mesma data.
 */
describe("está aberto agora?", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Dia da semana e hora locais do restaurante, agora, direto do Postgres. */
  async function agoraNoFuso(timezone: string) {
    const { rows } = await pool.query<{ dow: number; hora: string }>(
      `select extract(dow from now() at time zone $1)::int as dow,
              to_char(now() at time zone $1, 'HH24:MI') as hora`,
      [timezone],
    );
    return rows[0];
  }

  /** Soma minutos a "HH:MM", dando a volta na meia-noite. */
  function somaMinutos(hora: string, minutos: number): string {
    const [h, m] = hora.split(":").map(Number);
    const total = (h * 60 + m + minutos + 1440 * 2) % 1440;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }

  async function isOpen(slug: string) {
    const response = await app.inject({ method: "GET", url: `/menu/${slug}` });
    return response.json();
  }

  it("aberto dentro da faixa", async () => {
    const restaurant = await createRestaurant(app, { slug: "aberta" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, -60), closesAt: somaMinutos(hora, 60) },
    ]);

    expect((await isOpen("aberta")).isOpen).toBe(true);
  });

  it("fechado fora da faixa", async () => {
    const restaurant = await createRestaurant(app, { slug: "fechada" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, 120), closesAt: somaMinutos(hora, 180) },
    ]);

    expect((await isOpen("fechada")).isOpen).toBe(false);
  });

  it("dia sem faixa é dia fechado", async () => {
    const restaurant = await createRestaurant(app, { slug: "sem-faixa" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    // faixa cadastrada no dia SEGUINTE, cobrindo a hora atual
    await setOpeningHours(app, restaurant, [
      {
        weekday: ((dow + 1) % 7) as 0,
        opensAt: somaMinutos(hora, -60),
        closesAt: somaMinutos(hora, 60),
      },
    ]);

    expect((await isOpen("sem-faixa")).isOpen).toBe(false);
  });

  /**
   * A pizzaria que atende até as duas. Aqui a faixa é cadastrada em ONTEM e
   * atravessa a meia-noite até depois da hora atual — só a lógica de
   * atravessamento faz isso responder "aberto".
   */
  it("faixa que atravessa a meia-noite vale na madrugada seguinte", async () => {
    const restaurant = await createRestaurant(app, { slug: "noturna" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      {
        weekday: ((dow + 6) % 7) as 0, // ontem
        opensAt: somaMinutos(hora, -120),
        closesAt: somaMinutos(hora, 60),
      },
    ]);

    expect((await isOpen("noturna")).isOpen).toBe(true);
  });

  /**
   * O fuso decide. Dois restaurantes com a MESMA grade, fusos diferentes: a
   * faixa é montada em torno da hora de São Paulo, então o de Manaus (uma hora
   * atrás) está fora dela.
   */
  it("a mesma grade dá respostas diferentes em fusos diferentes", async () => {
    const sp = await createRestaurant(app, {
      slug: "sp",
      timezone: "America/Sao_Paulo",
    });
    const manaus = await createRestaurant(app, {
      slug: "manaus",
      timezone: "America/Manaus",
    });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    // faixa estreita: começa agora em SP e dura 30 minutos. Em Manaus são
    // 60 minutos mais cedo, logo fora dela.
    const grade = [
      { weekday: dow, opensAt: hora, closesAt: somaMinutos(hora, 30) },
    ];
    await setOpeningHours(app, sp, grade);
    await setOpeningHours(app, manaus, grade);

    expect((await isOpen("sp")).isOpen).toBe(true);
    expect((await isOpen("manaus")).isOpen).toBe(false);
  });

  /** A pausa fecha a loja mesmo dentro da faixa. */
  it("a pausa manual fecha a loja, e sai separada de isOpen", async () => {
    const restaurant = await createRestaurant(app, { slug: "pausada" });
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, -60), closesAt: somaMinutos(hora, 60) },
    ]);

    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { acceptingOrders: false },
    });

    const body = await isOpen("pausada");
    expect(body.isOpen).toBe(false);
    // separado, para a tela distinguir "fechado agora" de "a loja pausou"
    expect(body.acceptingOrders).toBe(false);
  });

  it("o cardápio devolve a grade, para a tela dizer quando abre", async () => {
    const restaurant = await createRestaurant(app, { slug: "com-grade" });
    await setOpeningHours(app, restaurant, [
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
    ]);

    const body = await isOpen("com-grade");

    expect(body.openingHours).toEqual([
      { weekday: 1, opensAt: "18:00", closesAt: "23:00" },
    ]);
  });

  it("restaurante sem grade nenhuma está fechado", async () => {
    await createRestaurant(app, { slug: "virgem" });

    expect((await isOpen("virgem")).isOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — `isOpen` é `undefined`.

- [ ] **Step 3: A checagem no repositório**

Em `apps/api/src/repositories/opening-hours.ts`:

```ts
/**
 * O restaurante está dentro de alguma faixa **agora**, no fuso dele?
 *
 * A conta roda no Postgres, e não no Node, pelo mesmo motivo do filtro de
 * período do painel: ela depende do banco de fusos, que o `at time zone` já
 * consulta. Refazê-la em JavaScript seria uma segunda implementação da mesma
 * regra, discordando da primeira nos dias de virada de horário de verão.
 *
 * ⚠️ Isto responde só pela GRADE. A pausa manual é outra condição, e quem
 * junta as duas é o serviço — misturá-las aqui esconderia da tela a diferença
 * entre "fechado agora" e "a loja pausou os pedidos".
 */
export async function isOpenNow(
  restaurantId: string,
  timezone: string,
  db: Queryable = pool,
): Promise<boolean> {
  const { rows } = await db.query<{ aberto: boolean }>(
    `select exists (
       select 1
         from opening_hours h,
              lateral (select now() at time zone $2 as local) agora
        where h.restaurant_id = $1
          and h.deleted_at is null
          and (
            -- faixa normal, dentro do mesmo dia
            (h.closes_at > h.opens_at
              and extract(dow from agora.local) = h.weekday
              and agora.local::time >= h.opens_at
              and agora.local::time <  h.closes_at)
            or
            -- faixa que atravessa a meia-noite: vale no fim do próprio dia e
            -- na madrugada do dia seguinte
            (h.closes_at < h.opens_at
              and (
                (extract(dow from agora.local) = h.weekday
                  and agora.local::time >= h.opens_at)
                or
                (extract(dow from agora.local) = (h.weekday + 1) % 7
                  and agora.local::time < h.closes_at)
              ))
          )
     ) as aberto`,
    [restaurantId, timezone],
  );
  return rows[0].aberto;
}
```

- [ ] **Step 4: `acceptingOrders` no restaurante**

Em `domain/restaurant.ts`, `CreateRestaurantInput` ganha `acceptingOrders?: boolean` e `Restaurant` ganha `acceptingOrders: boolean`. Em `repositories/restaurants.ts`: a linha, o mapper, o mapa de colunas editáveis (`acceptingOrders: "accepting_orders"`) e o insert (com `coalesce($n, true)`, como o `timezone` já faz).

Em `routes/schemas.ts`, `updateRestaurantBodySchema` e `restaurantResponseSchema` ganham `acceptingOrders: { type: "boolean" }`. **Não** entra no corpo de criação: restaurante nasce aceitando pedidos, e oferecer o campo no cadastro convidaria a criar uma loja já pausada.

- [ ] **Step 5: O cardápio**

Em `domain/menu.ts`, `MenuRestaurant` deixa de ser um `Omit` do `Restaurant` e passa a declarar o que expõe, ganhando:

```ts
/**
 * A loja está aberta agora? É a grade **e** a pausa, juntas — é o que a tela
 * precisa para decidir se mostra o botão de pedir.
 */
isOpen: boolean;
/**
 * A pausa, separada, para a tela distinguir "fechado agora, abre às 18h" de
 * "a loja pausou os pedidos". São mensagens diferentes para o cliente.
 */
acceptingOrders: boolean;
/** A grade, para a tela conseguir dizer QUANDO abre. Sem ela, "fechado" é um beco sem saída. */
openingHours: { weekday: Weekday; opensAt: string; closesAt: string }[];
```

Em `services/menu.ts`, `getRestaurant` passa a compor:

```ts
const [aberto, grade] = await Promise.all([
  openingHoursRepository.isOpenNow(restaurant.id, restaurant.timezone),
  openingHoursRepository.findByRestaurant(restaurant.id),
]);

return {
  ...toMenuRestaurant(restaurant),
  // a loja só está aberta se a grade permite E ninguém pausou
  isOpen: aberto && restaurant.acceptingOrders,
  acceptingOrders: restaurant.acceptingOrders,
  openingHours: grade.map(({ weekday, opensAt, closesAt }) => ({
    weekday,
    opensAt,
    closesAt,
  })),
};
```

Em `routes/menu.ts`, `menuRestaurantResponseSchema` ganha os três campos. ⚠️ **`timezone` continua fora** — é operação do restaurante, e a regra S10 diz que coluna nova não entra na superfície aberta por reflexo.

- [ ] **Step 6: Rodar, type-check, lint**

Esperado: PASS, 8 testes, e os testes antigos do cardápio continuam passando.

- [ ] **Step 7: Verificar por mutação**

Troque `isOpen: aberto && restaurant.acceptingOrders` por `isOpen: aberto`.
Esperado: **FALHA** em "a pausa manual fecha a loja".

Apague o ramo `h.closes_at < h.opens_at` inteiro da query.
Esperado: **FALHA** em "faixa que atravessa a meia-noite vale na madrugada seguinte".

Troque `$2` (o fuso) por `'America/Sao_Paulo'` fixo.
Esperado: **FALHA** em "a mesma grade dá respostas diferentes em fusos diferentes".

- [ ] **Step 8: OpenAPI, suíte, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(menu)!: ✨ diz no cardápio se a loja está aberta

BREAKING CHANGE: \`GET /menu/:slug\` ganha \`isOpen\`, \`acceptingOrders\` e
\`openingHours\`.

A conta roda no Postgres, no fuso do restaurante, pelo mesmo motivo do filtro
de período do painel — refazê-la em JavaScript seria uma segunda
implementação discordando da primeira nos dias de virada.

\`acceptingOrders\` sai separado de \`isOpen\` porque \"fechado agora, abre às
18h\" e \"a loja pausou\" são mensagens diferentes para o cliente."
```

---

### Task 4: As formas de pagamento que o restaurante aceita

**Files:**
- Create: `apps/api/src/domain/payment.ts`
- Modify: `apps/api/src/domain/restaurant.ts`, `apps/api/src/repositories/restaurants.ts`, `apps/api/src/routes/schemas.ts`, `apps/api/src/domain/menu.ts`, `apps/api/src/services/menu.ts`, `apps/api/src/routes/menu.ts`
- Modify: `apps/api/test/restaurants.crud.test.ts`

**Interfaces:**
- Consumes: as 4 colunas da Task 1.
- Produces:
  - `PAYMENT_METHODS = ["cash", "card_on_delivery", "pix", "meal_voucher"] as const`, `type PaymentMethod`
  - `Restaurant` ganha `acceptsCash`, `acceptsCardOnDelivery`, `acceptsPix`, `acceptsMealVoucher`
  - `MenuRestaurant` ganha `paymentMethods: PaymentMethod[]`
  - `acceptedPaymentMethods(restaurant): PaymentMethod[]` em `domain/payment.ts`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `apps/api/test/restaurants.crud.test.ts`:

```ts
describe("formas de pagamento aceitas", () => {
  it("nasce aceitando dinheiro, cartão e pix, mas não vale-refeição", async () => {
    const restaurant = await createRestaurant(app);

    expect(restaurant).toMatchObject({
      acceptsCash: true,
      acceptsCardOnDelivery: true,
      acceptsPix: true,
      // exige credenciamento com a bandeira: quem tem, liga
      acceptsMealVoucher: false,
    });
  });

  it("PATCH muda o que é aceito", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { acceptsPix: false, acceptsMealVoucher: true },
    });

    expect(response.json()).toMatchObject({
      acceptsPix: false,
      acceptsMealVoucher: true,
      acceptsCash: true,
    });
  });

  it("o cardápio público lista as formas aceitas, não as flags", async () => {
    const restaurant = await createRestaurant(app, { slug: "pagamentos" });
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { acceptsPix: false },
    });

    const response = await app.inject({ method: "GET", url: "/menu/pagamentos" });

    expect(response.json().paymentMethods).toEqual(["cash", "card_on_delivery"]);
    // as flags cruas não vazam: o cliente recebe a lista pronta
    expect(response.json().acceptsCash).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — os campos são `undefined`.

- [ ] **Step 3: O domínio do pagamento**

Crie `apps/api/src/domain/payment.ts`:

```ts
/**
 * As formas de pagamento. Só tipos e a lista, mais o tradutor de flags.
 *
 * Todas são **na entrega**: o sistema não cobra, ele registra o que foi
 * combinado. Pagamento online exigiria gateway, webhook e conciliação, e é
 * outra PR inteira.
 */
export const PAYMENT_METHODS = [
  "cash",
  "card_on_delivery",
  "pix",
  "meal_voucher",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** As flags do restaurante, do jeito que o banco as guarda. */
export type AcceptedPaymentFlags = {
  acceptsCash: boolean;
  acceptsCardOnDelivery: boolean;
  acceptsPix: boolean;
  acceptsMealVoucher: boolean;
};

/**
 * Traduz as quatro flags na lista que o cliente escolhe.
 *
 * O cardápio recebe a lista pronta, não as flags: quatro booleanos são o
 * formato de quem edita, e uma lista é o formato de quem escolhe. A ordem é a
 * de `PAYMENT_METHODS`, para a tela não mudar sozinha entre requisições.
 */
export function acceptedPaymentMethods(
  flags: AcceptedPaymentFlags,
): PaymentMethod[] {
  const porForma: Record<PaymentMethod, boolean> = {
    cash: flags.acceptsCash,
    card_on_delivery: flags.acceptsCardOnDelivery,
    pix: flags.acceptsPix,
    meal_voucher: flags.acceptsMealVoucher,
  };
  return PAYMENT_METHODS.filter((forma) => porForma[forma]);
}
```

- [ ] **Step 4: Propagar pelas camadas**

`domain/restaurant.ts`: `CreateRestaurantInput` ganha as quatro como opcionais, `Restaurant` como obrigatórias.

`repositories/restaurants.ts`: linha, mapper, mapa de colunas editáveis, e o insert com `coalesce($n, <default>)` para cada uma — `true` nas três primeiras, `false` no vale-refeição.

`routes/schemas.ts`: as quatro entram em `createRestaurantBodySchema`, `updateRestaurantBodySchema` e `restaurantResponseSchema` como `{ type: "boolean" }`.

`domain/menu.ts` + `services/menu.ts` + `routes/menu.ts`: `MenuRestaurant` ganha `paymentMethods: PaymentMethod[]`, composto por `acceptedPaymentMethods(restaurant)`. ⚠️ **As flags cruas não entram no schema do cardápio** — o cliente recebe a lista, o painel recebe as flags.

- [ ] **Step 5: Rodar, type-check, lint**

Esperado: PASS, 3 testes novos.

- [ ] **Step 6: Verificar por mutação**

Faça `acceptedPaymentMethods` devolver `[...PAYMENT_METHODS]` sempre.
Esperado: **FALHA** em "o cardápio público lista as formas aceitas".

Troque o default de `accepts_meal_voucher` para `true` no insert.
Esperado: **FALHA** em "nasce aceitando dinheiro, cartão e pix, mas não vale-refeição".

- [ ] **Step 7: OpenAPI, suíte, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(restaurants): ✨ declara as formas de pagamento aceitas"
```

---

### Task 5: A forma de pagamento no pedido

**Files:**
- Modify: `apps/api/src/domain/order.ts`, `apps/api/src/repositories/orders.ts`, `apps/api/src/services/orders.ts`, `apps/api/src/routes/orders.ts`, `apps/api/src/routes/tracking.ts`, `apps/api/test/helpers.ts`
- Create: `apps/api/test/orders-payment.test.ts`

**Interfaces:**
- Consumes: `PAYMENT_METHODS`, `PaymentMethod` (Task 4); as colunas (Task 1).
- Produces: `CreateOrderInput` ganha `paymentMethod: PaymentMethod` e `changeForInCents?: number`; `OrderSummary` ganha os dois.

⚠️ **Esta tarefa toca CINCO superfícies de leitura.** A tabela da spec as lista, e a PR anterior terminou com um defeito por esquecer uma delas: criação, detalhe do restaurante, **listagem do restaurante**, recibo do cliente (`routes/tracking.ts`) e o `openapi.json`. O WebSocket **não** muda — ele transmite mudança de estado, não conteúdo.

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/orders-payment.test.ts` com estes casos, escritos por extenso no estilo dos arquivos existentes:

1. **201 com dinheiro e troco** — o pedido volta com `paymentMethod: "cash"` e `changeForInCents: 5000`.
2. **201 com dinheiro sem troco** — significa "tenho o valor certo"; `changeForInCents` ausente na resposta.
3. **201 no pix**, sem troco.
4. **409 com forma que o restaurante não aceita** — `PATCH acceptsPix: false`, depois pedido no pix; a mensagem cita a forma.
5. **400 com `changeForInCents` em forma que não é dinheiro.**
6. **400 com `changeForInCents` menor que o total** — produto de 4890, `changeForInCents: 1000`.
7. **`changeForInCents` igual ao total é válido** (201) — pagar com o valor exato em nota fechada.
8. **400 sem `paymentMethod`** — o campo é obrigatório no corpo.
9. **400 com forma fora do enum.**
10. **O detalhe do restaurante mostra os dois campos.**
11. **A listagem do restaurante mostra os dois campos** — é onde a cozinha decide o troco antes de despachar.
12. **O recibo do cliente (`GET /orders/:id?token=`) mostra os dois campos.**

Todos os casos usam este cenário (defina-o no topo do `describe`):

```ts
/** Uma loja aberta agora, com um produto de R$ 48,90. */
async function cenario() {
  const restaurant = await createRestaurant(app);
  const produto = await createProduct(app, restaurant, {
    priceInCents: 4890,
    stock: 10,
  });
  return { restaurant, produto };
}
```

⚠️ Isto depende de `createRestaurant` já criar um restaurante **aberto**. Se a
Task 6 ainda não ajustou o helper, ajuste-o aqui: uma grade 00:00–23:59 nos sete
dias, para que restaurante de teste nasça aberto. Sem isso, todo caso desta
tarefa levaria 409 antes de chegar na validação de pagamento.

Exemplo do caso 6, para fixar o estilo:

```ts
/**
 * Pedir troco para R$ 10 numa conta de R$ 48,90 não é um pedido, é um engano —
 * e o entregador descobriria na porta. A comparação é com o total calculado no
 * SERVIDOR: o corpo não tem `totalInCents`, e aceitar um número do cliente
 * deixaria a validação inteira sem sentido.
 */
it("400 quando o troco é menor que o total", async () => {
  const { restaurant, produto } = await cenario();

  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/orders`,
    payload: {
      type: "takeaway",
      customer: { name: "Ana", phone: "11999990000" },
      items: [{ productId: produto.id, quantity: 1 }],
      paymentMethod: "cash",
      changeForInCents: 1000,
    },
  });

  expect(response.statusCode).toBe(400);
  expect(response.json().message).toContain("troco");
});
```

O helper `createOrder` em `test/helpers.ts` ganha `paymentMethod: "cash"` no payload padrão, para os testes existentes continuarem passando sem edição.

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — `additionalProperties: false` recusa `paymentMethod`.

- [ ] **Step 3: Domínio e schema**

`domain/order.ts`:

```ts
/** Como o pedido será pago. Sempre na entrega — o sistema registra, não cobra. */
paymentMethod: PaymentMethod;
/**
 * "Troco para R$ 50", em centavos. Só em dinheiro, e opcional: ausente
 * significa "tenho o valor certo". Exigi-lo obrigaria quem paga exato a
 * inventar um número.
 */
changeForInCents?: number;
```

`routes/orders.ts`, no corpo da criação:

```ts
paymentMethod: { type: "string", enum: [...PAYMENT_METHODS] },
changeForInCents: { type: "integer", minimum: 0 },
```

com `paymentMethod` acrescentado ao `required`. E os dois entram em `orderSummaryResponseSchema` (que serve detalhe **e** listagem) e no `trackedOrderResponseSchema` de `routes/tracking.ts`.

- [ ] **Step 4: As regras no serviço**

Em `services/orders.ts`, ao lado de `assertRestauranteAceita`:

```ts
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
```

`assertFormaAceita` roda junto de `assertRestauranteAceita`, **antes** da transação. `assertTrocoCoerente` roda **dentro**, logo depois de o `totalInCents` ser calculado — antes dele o total não existe.

`NOME_DA_FORMA` é um `Record<PaymentMethod, string>` em pt-BR, ao lado do `NOME_DA_MODALIDADE` que já existe.

- [ ] **Step 5: Gravar e ler**

`repositories/orders.ts`: `insertOrder` grava as duas colunas; `OrderWithCustomerRow` e o mapper as leem. Como a listagem e o detalhe usam o mesmo `selectOrderWithCustomer`, os dois ganham os campos de uma vez.

`routes/tracking.ts` já lê o mesmo `Order` — só o `schema.response` precisa declará-los.

- [ ] **Step 6: Rodar, type-check, lint**

Esperado: PASS, 12 testes novos, e nenhum teste antigo de pedido quebrado (o helper cobre).

- [ ] **Step 7: Verificar por mutação**

Remova `assertFormaAceita` da criação.
Esperado: **FALHA** no caso 4.

Troque `changeForInCents < totalInCents` por `changeForInCents < 0`.
Esperado: **FALHA** no caso 6, e o caso 7 continua passando.

Remova `changeForInCents` do `trackedOrderResponseSchema`.
Esperado: **FALHA** no caso 12.

- [ ] **Step 8: OpenAPI, suíte, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(orders)!: ✨ registra a forma de pagamento e o troco

BREAKING CHANGE: \`paymentMethod\` passa a ser obrigatório no corpo do pedido.

Até aqui o restaurante recebia o pedido sem saber como seria pago, e o
entregador saía sem saber se precisava de troco.

Forma não aceita é 409, igual à modalidade recusada — é a mesma pergunta.
Troco incoerente é 400, porque é corpo malformado e não conflito de estado, e
ele é comparado com o total do SERVIDOR: comparar com um número do cliente
deixaria a validação sem sentido."
```

---

### Task 6: O bloqueio na criação do pedido

**Files:**
- Modify: `apps/api/src/services/orders.ts`
- Modify: `apps/api/test/store-open.test.ts`

**Interfaces:**
- Consumes: `isOpenNow` (Task 3), `restaurant.acceptingOrders` (Task 3).
- Produces: nada novo.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `apps/api/test/store-open.test.ts` — o arquivo já tem
`agoraNoFuso` e `somaMinutos` da Task 3, e o import precisa ganhar
`createProduct`:

```ts
describe("a criação de pedido respeita o horário", () => {
  /** Cria produto e devolve o que os testes precisam. */
  async function lojaComProduto(slug: string) {
    const restaurant = await createRestaurant(app, { slug });
    const produto = await createProduct(app, restaurant, { stock: 10 });
    return { restaurant, produto };
  }

  function pedir(restaurantId: string, produtoId: string) {
    return app.inject({
      method: "POST",
      url: `/restaurants/${restaurantId}/orders`,
      payload: {
        type: "takeaway",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: produtoId, quantity: 1 }],
        paymentMethod: "cash",
      },
    });
  }

  it("409 fora do horário", async () => {
    const { restaurant, produto } = await lojaComProduto("fora-do-horario");
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, 120), closesAt: somaMinutos(hora, 180) },
    ]);

    const response = await pedir(restaurant.id, produto.id);

    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("fechad");
  });

  it("409 com a loja pausada, mesmo dentro do horário", async () => {
    const { restaurant, produto } = await lojaComProduto("pausada-pedido");
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, -60), closesAt: somaMinutos(hora, 60) },
    ]);
    await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}`,
      headers: restaurant.headers,
      payload: { acceptingOrders: false },
    });

    const response = await pedir(restaurant.id, produto.id);

    expect(response.statusCode).toBe(409);
    // mensagem distinta da de "fora do horário"
    expect(response.json().message).toContain("pausad");
  });

  it("201 dentro do horário", async () => {
    const { restaurant, produto } = await lojaComProduto("aberta-pedido");
    const { dow, hora } = await agoraNoFuso("America/Sao_Paulo");
    await setOpeningHours(app, restaurant, [
      { weekday: dow, opensAt: somaMinutos(hora, -60), closesAt: somaMinutos(hora, 60) },
    ]);

    expect((await pedir(restaurant.id, produto.id)).statusCode).toBe(201);
  });

  /** Se a loja está fechada, não há ninguém no salão para servir. */
  it("409 também no pedido de salão", async () => {
    const { restaurant, produto } = await lojaComProduto("salao-fechado");
    await setOpeningHours(app, restaurant, []);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/orders`,
      payload: {
        type: "dine_in",
        customer: { name: "Ana", phone: "11999990000" },
        items: [{ productId: produto.id, quantity: 1 }],
        paymentMethod: "cash",
      },
    });

    expect(response.statusCode).toBe(409);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — devolve 201, porque nada bloqueia ainda.

- [ ] **Step 3: A checagem no serviço**

Em `services/orders.ts`, dentro de `create`, depois de carregar o restaurante e **antes** de qualquer escrita:

```ts
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
async function assertLojaAberta(restaurant: Restaurant): Promise<void> {
  if (!restaurant.acceptingOrders) {
    throw new ConflictError(
      "A loja pausou os pedidos no momento. Tente de novo mais tarde",
    );
  }
  if (!(await openingHoursRepository.isOpenNow(restaurant.id, restaurant.timezone))) {
    throw new ConflictError("A loja está fechada agora");
  }
}
```

A pausa é checada **antes** da grade porque não custa consulta ao banco: recusar o caso barato primeiro evita uma query quando ela não muda a resposta.

- [ ] **Step 4: Rodar, type-check, lint**

Esperado: PASS, 4 testes novos.

⚠️ **Muitos testes de pedido existentes vão quebrar** — eles criam restaurantes sem grade, e restaurante sem grade agora está fechado. **Isso é sinal, não trabalho de edição.** O conserto é no helper: `createRestaurant` passa a definir uma grade 00:00–23:59 nos sete dias, para que um restaurante de teste nasça aberto. Um restaurante que precise estar fechado sobrescreve a grade.

Ajuste o helper, não os testes.

- [ ] **Step 5: Verificar por mutação**

Remova a chamada de `assertLojaAberta` de `create`.
Esperado: **FALHA** nos quatro testes novos.

Inverta a ordem das duas checagens dentro dela.
Esperado: os testes continuam passando — **a ordem é otimização, não garantia**. Documente isso no relatório em vez de afirmar que a ordem é obrigatória.

- [ ] **Step 6: Suíte, commit**

```bash
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(orders)!: ✨ recusa pedido com a loja fechada

BREAKING CHANGE: criar pedido fora do horário ou com a loja pausada é 409.

Não é redundante com o \`isOpen\` do cardápio: o cardápio informa, a criação
decide. Entre uma coisa e outra cabe o tempo de montar o carrinho, e cabe um
cliente que chame a API direto.

Vale para as três modalidades — com a loja fechada não há ninguém no salão."
```

---

### Task 7: Seed, verificação de ponta a ponta e documentação

**Files:**
- Modify: `apps/api/src/db/seed.sql`, `CLAUDE.md`

- [ ] **Step 1: O seed**

Acrescente ao `seed.sql`, com ids fixos e `on conflict (id) do nothing`:

- grade do Tokyo: almoço 11:00–15:00 e jantar 18:00–23:00 de segunda a sábado (weekday 1..6), **e uma faixa 18:00–02:00 no sábado** — é o que torna o atravessamento da meia-noite testável à mão;
- Cantina fechada aos domingos (nenhuma faixa em weekday 0);
- e os pedidos existentes ganham `payment_method` explícito, com **um deles em dinheiro com `change_for_in_cents`**, para o troco aparecer numa leitura de exemplo.

⚠️ O `insert into orders` do seed precisa passar a declarar `payment_method` — sem isso o default `'cash'` cobre, mas o exemplo do troco não existe.

Verifique num banco descartável: criar, migrar, semear, **semear de novo**, e conferir que os números repetem.

- [ ] **Step 2: Verificação de ponta a ponta**

⚠️ O banco de dev pode não ter esta migration: rode `pnpm --filter @menuclick/api migrate:up` contra ele antes.

```bash
cd apps/api
lsof -ti:3399 | xargs -r kill -9
PORT=3399 node --env-file-if-exists=.env src/server.ts > /tmp/api-3399.log 2>&1 &
```

O `--env-file-if-exists` importa: sem ele o servidor sobe mas não alcança o banco, e isso já custou tempo neste projeto. Num `DELETE` sem corpo, **não** mande `content-type: application/json` — o Fastify recusa com 400 e parece bug da rota.

Exercite e **reporte os números observados**:

- a loja fechada devolve `isOpen: false` com a grade preenchida, e o pedido dá 409 com a mensagem certa;
- ajustada para estar aberta agora, o mesmo pedido dá 201;
- a pausa fecha a loja e a mensagem do 409 é a **outra**;
- um pedido em dinheiro com troco aparece com `paymentMethod` e `changeForInCents` nas **três** leituras: detalhe do restaurante, listagem do restaurante e recibo do cliente;
- uma forma que o restaurante desativou dá 409.

Mate o servidor ao terminar.

- [ ] **Step 3: Documentação**

Nova seção no `CLAUDE.md`, depois de "O painel: fuso, período e ordenação", cobrindo: as faixas por dia e por que dia sem faixa é fechado; **a faixa que atravessa a meia-noite**; por que a checagem roda no Postgres e não no Node; a pausa manual e por que o nome é positivo; por que `opens_at` é `time` e não `timestamptz` (e que isso não viola a D13); as formas de pagamento como flags espelhando as de modalidade; e as duas regras do troco.

Atualize também a abertura ("O que é") e a lista de tabelas da seção de banco.

- [ ] **Step 4: Verificação final e commit**

```bash
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
cd apps/api && pnpm --filter @menuclick/api build && pnpm --filter @menuclick/api test
git add -A && git commit -m "docs: 📝 documenta o horário de funcionamento e o pagamento"
```

---

## Ordem e dependências

```
Task 1 (migration)
   ├─→ Task 2 (grade) ──→ Task 3 (está aberto? + cardápio) ──→ Task 6 (bloqueia o pedido)
   └─→ Task 4 (formas aceitas) ──→ Task 5 (pagamento no pedido)
                                            └──────────────────→ Task 7 (seed e docs)
```

Tasks 2 e 4 são independentes entre si depois da 1. Task 7 fecha tudo.

## Fora de escopo

Da spec, e nada disto bloqueia: taxa de entrega e geocodificação (PR própria, onde mora todo o risco), pedido mínimo, horário por modalidade, exceções por data (feriado) e pagamento online.
