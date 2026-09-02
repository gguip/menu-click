# Grupos de opções — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao cardápio o quarto nível — grupos de opções e opções — para que pizza, hambúrguer com adicionais e combo passem a ser vendáveis.

**Architecture:** Três tabelas novas de cardápio (`option_groups`, `options`, `product_option_groups`) mais uma de congelamento (`order_item_options`). Grupos pertencem ao restaurante e se ligam a produtos por junção, o que permite reuso. O preço das escolhas entra no item por três regras (`sum`/`highest`/`average`), calculadas em aritmética inteira e arredondadas **uma vez** no preço unitário.

**Tech Stack:** TypeScript nativo no Node (type stripping, imports com `.ts`, sem `enum`), Fastify 5, Postgres via `pg` sem ORM, node-pg-migrate com SQL puro, Vitest contra Postgres real.

**Spec:** `docs/superpowers/specs/2026-09-01-grupos-de-opcoes-design.md`

## Global Constraints

Valem para **toda** tarefa. Vêm de `CLAUDE.md` e `.claude/rules/`.

- **Node >= 23.6**, TypeScript executado direto: imports locais **com extensão `.ts`**, `import type` para tipos, **sem `enum`** (uniões `as const`), sem parameter properties.
- **Soft delete obrigatório (D1/D2):** nenhum `delete from` no código da aplicação; toda leitura filtra `deleted_at is null`.
- **Cascata explícita e transacional (D3):** sem `on delete cascade`; dentro de transação use sempre o `client` recebido.
- **Índices parciais (D5) e unicidade parcial (D6):** `where deleted_at is null`.
- **Ordenação determinística (D11):** `order by <campo>, id`.
- **`snake_case` no banco, `camelCase` na API (D12)**, traduzido por mapper; `timestamptz` sempre (D13); `isUuid()` antes de consultar por id (D14/S9).
- **Migration só por `migrate:create` (D21)**, nunca `if not exists` (D18), com `Down` que desfaz de verdade (D17), e no mesmo commit do código (D20).
- **Todo valor do cliente vai como `$n` (S1/S2).** Identificador nunca é parametrizável: use allowlist/mapa fixo (S3). Lista `IN` vira `= any($n::uuid[])` (S4).
- **`schema.response` por status code é obrigatório (F10/S10)** e é controle de segurança.
- **Erro de negócio nunca vira status na rota (S11):** o serviço lança `NotFoundError`/`ConflictError`/`ValidationError`/`ForbiddenError` e o `setErrorHandler` do `app.ts` traduz.
- **Rota nasce fechada (S17).** Rota escopada em restaurante **precisa** chamar o parâmetro de `restaurantId` (S18). Recurso de outro dono é 404 (S19).
- **Toda rota declara `tags`, `summary`, `description` e `operationId`**, e `pnpm --filter @menuclick/api openapi:generate` roda no mesmo commit (há teste comparando o versionado com o gerado).
- **Commits seguem `.claude/rules/commits.md`:** `<tipo>(<escopo>): <emoji> <mensagem>`, pt-BR, presente do indicativo, minúscula, sem ponto final.
- **Toda garantia nova é verificada por mutação:** quebre o código que a sustenta e confirme que o teste falha. Garantia cuja mutação não acusa é documentada como tal — nunca prometida.
- **Sem dependência nova.** Nada neste plano precisa de uma.

### Comandos

```bash
unset -f node pnpm                                          # nvm define funções que recursam
pnpm --filter @menuclick/api migrate:create <nome>
pnpm --filter @menuclick/api migrate:up
pnpm --filter @menuclick/api build                          # tsc --noEmit
pnpm --filter @menuclick/api test                           # vitest run
pnpm --filter @menuclick/api exec vitest run test/<arquivo>
pnpm --filter @menuclick/api openapi:generate
pnpm lint                                                    # da raiz
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
```

O banco de teste (`capstone_test`) é criado e migrado pelo `globalSetup`. Depois de escrever uma migration, **derrube o banco de teste** antes de rodar a suíte, senão ela roda contra o schema antigo.

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `apps/api/migrations/<ts>_add-option-groups.sql` | as quatro tabelas, os índices e a coluna nova de `order_items` |
| `apps/api/src/domain/option.ts` | tipos + as funções puras de preço (`divideRounded`, `groupContribution`, `unitPrice`) |
| `apps/api/src/repositories/option-groups.ts` | todo o SQL de `option_groups`, `options` e `product_option_groups` |
| `apps/api/src/services/option-groups.ts` | regras de negócio dos grupos, opções e vínculo |
| `apps/api/src/routes/option-groups.ts` | as rotas HTTP de grupo, opção e vínculo |
| `apps/api/test/option-price.test.ts` | as funções puras de preço (sem banco) |
| `apps/api/test/option-groups.crud.test.ts` | CRUD de grupo e de opção |
| `apps/api/test/product-option-groups.test.ts` | o `PUT` do vínculo e as cascatas |
| `apps/api/test/orders-options.test.ts` | criação de pedido com opções: validação, fusão, congelamento |

**Modificar:**

| Arquivo | O quê |
| --- | --- |
| `apps/api/src/domain/order.ts` | `CreateOrderItemInput` ganha `options`; `OrderItem` ganha `options` e `unitPriceInCents` |
| `apps/api/src/domain/menu.ts` | `MenuProduct` ganha `optionGroupIds`; novo `MenuOptionGroup`; `Page<MenuSection>` ganha `optionGroups` |
| `apps/api/src/repositories/orders.ts` | grava e lê `order_item_options`; `insertItems` passa a gravar `unit_price_in_cents` |
| `apps/api/src/repositories/products.ts` | leitura dos grupos obrigatórios sem opção disponível (disponibilidade) |
| `apps/api/src/services/orders.ts` | validação das opções, chave de fusão, preço, **conferência de estoque somada por produto** |
| `apps/api/src/services/menu.ts` | monta `optionGroups` normalizados e o `available` novo |
| `apps/api/src/services/products.ts` | repassa a disponibilidade |
| `apps/api/src/services/restaurants.ts` | cascata alcança grupos, opções e vínculos |
| `apps/api/src/routes/orders.ts` | schema do corpo e da resposta |
| `apps/api/src/routes/menu.ts` | schema da resposta do cardápio |
| `apps/api/src/app.ts` | registra `optionGroupRoutes` |
| `apps/api/src/openapi.ts` | tag "Opções" |
| `apps/api/src/db/seed.sql` | grupos e opções de exemplo |
| `apps/api/test/helpers.ts` | `createOptionGroup`, `createOption`, `linkOptionGroups` |
| `CLAUDE.md` | seção sobre grupos de opções e a aritmética de dinheiro |

---

### Task 1: A aritmética de preço (domínio puro)

> **Correção após a revisão da Task 1:** os identificadores exportados nasceram em
> português neste plano e foram renomeados para inglês. O `CLAUDE.md` manda
> "identificadores em inglês", e as nove funções e todos os tipos exportados de
> `src/domain/` já seguiam isso — só helpers **privados** de serviço são em
> português no projeto. Comentários continuam em pt-BR.

Primeira porque é a única parte **sem banco**: testável em milissegundos, e é onde mora a decisão mais delicada da spec.

**Files:**
- Create: `apps/api/src/domain/option.ts`
- Test: `apps/api/test/option-price.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `PRICE_RULES: readonly ["sum", "highest", "average"]`, `type PriceRule`
  - `divideRounded(n: number, d: number): number`
  - `groupContribution(rule: PriceRule, choices: PricedChoice[]): number`
  - `unitPrice(productPriceInCents: number, groups: PricedGroup[]): number`
  - `type PricedChoice = { priceInCents: number; quantity: number }`
  - `type PricedGroup = { priceRule: PriceRule; choices: PricedChoice[] }`
  - `type Option`, `type OptionGroup`, `type CreateOptionGroupInput`,
    `type UpdateOptionGroupInput`, `type CreateOptionInput`,
    `type UpdateOptionInput` — as assinaturas exatas estão no Step 3

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/option-price.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  groupContribution,
  divideRounded,
  unitPrice,
} from "../src/domain/option.ts";

/**
 * A aritmética de dinheiro do cardápio.
 *
 * Não toca no banco de propósito: é a única parte do sistema em que um erro de
 * um centavo se propaga para todo pedido, e ela precisa ser verificável sem
 * subir nada.
 */
describe("aritmética de preço das opções", () => {
  describe("divideRounded", () => {
    it("arredonda meio para cima", () => {
      expect(divideRounded(5, 2)).toBe(3); // 2.5
      expect(divideRounded(7, 2)).toBe(4); // 3.5
      expect(divideRounded(9505, 2)).toBe(4753); // 4752.5
    });

    it("não arredonda o que já é inteiro", () => {
      expect(divideRounded(8180, 2)).toBe(4090);
      expect(divideRounded(0, 3)).toBe(0);
    });

    /**
     * A razão de a função existir em vez de `Math.round(n / d)`: remover a
     * classe inteira de dúvida sobre float, não porque ele erre nas nossas
     * magnitudes (foi medido que não), mas porque a equivalência depende da
     * faixa de valor e a aritmética inteira não. Este teste trava justamente
     * essa equivalência, contra um oráculo independente.
     */
    it("concorda com Math.round(n / d) em toda a faixa de um cardápio", () => {
      for (let d = 1; d <= 6; d++) {
        for (let n = 0; n <= 30000; n += 7) {
          // oráculo INDEPENDENTE: divisão em float + arredondamento da
          // biblioteca, que é o caminho contra o qual a equivalência foi
          // medida. Repetir aqui a fórmula inteira da implementação faria um
          // teste que não pode falhar.
          const independente = Math.round(n / d);
          expect(divideRounded(n, d)).toBe(independente);
        }
      }
    });
  });

  describe("groupContribution", () => {
    it("sum sum preço vezes quantidade", () => {
      expect(
        groupContribution("sum", [
          { priceInCents: 500, quantity: 2 },
          { priceInCents: 300, quantity: 1 },
        ]),
      ).toBe(1300);
    });

    it("highest devolve o maior preço unitário, ignorando a quantidade", () => {
      expect(
        groupContribution("highest", [
          { priceInCents: 4505, quantity: 1 },
          { priceInCents: 5000, quantity: 1 },
        ]),
      ).toBe(5000);
      expect(
        groupContribution("highest", [{ priceInCents: 4505, quantity: 3 }]),
      ).toBe(4505);
    });

    it("average é a média por unidade, arredondada", () => {
      // (4505 + 5000) / 2 = 4752.5
      expect(
        groupContribution("average", [
          { priceInCents: 4505, quantity: 1 },
          { priceInCents: 5000, quantity: 1 },
        ]),
      ).toBe(4753);
      // (3000 + 3500 + 4100) / 3 = 3533.33…
      expect(
        groupContribution("average", [
          { priceInCents: 3000, quantity: 1 },
          { priceInCents: 3500, quantity: 1 },
          { priceInCents: 4100, quantity: 1 },
        ]),
      ).toBe(3533);
    });

    /** 2x o mesmo sabor é uma pizza inteira daquele sabor, pelo preço dele. */
    it("highest e average sobre uma opção repetida degradam para o preço dela", () => {
      const choices = [{ priceInCents: 4505, quantity: 2 }];
      expect(groupContribution("highest", choices)).toBe(4505);
      expect(groupContribution("average", choices)).toBe(4505);
    });

    it("grupo sem escolha não contribui", () => {
      for (const rule of ["sum", "highest", "average"] as const) {
        expect(groupContribution(rule, [])).toBe(0);
      }
    });
  });

  describe("unitPrice", () => {
    it("sum as contribuições ao preço do produto", () => {
      expect(
        unitPrice(3000, [
          {
            priceRule: "sum",
            choices: [{ priceInCents: 500, quantity: 2 }],
          },
        ]),
      ).toBe(4000);
    });

    /**
     * O achado que mudou a spec: arredondar POR GRUPO produz viés sistemático
     * para cima. Aqui os dois grupos caem em meio centavo, e arredondar cada um
     * daria 8856 em vez de 8855.
     */
    it("arredonda UMA vez, no fim — não por grupo", () => {
      const resultado = unitPrice(3000, [
        {
          priceRule: "average",
          choices: [
            { priceInCents: 4505, quantity: 1 },
            { priceInCents: 5000, quantity: 1 },
          ],
        },
        {
          priceRule: "average",
          choices: [
            { priceInCents: 1005, quantity: 1 },
            { priceInCents: 1200, quantity: 1 },
          ],
        },
      ]);

      expect(resultado).toBe(8855);
      expect(resultado).not.toBe(8856); // o que sairia arredondando por grupo
    });

    it("produto sem grupo nenhum custa o preço dele", () => {
      expect(unitPrice(4890, [])).toBe(4890);
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
unset -f node pnpm
pnpm --filter @menuclick/api exec vitest run test/option-price.test.ts
```

Esperado: FAIL — `Failed to resolve import "../src/domain/option.ts"`.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/domain/option.ts`:

```ts
/**
 * Grupos de opções do cardápio — as choices que um produto pede ("Tamanho",
 * "Sabores", "Adicionais"). Tipos, mais as funções de preço, que são o único
 * runtime deste arquivo.
 *
 * O grupo pertence ao RESTAURANTE e se liga aos produtos por junção: "Sabores"
 * vale para todas as pizzas, e recriá-lo por produto obrigaria a cadastrar
 * vinte opções de novo a cada pizza nova.
 */

/**
 * Como o preço das opções escolhidas entra na conta do item.
 *
 * `sum` é o caso comum (adicionais). `highest` e `average` existem para pizza
 * meio a meio, e as duas práticas convivem no mercado — quem escolhe é o
 * restaurante. Fica de fora o "menor" que a Delivery Direto suporta: nenhum
 * cardápio real o usa.
 */
export const PRICE_RULES = ["sum", "highest", "average"] as const;

export type PriceRule = (typeof PRICE_RULES)[number];

/** Uma opção do cardápio, como é guardada e devolvida. */
export type Option = {
  id: string;
  optionGroupId: string;
  name: string;
  priceInCents: number;
  /** Teto de units desta opção dentro de um item. */
  maxQuantity: number;
  available: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Um grupo, com as opções dele aninhadas.
 *
 * `options` vem junto porque um grupo sem elas não significa nada — e é por
 * isso que não existe rota para ler uma opção isolada.
 */
export type OptionGroup = {
  id: string;
  restaurantId: string;
  name: string;
  /** 0 = opcional; >= 1 = obrigatório. Conta opções DISTINTAS. */
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: Option[];
  createdAt: string;
  updatedAt: string;
};

export type CreateOptionGroupInput = {
  name: string;
  /** Ausente = 0, grupo opcional. */
  minOptions?: number;
  maxOptions: number;
  priceRule: PriceRule;
};

export type UpdateOptionGroupInput = Partial<CreateOptionGroupInput>;

export type CreateOptionInput = {
  name: string;
  /** Ausente = 0: cobre a escolha obrigatória sem custo. */
  priceInCents?: number;
  maxQuantity?: number;
  available?: boolean;
  position?: number;
};

export type UpdateOptionInput = Partial<CreateOptionInput>;

/** Uma opção escolhida, já com o preço congelado. */
export type PricedChoice = {
  priceInCents: number;
  quantity: number;
};

/** Um grupo com as choices que o cliente fez nele. */
export type PricedGroup = {
  priceRule: PriceRule;
  choices: PricedChoice[];
};

/**
 * Divide `n` por `d` arredondando o meio para cima, **sem passar por float**.
 *
 * Foi verificado que `Math.round(n / d)` concorda com a aritmética exata em
 * 103 mil combinações nas magnitudes de um cardápio — inclusive nos quocientes
 * que caem exatamente em `.5`, que a divisão IEEE-754 representa sem erro. Ou
 * seja: o float não erra aqui.
 *
 * A função existe assim mesmo. Uma equivalência verificada hoje, em faixas de
 * valor de hoje, é mais frágil que uma propriedade que não depende de faixa
 * nenhuma — e o custo de não depender é esta linha.
 *
 * Só funciona para `n >= 0`, que é garantido pelo `check (price_in_cents >= 0)`
 * da tabela `options`.
 */
export function divideRounded(n: number, d: number): number {
  return Math.floor(n / d) + (2 * (n % d) >= d ? 1 : 0);
}

/**
 * Quanto um grupo acrescenta ao preço unitário do item.
 *
 * ⚠️ O resultado de `average` é o único que arredonda, e ele arredonda **aqui**
 * por ser a fronteira do grupo — mas quem chama (`unitPrice`) NÃO sum
 * contribuições já arredondadas. Ver o comentário lá.
 */
export function groupContribution(
  rule: PriceRule,
  choices: PricedChoice[],
): number {
  if (choices.length === 0) return 0;

  if (rule === "sum") {
    return choices.reduce(
      (sum, escolha) => sum + choice.priceInCents * choice.quantity,
      0,
    );
  }

  if (rule === "highest") {
    // a quantidade não entra: dois pedaços do mesmo sabor não dobram o preço
    return Math.max(...choices.map((choice) => choice.priceInCents));
  }

  const total = choices.reduce(
    (sum, escolha) => sum + choice.priceInCents * choice.quantity,
    0,
  );
  const units = choices.reduce((sum, escolha) => sum + choice.quantity, 0);
  return divideRounded(total, units);
}

/**
 * O preço de UMA unidade do item, com tudo que foi escolhido.
 *
 * ⚠️ **O arredondamento acontece uma vez, aqui.** As contribuições de `average`
 * são acumuladas como numerator/denominator exatos e só viram inteiro no fim.
 *
 * Arredondar por grupo produziria viés sistemático **para cima** — medido: três
 * grupos caindo em meio centavo, em dez units, cobram dez centavos a mais.
 * Arredondar no total do item faria `unitário × quantidade` deixar de fechar
 * com o total do pedido, e um recibo cuja conta não bate é lido como erro por
 * quem confere.
 */
export function unitPrice(
  productPriceInCents: number,
  groups: PricedGroup[],
): number {
  // acumula em milésimos de centavo para não arredondar no meio do caminho:
  // só `average` produz fração, e ela é sempre uma divisão exata por um
  // inteiro pequeno (o número de units escolhidas no grupo)
  let numerator = productPriceInCents;
  let fractional = 0;
  let denominator = 1;

  for (const grupo of groups) {
    if (group.choices.length === 0) continue;

    if (group.priceRule === "average") {
      const total = group.choices.reduce(
        (sum, escolha) => sum + choice.priceInCents * choice.quantity,
        0,
      );
      const units = group.choices.reduce(
        (sum, escolha) => sum + choice.quantity,
        0,
      );
      // sum de frações: a/b + c/d = (ad + cb) / bd
      fractional = fractional * units + total * denominator;
      denominator = denominator * units;
      continue;
    }

    numerator += groupContribution(group.priceRule, group.choices);
  }

  return numerator + divideRounded(fractional, denominator);
}
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @menuclick/api exec vitest run test/option-price.test.ts
```

Esperado: PASS, 10 testes.

- [ ] **Step 5: Verificar por mutação**

Troque, em `unitPrice`, a acumulação fracionária por `numerator += groupContribution(...)` para todas as regras (isto é, arredondando por grupo). Rode o teste.

Esperado: **FALHA** em "arredonda UMA vez, no fim — não por grupo", com `8856` em vez de `8855`.

Desfaça a mutação e confirme que volta a passar.

- [ ] **Step 6: Type-check, lint e commit**

```bash
pnpm --filter @menuclick/api build
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
git add apps/api/src/domain/option.ts apps/api/test/option-price.test.ts
git commit -m "feat(menu): ✨ aritmética de preço dos grupos de opções

O arredondamento acontece UMA vez, no preço unitário. Por grupo dá viés
sistemático para cima (medido: 10 centavos em 3 grupos x 10 units); no
total do item faz \`unitário x quantidade\` deixar de fechar com o total do
pedido, e recibo que não bate é lido como erro por quem confere.

A conta usa aritmética inteira. Foi medido que o float concorda com o
inteiro em 103 mil casos nas nossas magnitudes — a função existe assim
mesmo, porque equivalência verificada em faixas de hoje é mais frágil que
propriedade que não depende de faixa nenhuma."
```

---

### Task 2: A migration

**Files:**
- Create: `apps/api/migrations/<timestamp>_add-option-groups.sql` (gerado pelo comando, nunca à mão)

**Interfaces:**
- Consumes: nada.
- Produces: as tabelas `option_groups`, `options`, `product_option_groups`, `order_item_options` e a coluna `order_items.unit_price_in_cents`.

- [ ] **Step 1: Criar o arquivo pelo comando**

```bash
unset -f node pnpm
pnpm --filter @menuclick/api migrate:create add-option-groups
```

O prefixo de timestamp define a ordem de execução — por isso nunca escrever o arquivo à mão (D21).

- [ ] **Step 2: Escrever o `Up` e o `Down`**

Substitua o conteúdo do arquivo gerado pelo bloco abaixo (o DDL vem da spec, seção "Modelo de dados"):

```sql
-- Up Migration

-- O quarto nível do cardápio. Até aqui era `Categoria -> Produto`; as
-- plataformas do mesmo nicho têm `Categoria -> Item -> Grupo -> Opção`, e sem
-- ele o sistema não vende pizza, hambúrguer com adicional nem combo.
--
-- O grupo pertence ao RESTAURANTE, não ao produto: "Sabores" vale para todas as
-- pizzas. Com grupo por produto, cadastrar a décima pizza recriaria quatro
-- grupos e vinte opções à mão, e mudar o preço do bacon viraria editar trinta
-- lugares.

create table option_groups (
  id            uuid        primary key default gen_random_uuid(),
  restaurant_id uuid        not null references restaurants (id),
  name          text        not null,
  -- 0 = grupo opcional; >= 1 = obrigatório. Um campo em vez de dois, e é a
  -- convenção do iFood ("grupo com mínimo 1 é obrigatório").
  min_options   integer     not null default 0,
  -- conta opções DISTINTAS, não unidades
  max_options   integer     not null,
  price_rule    text        not null check (price_rule in ('sum', 'highest', 'average')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  -- um grupo que exige mais escolhas do que aceita nunca poderia ser satisfeito,
  -- e o sintoma seria um pedido que não fecha, não um erro
  constraint option_groups_limits_check check (min_options >= 0 and max_options >= 1 and max_options >= min_options)
);

create table options (
  id              uuid        primary key default gen_random_uuid(),
  option_group_id uuid        not null references option_groups (id),
  name            text        not null,
  -- 0 cobre a escolha obrigatória sem custo ("ponto da carne"). O check não é
  -- decoração: o arredondamento do `average` é meio-para-cima em direção a
  -- +infinito, logo assimétrico no negativo, e com preço >= 0 essa assimetria
  -- nunca é alcançada. Isso fecha a porta para opção de desconto, de propósito.
  --
  -- NÃO é o mesmo caso do `stock` de products, que de propósito não tem check:
  -- lá a constraint esconderia o sintoma de uma race condition que o teste
  -- precisa enxergar. Aqui não há corrida — preço negativo é entrada sem sentido.
  price_in_cents  integer     not null default 0 check (price_in_cents >= 0),
  -- teto de unidades DESTA opção. Default 1 faz "Sabores" já nascer impedindo
  -- 2x o mesmo sabor sem ninguém configurar nada.
  max_quantity    integer     not null default 1 check (max_quantity >= 1),
  available       boolean     not null default true,
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- A junção. Ela é um vínculo, não um registro com história — desvincular
-- "Adicionais" de um hambúrguer não perde nada, porque pedido antigo guarda
-- cópias. Carrega `deleted_at` mesmo assim, porque a D1 é absoluta.
create table product_option_groups (
  id              uuid        primary key default gen_random_uuid(),
  product_id      uuid        not null references products (id),
  option_group_id uuid        not null references option_groups (id),
  -- a ordem em que o grupo aparece NAQUELE produto
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- O congelamento. Mesma disciplina do `order_items`: cópias, nunca leitura de
-- `options` na hora de mostrar o pedido.
create table order_item_options (
  id              uuid        primary key default gen_random_uuid(),
  order_item_id   uuid        not null references order_items (id),
  -- referência histórica: nenhuma leitura de pedido a consulta
  option_id       uuid        not null references options (id),
  -- o nome do grupo entra congelado porque sem ele não dá para reconstruir o
  -- agrupamento no recibo — sobraria uma lista solta de opções
  group_name      text        not null,
  name            text        not null,
  price_in_cents  integer     not null,
  quantity        integer     not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- O preço unitário JÁ com as opções, calculado e congelado.
--
-- Sem ele, ler o pedido exigiria refazer as regras de preço no cliente. E o
-- caminho ingênuo — somar os preços das opções — erra: em `highest` e
-- `average` os preços são ENTRADAS de uma fórmula, não parcelas. Medido: uma
-- pizza de R$ 30,00 com sabores de R$ 45,05 e R$ 50,00 custa R$ 77,53, e a
-- soma ingênua daria R$ 125,05.
--
-- O default 0 existe só para a coluna poder nascer `not null` num banco com
-- pedidos; o backfill logo abaixo põe o valor certo.
alter table order_items
  add column unit_price_in_cents integer not null default 0;

-- Pedido antigo não tem opção nenhuma, então o unitário é o preço do produto.
update order_items set unit_price_in_cents = price_in_cents;

create unique index option_groups_name_active_key
  on option_groups (restaurant_id, lower(name))
  where deleted_at is null;

create index option_groups_active_by_restaurant_idx
  on option_groups (restaurant_id, name, id)
  where deleted_at is null;

create index options_active_by_group_idx
  on options (option_group_id, position, name, id)
  where deleted_at is null;

create unique index product_option_groups_active_key
  on product_option_groups (product_id, option_group_id)
  where deleted_at is null;

create index product_option_groups_active_by_product_idx
  on product_option_groups (product_id, position, id)
  where deleted_at is null;

create index order_item_options_by_item_idx
  on order_item_options (order_item_id, id)
  where deleted_at is null;

-- Down Migration

drop index order_item_options_by_item_idx;
drop index product_option_groups_active_by_product_idx;
drop index product_option_groups_active_key;
drop index options_active_by_group_idx;
drop index option_groups_active_by_restaurant_idx;
drop index option_groups_name_active_key;

alter table order_items drop column unit_price_in_cents;

drop table order_item_options;
drop table product_option_groups;
drop table options;
drop table option_groups;
```

- [ ] **Step 3: Verificar `up` → `down` → `up` num banco descartável, com dado**

```bash
unset -f node pnpm
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_opt with (force)'
docker exec capstone-db psql -U postgres -q -c 'create database capstone_opt'
export DB_NAME=capstone_opt
pnpm --filter @menuclick/api migrate:up | tail -1

# o check de limites recusa grupo impossível
docker exec -i capstone-db psql -U postgres -d capstone_opt -qtA -c "
  insert into restaurants (id,name,slug,cuisine_type,street,number,neighborhood,city,state,zip_code,is_delivery,is_takeaway,is_qrcode)
  values ('11111111-1111-1111-1111-111111111111','R','r','J','x','1','y','z','SP','0',true,true,true);
  insert into option_groups (restaurant_id,name,min_options,max_options,price_rule)
  values ('11111111-1111-1111-1111-111111111111','Sabores',2,1,'highest');"
```

Esperado: `ERROR: … violates check constraint "option_groups_limits_check"`.

```bash
# o check de preço recusa opção negativa
docker exec -i capstone-db psql -U postgres -d capstone_opt -qtA -c "
  insert into option_groups (id,restaurant_id,name,min_options,max_options,price_rule)
  values ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Sabores',1,2,'highest');
  insert into options (option_group_id,name,price_in_cents) values ('22222222-2222-2222-2222-222222222222','Sem queijo',-200);"
```

Esperado: `ERROR: … violates check constraint "options_price_in_cents_check"`.

```bash
pnpm --filter @menuclick/api migrate:down | tail -1
docker exec -i capstone-db psql -U postgres -d capstone_opt -qtA -c "select to_regclass('option_groups') is null as sumiu, count(*) from information_schema.columns where table_name='order_items' and column_name='unit_price_in_cents' group by 1"
pnpm --filter @menuclick/api migrate:up | tail -1
docker exec capstone-db psql -U postgres -q -c 'drop database capstone_opt with (force)'
unset DB_NAME
```

Esperado: `t|0` no meio (tabela sumiu, coluna sumiu), e o `up` final aplicando sem erro.

- [ ] **Step 4: Recriar o banco de teste e rodar a suíte inteira**

```bash
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
pnpm --filter @menuclick/api test
```

Esperado: PASS — a migration não muda comportamento nenhum ainda.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/
git commit -m "feat(menu): ✨ tabelas dos grupos de opções

Quatro tabelas: os grupos (do restaurante, não do produto), as opções, a
junção com produtos e o congelamento no pedido. Mais \`unit_price_in_cents\`
em order_items — sem ele, ler o pedido exigiria refazer as regras de preço
no cliente, e somar as opções (o caminho ingênuo) erra por R\$ 47,52 numa
pizza.

Dois checks que não são decoração: preço de opção >= 0, porque o
arredondamento do average é assimétrico no negativo; e min <= max no grupo,
porque o inverso descreveria um grupo impossível de satisfazer e o sintoma
seria um pedido que nunca fecha."
```

---

### Task 3: CRUD de grupos de opções

**Files:**
- Create: `apps/api/src/repositories/option-groups.ts`
- Create: `apps/api/src/services/option-groups.ts`
- Create: `apps/api/src/routes/option-groups.ts`
- Create: `apps/api/test/option-groups.crud.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/openapi.ts`, `apps/api/test/helpers.ts`

**Interfaces:**
- Consumes: `PRICE_RULES`, `PriceRule` de `domain/option.ts` (Task 1).
- Produces:
  - repositório: `insert`, `findByRestaurant`, `findById`, `update`, `softDelete`, `softDeleteByRestaurant`, mais os tipos de linha `OptionGroupRow`/`OptionRow` e os mappers `toOptionGroup`/`toOption` (usados pela Task 5)
  - serviço: `create`, `listByRestaurant`, `getById`, `update`, `remove`
  - rota: `optionGroupRoutes(app)`
  - helper de teste: `createOptionGroup(app, restaurant, overrides)`

**O padrão a espelhar:** `src/repositories/categories.ts`, `src/services/categories.ts` e `src/routes/categories.ts`. Grupo tem a mesma forma de categoria — pertence ao restaurante, nome único sem diferenciar maiúscula (409), soft delete, envelope paginado. As diferenças estão listadas abaixo, campo a campo.

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/option-groups.crud.test.ts` com estes casos (o arquivo espelha `test/categories.crud.test.ts`, que já cobre a forma comum):

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createOptionGroup, createRestaurant } from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

describe("CRUD /restaurants/:restaurantId/option-groups", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("201 com os limites e a regra de preço", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: {
        name: "Sabores",
        minOptions: 1,
        maxOptions: 2,
        priceRule: "highest",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Sabores",
      minOptions: 1,
      maxOptions: 2,
      priceRule: "highest",
      restaurantId: restaurant.id,
    });
    expect(response.json().options).toEqual([]);
  });

  it("minOptions ausente vira 0 — grupo opcional", async () => {
    const restaurant = await createRestaurant(app);

    const grupo = await createOptionGroup(app, restaurant, {
      name: "Adicionais",
      maxOptions: 5,
      priceRule: "sum",
    });

    expect(grupo.minOptions).toBe(0);
  });

  /** Um grupo que exige mais do que aceita nunca poderia ser satisfeito. */
  it("400 quando minOptions é maior que maxOptions", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: {
        name: "Impossível",
        minOptions: 3,
        maxOptions: 2,
        priceRule: "sum",
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com maxOptions zero", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: { name: "Vazio", maxOptions: 0, priceRule: "sum" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com regra de preço fora da lista", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: { name: "X", maxOptions: 2, priceRule: "lowest" },
    });

    expect(response.statusCode).toBe(400);
  });

  /** Mesma política de categoria, e pelo mesmo motivo. */
  it("409 com nome repetido, sem diferenciar maiúscula", async () => {
    const restaurant = await createRestaurant(app);
    await createOptionGroup(app, restaurant, { name: "Adicionais" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
      payload: { name: "adicionais", maxOptions: 3, priceRule: "sum" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("o mesmo nome em outro restaurante é permitido", async () => {
    const primeiro = await createRestaurant(app);
    const segundo = await createRestaurant(app);
    await createOptionGroup(app, primeiro, { name: "Adicionais" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${segundo.id}/option-groups`,
      headers: segundo.headers,
      payload: { name: "Adicionais", maxOptions: 3, priceRule: "sum" },
    });

    expect(response.statusCode).toBe(201);
  });

  it("lista em envelope paginado, ordenada por nome", async () => {
    const restaurant = await createRestaurant(app);
    await createOptionGroup(app, restaurant, { name: "Sabores" });
    await createOptionGroup(app, restaurant, { name: "Adicionais" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().total).toBe(2);
    expect(response.json().data.map((g: { name: string }) => g.name)).toEqual([
      "Adicionais",
      "Sabores",
    ]);
  });

  it("PATCH renomeia e muda os limites", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
      payload: { name: "Sabores da casa", maxOptions: 4 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Sabores da casa",
      maxOptions: 4,
    });
  });

  /**
   * A checagem precisa considerar o valor RESULTANTE, não só o enviado: baixar
   * só o `maxOptions` pode deixá-lo abaixo do `minOptions` que já estava lá.
   */
  it("400 ao editar deixando minOptions acima de maxOptions", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Sabores",
      minOptions: 2,
      maxOptions: 3,
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
      payload: { maxOptions: 1 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("DELETE 204, e depois o GET dá 404", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });

    const remocao = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });
    const leitura = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });

    expect(remocao.statusCode).toBe(204);
    expect(leitura.statusCode).toBe(404);
  });

  it("grupo de outro restaurante é 404 (S19)", async () => {
    const dono = await createRestaurant(app);
    const intruso = await createRestaurant(app);
    const grupo = await createOptionGroup(app, dono, { name: "Sabores" });

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${intruso.id}/option-groups/${grupo.id}`,
      headers: intruso.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404 com id que não é uuid", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups/nao-e-uuid`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(404);
  });

  it("404 com grupo inexistente", async () => {
    const restaurant = await createRestaurant(app);

    const response = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/option-groups/${NONEXISTENT_ID}`,
      headers: restaurant.headers,
    });

    expect(response.statusCode).toBe(404);
  });
});
```

Acrescente o helper em `apps/api/test/helpers.ts`:

```ts
/**
 * Cria um grupo de opções via API. Como `createProduct`, recebe o restaurante
 * inteiro porque é rota de gestão e precisa do `headers`.
 */
export async function createOptionGroup(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/option-groups`,
    headers: restaurant.headers,
    payload: {
      name: "Adicionais",
      minOptions: 0,
      maxOptions: 3,
      priceRule: "sum",
      ...overrides,
    },
  });
  return response.json();
}
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @menuclick/api exec vitest run test/option-groups.crud.test.ts
```

Esperado: FAIL — 404 em tudo, porque a rota não existe.

- [ ] **Step 3: Implementar o repositório**

Crie `apps/api/src/repositories/option-groups.ts` espelhando `src/repositories/categories.ts`, com estas diferenças:

- `RowType` acrescenta `min_options: number`, `max_options: number`, `price_rule: PriceRule`.
- O mapper devolve `minOptions`, `maxOptions`, `priceRule` e **`options: []`** — a lista é preenchida por quem lê (Task 4); o mapper não a inventa.
- `ORDER_BY` é `"order by name, id"` (grupo não tem `position` próprio; a ordem dele é por produto, e mora na junção).
- O mapa de colunas editáveis é `{ name: "name", minOptions: "min_options", maxOptions: "max_options", priceRule: "price_rule" }`.
- `UNIQUE_VIOLATION = "23505"` e o `insert` devolve `null` na colisão, igual ao de categorias.
- `update` devolve a mesma união discriminada `{ outcome: "updated" | "not-found" | "name-taken" }` de `categories.ts`.
- `softDeleteByRestaurant(restaurantId, db)` existe para a cascata (Task 5).

- [ ] **Step 4: Implementar o serviço**

Crie `apps/api/src/services/option-groups.ts` espelhando `src/services/categories.ts` (`ensureExists` do restaurante em toda operação, `NotFoundError` para inexistente, `ConflictError` para nome repetido), mais **uma regra que categoria não tem**:

```ts
/**
 * Recusa limites que descrevem um grupo impossível de satisfazer.
 *
 * Checa o valor **resultante**, não o enviado: baixar só o `maxOptions` num
 * PATCH pode deixá-lo abaixo do `minOptions` que já estava gravado, e a
 * requisição sozinha não mostra isso. O banco tem o mesmo check como rede de
 * segurança, mas ele responderia 500 — a mensagem útil é escrita aqui.
 */
function assertLimitesCoerentes(minOptions: number, maxOptions: number): void {
  if (maxOptions < 1) {
    throw new ValidationError("O grupo precisa aceitar ao menos uma opção");
  }
  if (minOptions > maxOptions) {
    throw new ValidationError(
      `O grupo exige ${minOptions} opções mas aceita no máximo ${maxOptions}`,
    );
  }
}
```

No `create`, chame com os valores do input (usando os defaults `minOptions = 0`). No `update`, **leia o grupo atual primeiro** e chame com `input.minOptions ?? atual.minOptions` e `input.maxOptions ?? atual.maxOptions`.

- [ ] **Step 5: Implementar as rotas**

Crie `apps/api/src/routes/option-groups.ts` espelhando `src/routes/categories.ts`. Schemas:

```ts
const optionGroupNameSchema = { type: "string", minLength: 1, maxLength: 60 };

const createOptionGroupBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "maxOptions", "priceRule"],
  properties: {
    name: optionGroupNameSchema,
    // ausente = 0 = grupo opcional
    minOptions: { type: "integer", minimum: 0, default: 0 },
    maxOptions: { type: "integer", minimum: 1 },
    priceRule: { type: "string", enum: [...PRICE_RULES] },
  },
};

const updateOptionGroupBodySchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: optionGroupNameSchema,
    minOptions: { type: "integer", minimum: 0 },
    maxOptions: { type: "integer", minimum: 1 },
    priceRule: { type: "string", enum: [...PRICE_RULES] },
  },
};

const optionResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    priceInCents: { type: "integer" },
    maxQuantity: { type: "integer" },
    available: { type: "boolean" },
    position: { type: "integer" },
  },
};

const optionGroupResponseSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    restaurantId: { type: "string" },
    name: { type: "string" },
    minOptions: { type: "integer" },
    maxOptions: { type: "integer" },
    priceRule: { type: "string" },
    // as opções vêm aninhadas: uma opção fora do grupo dela não significa nada,
    // e uma rota para buscá-la sozinha só existiria para ser ignorada
    options: { type: "array", items: optionResponseSchema },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
};
```

Cinco rotas (`POST`, `GET` lista, `GET` detalhe, `PATCH`, `DELETE`) em `/restaurants/:restaurantId/option-groups[/:id]`, cada uma com `tags: ["Opções"]`, `operationId`, `summary` e `description`. Chame `installRouteValidators(app)` no começo do plugin.

- [ ] **Step 6: Registrar a rota e a tag**

Em `src/app.ts`, ao lado de `categoryRoutes`:

```ts
import { optionGroupRoutes } from "./routes/option-groups.ts";
// …
await app.register(optionGroupRoutes);
```

Em `src/openapi.ts`, junto das outras tags:

```ts
{
  name: "Opções",
  description:
    "Os grupos de opções do cardápio — tamanho, sabores, adicionais. O " +
    "grupo pertence ao restaurante e se liga a vários produtos, porque " +
    "\"Sabores\" vale para todas as pizzas.",
},
```

- [ ] **Step 7: Rodar, type-check e lint**

```bash
pnpm --filter @menuclick/api build
pnpm --filter @menuclick/api exec vitest run test/option-groups.crud.test.ts
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
```

Esperado: PASS, 14 testes.

- [ ] **Step 8: Verificar por mutação**

Remova a chamada de `assertLimitesCoerentes` do `update`. Rode o teste.
Esperado: **FALHA** em "400 ao editar deixando minOptions acima de maxOptions".

Troque o índice único para `(restaurant_id, name)` sem o `lower(...)`, derrube o banco de teste e rode.
Esperado: **FALHA** em "409 com nome repetido, sem diferenciar maiúscula".

Desfaça as duas.

- [ ] **Step 9: Regerar o OpenAPI, rodar a suíte e commitar**

```bash
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(menu): ✨ CRUD dos grupos de opções"
```

---

### Task 4: CRUD de opções dentro do grupo

**Files:**
- Modify: `apps/api/src/repositories/option-groups.ts`, `apps/api/src/services/option-groups.ts`, `apps/api/src/routes/option-groups.ts`
- Modify: `apps/api/test/option-groups.crud.test.ts`, `apps/api/test/helpers.ts`

**Interfaces:**
- Consumes: tudo da Task 3.
- Produces:
  - repositório: `insertOption`, `findOptionsByGroupIds(groupIds, db)`, `updateOption`, `softDeleteOption`, `softDeleteOptionsByGroups(groupIds, db)`
  - serviço: `createOption`, `updateOption`, `removeOption`
  - helper de teste: `createOption(app, restaurant, groupId, overrides)`

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `apps/api/test/option-groups.crud.test.ts`:

```ts
describe("opções dentro do grupo", () => {
  it("201, e a opção aparece aninhada no grupo", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });

    const criada = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
      headers: restaurant.headers,
      payload: { name: "Calabresa", priceInCents: 4505 },
    });
    const lido = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });

    expect(criada.statusCode).toBe(201);
    expect(criada.json()).toMatchObject({
      name: "Calabresa",
      priceInCents: 4505,
      maxQuantity: 1,
      available: true,
    });
    expect(lido.json().options).toHaveLength(1);
  });

  /** "Ponto da carne" é escolha obrigatória sem custo. */
  it("preço ausente é zero", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Ponto" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
      headers: restaurant.headers,
      payload: { name: "Ao ponto" },
    });

    expect(response.json().priceInCents).toBe(0);
  });

  /**
   * O `check` do banco é a rede; a recusa útil é aqui. Preço negativo fecharia
   * a porta da assimetria do arredondamento — ver a spec.
   */
  it("400 com preço negativo", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
      headers: restaurant.headers,
      payload: { name: "Sem queijo", priceInCents: -200 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("400 com preço em string — o validador não coage", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
      headers: restaurant.headers,
      payload: { name: "Bacon", priceInCents: "500" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("as opções saem ordenadas por position, com o nome desempatando", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });
    const criar = (name: string, position: number) =>
      app.inject({
        method: "POST",
        url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options`,
        headers: restaurant.headers,
        payload: { name, position },
      });
    await criar("Portuguesa", 1);
    await criar("Calabresa", 0);

    const response = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });

    expect(response.json().options.map((o: { name: string }) => o.name)).toEqual([
      "Calabresa",
      "Portuguesa",
    ]);
  });

  it("PATCH muda preço, disponibilidade e teto de unidades", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });
    const opcao = await createOption(app, restaurant, grupo.id, {
      name: "Bacon",
    });

    const response = await app.inject({
      method: "PATCH",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options/${opcao.id}`,
      headers: restaurant.headers,
      payload: { priceInCents: 700, available: false, maxQuantity: 3 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      priceInCents: 700,
      available: false,
      maxQuantity: 3,
    });
  });

  it("DELETE 204, e a opção some do grupo", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });
    const opcao = await createOption(app, restaurant, grupo.id, {
      name: "Bacon",
    });

    const remocao = await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}/options/${opcao.id}`,
      headers: restaurant.headers,
    });
    const lido = await app.inject({
      method: "GET",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });

    expect(remocao.statusCode).toBe(204);
    expect(lido.json().options).toEqual([]);
  });

  it("404 ao criar opção em grupo de outro restaurante", async () => {
    const dono = await createRestaurant(app);
    const intruso = await createRestaurant(app);
    const grupoAlheio = await createOptionGroup(app, dono, { name: "Sabores" });

    const response = await app.inject({
      method: "POST",
      url: `/restaurants/${intruso.id}/option-groups/${grupoAlheio.id}/options`,
      headers: intruso.headers,
      payload: { name: "Calabresa" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("remover o grupo remove as opções dele (D3)", async () => {
    const restaurant = await createRestaurant(app);
    const grupo = await createOptionGroup(app, restaurant, { name: "Extras" });
    const opcao = await createOption(app, restaurant, grupo.id, {
      name: "Bacon",
    });

    await app.inject({
      method: "DELETE",
      url: `/restaurants/${restaurant.id}/option-groups/${grupo.id}`,
      headers: restaurant.headers,
    });

    const { rows } = await pool.query<{ deleted_at: Date | null }>(
      "select deleted_at from options where id = $1",
      [opcao.id],
    );
    expect(rows[0].deleted_at).not.toBeNull();
  });
});
```

Acrescente `import { pool } from "../src/db/pool.ts";` e `createOption` aos imports do arquivo, e o helper em `helpers.ts`:

```ts
/** Cria uma opção dentro de um grupo, via API. */
export async function createOption(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  optionGroupId: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/option-groups/${optionGroupId}/options`,
    headers: restaurant.headers,
    payload: { name: "Bacon", priceInCents: 500, ...overrides },
  });
  return response.json();
}
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @menuclick/api exec vitest run test/option-groups.crud.test.ts
```

Esperado: FAIL nos casos novos (404 nas rotas de opção).

- [ ] **Step 3: Implementar o repositório das opções**

Acrescente a `src/repositories/option-groups.ts`:

```ts
/**
 * As opções vivas de vários grupos, em uma query só.
 *
 * Recebe uma lista porque quem lê grupos quase sempre lê mais de um — a
 * listagem, e o cardápio público. Uma consulta por grupo seria N+1 numa tela
 * que mostra o cardápio inteiro.
 */
export async function findOptionsByGroupIds(
  groupIds: string[],
  db: Queryable = pool,
): Promise<Map<string, Option[]>> {
  const porGrupo = new Map<string, Option[]>();
  if (groupIds.length === 0) return porGrupo;

  const { rows } = await db.query<OptionRow>(
    `select * from options
      where option_group_id = any($1::uuid[]) and deleted_at is null
      order by position, name, id`,
    [groupIds],
  );

  for (const row of rows) {
    const lista = porGrupo.get(row.option_group_id) ?? [];
    lista.push(toOption(row));
    porGrupo.set(row.option_group_id, lista);
  }
  return porGrupo;
}

/** Soft delete das opções de vários grupos — a cascata da remoção do grupo. */
export async function softDeleteOptionsByGroups(
  groupIds: string[],
  db: Queryable,
): Promise<void> {
  if (groupIds.length === 0) return;
  await db.query(
    `update options set deleted_at = now()
      where option_group_id = any($1::uuid[]) and deleted_at is null`,
    [groupIds],
  );
}
```

Mais `insertOption`, `updateOption` (SET dinâmico pelo mapa fixo `{ name, priceInCents: "price_in_cents", maxQuantity: "max_quantity", available, position }`) e `softDeleteOption`, todos escopados por `option_group_id`.

- [ ] **Step 4: Preencher `options` na leitura dos grupos**

No serviço, `getById` e `listByRestaurant` passam a chamar `findOptionsByGroupIds` com os ids que acabaram de ler e a preencher `options` em cada grupo. É o serviço que compõe — o repositório devolve as duas coisas cruas.

- [ ] **Step 5: Implementar serviço e rotas das opções**

No serviço, toda operação de opção começa por `getById(restaurantId, groupId)`, que já lança 404 para grupo alheio ou inexistente — é o que garante o escopo sem uma segunda checagem.

Três rotas: `POST /…/option-groups/:groupId/options`, `PATCH …/options/:id`, `DELETE …/options/:id`. Schema do corpo:

```ts
const createOptionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["name"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 60 },
    // ausente = 0: cobre a escolha obrigatória sem custo ("ponto da carne").
    // `minimum: 0` porque preço negativo tornaria o arredondamento do
    // `average` assimétrico — ver a spec.
    priceInCents: { type: "integer", minimum: 0, default: 0 },
    maxQuantity: { type: "integer", minimum: 1, default: 1 },
    available: { type: "boolean", default: true },
    position: { type: "integer", minimum: 0, default: 0 },
  },
};
```

E na remoção do grupo, o serviço passa a abrir transação:

```ts
await withTransaction(async (client) => {
  const removed = await optionGroupsRepository.softDelete(restaurantId, id, client);
  if (!removed) throw optionGroupNotFound(id);

  await optionGroupsRepository.softDeleteOptionsByGroups([id], client);
  await optionGroupsRepository.softDeleteLinksByGroups([id], client);
});
```

(`softDeleteLinksByGroups` chega na Task 5; até lá, deixe só as duas primeiras linhas e acrescente a terceira naquela tarefa.)

- [ ] **Step 6: Rodar, type-check, lint**

```bash
pnpm --filter @menuclick/api build
pnpm --filter @menuclick/api exec vitest run test/option-groups.crud.test.ts
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
```

Esperado: PASS, 23 testes.

- [ ] **Step 7: Verificar por mutação**

Remova `softDeleteOptionsByGroups` da remoção do grupo.
Esperado: **FALHA** em "remover o grupo remove as opções dele (D3)".

- [ ] **Step 8: Regerar o OpenAPI e commitar**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(menu): ✨ opções dentro do grupo"
```

---

### Task 5: O vínculo produto ↔ grupo, e as cascatas

**Files:**
- Modify: `apps/api/src/repositories/option-groups.ts`, `apps/api/src/services/option-groups.ts`, `apps/api/src/routes/option-groups.ts`
- Modify: `apps/api/src/services/restaurants.ts`, `apps/api/src/services/products.ts`
- Create: `apps/api/test/product-option-groups.test.ts`
- Modify: `apps/api/test/helpers.ts`

**Interfaces:**
- Consumes: tudo das Tasks 3 e 4.
- Produces:
  - repositório: `replaceProductLinks(productId, optionGroupIds, client)`,
    `findGroupsByProductIds(restaurantId, productIds, db)`,
    `softDeleteLinksByGroups(groupIds, db)`,
    `softDeleteLinksByProducts(productIds, db)`,
    `softDeleteLinksByRestaurant(restaurantId, db)`,
    `softDeleteOptionsByRestaurant(restaurantId, db)`
  - serviço: `replaceProductGroups(restaurantId, productId, optionGroupIds)`
  - helper de teste: `linkOptionGroups(app, restaurant, productId, ids)`

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/product-option-groups.test.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.ts";
import {
  buildTestApp,
  createOptionGroup,
  createProduct,
  createRestaurant,
  linkOptionGroups,
} from "./helpers.ts";

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * O vínculo entre produto e grupo de opções.
 *
 * Uma rota só (`PUT`) define a lista ordenada completa, em vez de três para
 * vincular, desvincular e reordenar: é como uma tela faz — marca as caixas e
 * arrasta a ordem —, e a posição sai do índice do array sem campo extra.
 */
describe("vínculo produto ↔ grupo de opções", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function cenario() {
    const restaurant = await createRestaurant(app);
    const produto = await createProduct(app, restaurant, { name: "Pizza" });
    const tamanho = await createOptionGroup(app, restaurant, {
      name: "Tamanho",
    });
    const sabores = await createOptionGroup(app, restaurant, {
      name: "Sabores",
    });
    return { restaurant, produto, tamanho, sabores };
  }

  it("define a lista ordenada, e a ordem é a do array", async () => {
    const { restaurant, produto, tamanho, sabores } = await cenario();

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      sabores.id,
      tamanho.id,
    ]);

    expect(response.statusCode).toBe(200);
    expect(
      response.json().optionGroups.map((g: { name: string }) => g.name),
    ).toEqual(["Sabores", "Tamanho"]);
  });

  it("é idempotente: mandar a mesma lista duas vezes não duplica", async () => {
    const { restaurant, produto, tamanho } = await cenario();

    await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);
    const segunda = await linkOptionGroups(app, restaurant, produto.id, [
      tamanho.id,
    ]);

    expect(segunda.json().optionGroups).toHaveLength(1);
  });

  it("lista vazia desvincula tudo", async () => {
    const { restaurant, produto, tamanho } = await cenario();
    await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

    const response = await linkOptionGroups(app, restaurant, produto.id, []);

    expect(response.json().optionGroups).toEqual([]);
  });

  /** O índice único é parcial, então revincular insere linha nova. */
  it("dá para revincular um grupo que tinha sido tirado", async () => {
    const { restaurant, produto, tamanho } = await cenario();
    await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);
    await linkOptionGroups(app, restaurant, produto.id, []);

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      tamanho.id,
    ]);

    expect(response.json().optionGroups).toHaveLength(1);
  });

  it("400 com id repetido na lista", async () => {
    const { restaurant, produto, tamanho } = await cenario();

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      tamanho.id,
      tamanho.id,
    ]);

    expect(response.statusCode).toBe(400);
  });

  it("404 com grupo de outro restaurante na lista", async () => {
    const { restaurant, produto } = await cenario();
    const outro = await createRestaurant(app);
    const grupoAlheio = await createOptionGroup(app, outro, { name: "Extras" });

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      grupoAlheio.id,
    ]);

    expect(response.statusCode).toBe(404);
  });

  it("404 com grupo inexistente na lista", async () => {
    const { restaurant, produto } = await cenario();

    const response = await linkOptionGroups(app, restaurant, produto.id, [
      NONEXISTENT_ID,
    ]);

    expect(response.statusCode).toBe(404);
  });

  it("404 com produto de outro restaurante", async () => {
    const { restaurant, tamanho } = await cenario();
    const outro = await createRestaurant(app);
    const produtoAlheio = await createProduct(app, outro);

    const response = await app.inject({
      method: "PUT",
      url: `/restaurants/${restaurant.id}/products/${produtoAlheio.id}/option-groups`,
      headers: restaurant.headers,
      payload: { optionGroupIds: [tamanho.id] },
    });

    expect(response.statusCode).toBe(404);
  });

  describe("cascatas", () => {
    /** Marca `deleted_at` nos vínculos vivos daquele produto. */
    async function vinculosVivos(productId: string) {
      const { rows } = await pool.query<{ n: string }>(
        `select count(*) as n from product_option_groups
          where product_id = $1 and deleted_at is null`,
        [productId],
      );
      return Number(rows[0].n);
    }

    it("remover o grupo desfaz os vínculos dele", async () => {
      const { restaurant, produto, tamanho } = await cenario();
      await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/option-groups/${tamanho.id}`,
        headers: restaurant.headers,
      });

      expect(await vinculosVivos(produto.id)).toBe(0);
    });

    it("remover o produto desfaz os vínculos dele", async () => {
      const { restaurant, produto, tamanho } = await cenario();
      await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}/products/${produto.id}`,
        headers: restaurant.headers,
      });

      expect(await vinculosVivos(produto.id)).toBe(0);
    });

    it("remover o restaurante alcança grupos, opções e vínculos", async () => {
      const { restaurant, produto, tamanho } = await cenario();
      await linkOptionGroups(app, restaurant, produto.id, [tamanho.id]);

      await app.inject({
        method: "DELETE",
        url: `/restaurants/${restaurant.id}`,
        headers: restaurant.headers,
      });

      const { rows } = await pool.query<{ deleted_at: Date | null }>(
        "select deleted_at from option_groups where id = $1",
        [tamanho.id],
      );
      expect(rows[0].deleted_at).not.toBeNull();
      expect(await vinculosVivos(produto.id)).toBe(0);
    });
  });
});
```

E o helper:

```ts
/** Define a lista ordenada de grupos de opções de um produto. */
export function linkOptionGroups(
  app: FastifyInstance,
  restaurant: TestRestaurant,
  productId: string,
  optionGroupIds: string[],
) {
  return app.inject({
    method: "PUT",
    url: `/restaurants/${restaurant.id}/products/${productId}/option-groups`,
    headers: restaurant.headers,
    payload: { optionGroupIds },
  });
}
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @menuclick/api exec vitest run test/product-option-groups.test.ts
```

Esperado: FAIL — 404 na rota `PUT`.

- [ ] **Step 3: Implementar o `replace` no repositório**

```ts
/**
 * Troca a lista de grupos de um produto pela informada, na ordem do array.
 *
 * Desvincula tudo e revincula, em vez de calcular a diferença: é uma tabela de
 * junção, a "rotatividade" de linhas não custa nada, e o código que calcula
 * diferença é onde mora o bug que ninguém vê. A posição sai do índice.
 *
 * Recebe o `client` porque as duas metades valem juntas ou não valem.
 */
export async function replaceProductLinks(
  productId: string,
  optionGroupIds: string[],
  client: PoolClient,
): Promise<void> {
  await client.query(
    `update product_option_groups set deleted_at = now()
      where product_id = $1 and deleted_at is null`,
    [productId],
  );

  if (optionGroupIds.length === 0) return;

  const values: unknown[] = [];
  const tuples: string[] = [];
  optionGroupIds.forEach((optionGroupId, position) => {
    values.push(productId, optionGroupId, position);
    // os `$n` vêm do TAMANHO do array, não de nada vindo do cliente (S2)
    const n = values.length;
    tuples.push(`($${n - 2}, $${n - 1}, $${n})`);
  });

  await client.query(
    `insert into product_option_groups (product_id, option_group_id, position)
     values ${tuples.join(", ")}`,
    values,
  );
}

/**
 * Os grupos vivos ligados a cada produto, com as opções aninhadas, em duas
 * queries — não uma por produto.
 */
export async function findGroupsByProductIds(
  restaurantId: string,
  productIds: string[],
  db: Queryable = pool,
): Promise<Map<string, OptionGroup[]>> {
  const porProduto = new Map<string, OptionGroup[]>();
  if (productIds.length === 0) return porProduto;

  const { rows } = await db.query<OptionGroupRow & { product_id: string }>(
    `select g.*, l.product_id
       from product_option_groups l
       join option_groups g on g.id = l.option_group_id
      where l.product_id = any($1::uuid[])
        and g.restaurant_id = $2
        and l.deleted_at is null
        and g.deleted_at is null
      order by l.product_id, l.position, g.name, g.id`,
    [productIds, restaurantId],
  );

  const opcoes = await findOptionsByGroupIds(
    [...new Set(rows.map((row) => row.id))],
    db,
  );

  for (const row of rows) {
    const lista = porProduto.get(row.product_id) ?? [];
    lista.push({ ...toOptionGroup(row), options: opcoes.get(row.id) ?? [] });
    porProduto.set(row.product_id, lista);
  }
  return porProduto;
}
```

Mais quatro, todas com `update … set deleted_at = now() where … and deleted_at is null`:

- `softDeleteLinksByGroups(groupIds, db)` — `where option_group_id = any($1::uuid[])`
- `softDeleteLinksByProducts(productIds, db)` — `where product_id = any($1::uuid[])`
- `softDeleteLinksByRestaurant(restaurantId, db)` — `where product_id in (select id from products where restaurant_id = $1)`
- `softDeleteOptionsByRestaurant(restaurantId, db)` — `where option_group_id in (select id from option_groups where restaurant_id = $1)`

As duas últimas usam subconsulta porque nem `product_option_groups` nem
`options` têm `restaurant_id` próprio: o dono delas é alcançado pelo pai.

- [ ] **Step 4: Implementar o serviço**

```ts
/**
 * Define a lista ordenada de grupos de um produto.
 *
 * Id repetido é 400, não deduplicação silenciosa: a tela que produz esta
 * chamada não consegue gerar repetição, então repetição é erro do cliente — e
 * aceitar em silêncio esconderia o erro em vez de mostrá-lo.
 */
export async function replaceProductGroups(
  restaurantId: string,
  productId: string,
  optionGroupIds: string[],
): Promise<OptionGroup[]> {
  await productsService.getById(restaurantId, productId); // 404 se não for dele

  if (new Set(optionGroupIds).size !== optionGroupIds.length) {
    throw new ValidationError("A lista de grupos tem ids repetidos");
  }

  // cada grupo é conferido contra o restaurante da rota; grupo alheio é 404
  for (const id of optionGroupIds) {
    await getById(restaurantId, id);
  }

  await withTransaction(async (client) => {
    await optionGroupsRepository.replaceProductLinks(
      productId,
      optionGroupIds,
      client,
    );
  });

  const porProduto = await optionGroupsRepository.findGroupsByProductIds(
    restaurantId,
    [productId],
  );
  return porProduto.get(productId) ?? [];
}
```

- [ ] **Step 5: Implementar a rota**

Em `src/routes/option-groups.ts` (a rota mora com os grupos, não com produtos, porque é o vínculo que ela edita):

```ts
app.put<{
  Params: { restaurantId: string; id: string };
  Body: { optionGroupIds: string[] };
}>(
  "/restaurants/:restaurantId/products/:id/option-groups",
  {
    schema: {
      tags: ["Opções"],
      operationId: "setProductOptionGroups",
      summary: "Define os grupos de opções do produto",
      description:
        "Substitui a lista **inteira**, na ordem do array — uma rota em vez de três (vincular, desvincular, reordenar), porque é como uma tela faz. Lista vazia desvincula tudo. Id repetido é 400; grupo de outro restaurante é 404.",
      params: productParamsSchema,
      body: {
        type: "object",
        additionalProperties: false,
        required: ["optionGroupIds"],
        properties: {
          optionGroupIds: { type: "array", items: { type: "string" } },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            optionGroups: {
              type: "array",
              items: optionGroupResponseSchema,
            },
          },
        },
        400: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  },
  async (request) => {
    const { restaurantId, id } = request.params;
    return {
      optionGroups: await optionGroupsService.replaceProductGroups(
        restaurantId,
        id,
        request.body.optionGroupIds,
      ),
    };
  },
);
```

- [ ] **Step 6: Ligar as cascatas**

Em `src/services/products.ts`, `remove` passa a abrir transação e chamar `softDeleteLinksByProducts([id], client)` junto do soft delete do produto.

Em `src/services/restaurants.ts`, dentro da transação que já existe, acrescente **depois** das duas linhas atuais:

```ts
await optionGroupsRepository.softDeleteLinksByRestaurant(id, client);
await optionGroupsRepository.softDeleteOptionsByRestaurant(id, client);
await optionGroupsRepository.softDeleteByRestaurant(id, client);
```

A ordem importa: vínculos e opções são marcados enquanto os grupos ainda estão vivos, senão a subconsulta que os encontra não acharia nada.

Em `src/services/option-groups.ts`, `remove` ganha a terceira linha prometida na Task 4:

```ts
await optionGroupsRepository.softDeleteLinksByGroups([id], client);
```

- [ ] **Step 7: Rodar, type-check, lint**

```bash
pnpm --filter @menuclick/api build
pnpm --filter @menuclick/api exec vitest run test/product-option-groups.test.ts
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
```

Esperado: PASS, 11 testes.

- [ ] **Step 8: Verificar por mutação**

Remova `softDeleteLinksByRestaurant` da cascata do restaurante.
Esperado: **FALHA** em "remover o restaurante alcança grupos, opções e vínculos".

Troque a checagem de repetidos por uma deduplicação silenciosa (`[...new Set(optionGroupIds)]`).
Esperado: **FALHA** em "400 com id repetido na lista".

- [ ] **Step 9: Regerar o OpenAPI, suíte inteira, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(menu): ✨ vincula grupos de opções ao produto"
```

---

### Task 6: Criação de pedido com opções

A tarefa mais delicada: valida, muda a chave de fusão e congela.

**Files:**
- Modify: `apps/api/src/domain/order.ts`, `apps/api/src/repositories/orders.ts`, `apps/api/src/services/orders.ts`, `apps/api/src/routes/orders.ts`
- Create: `apps/api/test/orders-options.test.ts`

**Interfaces:**
- Consumes: `unitPrice`, `PricedGroup` (Task 1); `findGroupsByProductIds` (Task 5).
- Produces:
  - `CreateOrderItemInput` ganha `options?: { optionId: string; quantity: number }[]`
  - `OrderItem` ganha `unitPriceInCents: number` e `options: OrderItemOption[]`
  - `type OrderItemOption = { optionId: string; groupName: string; name: string; priceInCents: number; quantity: number }`

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/test/orders-options.test.ts`. Casos obrigatórios (escreva cada um por extenso, no estilo dos arquivos existentes):

1. **Caminho feliz com `sum`** — produto R$ 30,00 + grupo "Adicionais" (`sum`) com Bacon R$ 5,00 `maxQuantity: 3`; pedir 2× bacon dá `unitPriceInCents: 4000` e `totalInCents: 4000`.
2. **Caminho feliz com `highest`** — pizza R$ 30,00 + "Sabores" (`highest`, `min 1`, `max 2`) com Calabresa 4505 e Portuguesa 5000; escolher os dois dá `unitPriceInCents: 8000`.
3. **`average` com meio centavo** — mesmo cenário com `priceRule: "average"` dá `7753` (30,00 + 47,53), e com `quantity: 2` no item o `totalInCents` é `15506` — igual a `unitPriceInCents × 2`, e **diferente** de `15505`, que sairia arredondando no total.
4. **Congelamento** — depois de criar o pedido, mude o preço da opção via PATCH e leia o pedido: `priceInCents` da opção e `unitPriceInCents` do item continuam os antigos.
5. **`groupName` congelado** — a leitura do pedido traz `options[].groupName === "Sabores"`.
6. **Fusão: mesmas opções fundem** — dois itens do mesmo produto com a mesma lista de opções viram uma linha de `quantity: 2`.
7. **🚨 Fusão: opções diferentes NÃO fundem** — dois itens do mesmo produto, um com bacon e outro sem, produzem **duas** linhas de `quantity: 1`.
8. **Opção repetida no mesmo item soma antes de checar o teto** — mandar `[{bacon,1},{bacon,1}]` com `maxQuantity: 3` vira `quantity: 2`; com `maxQuantity: 1` é 400.
9. **400 por opção de outro produto** — opção de um grupo não ligado ao produto.
10. **400 por grupo obrigatório sem escolha.**
11. **400 por exceder `maxOptions`** (opções distintas).
12. **400 por exceder `maxQuantity`.**
13. **400 por opção indisponível** (`available: false`).
14. **400 por `optionId` que não é uuid.**
15. **Pedido sem `options` continua funcionando** — o campo é opcional e o comportamento antigo não muda.

Todos os casos usam este cenário (defina-o no topo do `describe`):

```ts
/** Um hambúrguer com um grupo opcional de adicionais, bacon até 3 unidades. */
async function cenarioComAdicionais() {
  const restaurant = await createRestaurant(app);
  const produto = await createProduct(app, restaurant, {
    name: "Hambúrguer",
    priceInCents: 3000,
    stock: 50,
  });
  const grupo = await createOptionGroup(app, restaurant, {
    name: "Adicionais",
    minOptions: 0,
    maxOptions: 3,
    priceRule: "sum",
  });
  const bacon = await createOption(app, restaurant, grupo.id, {
    name: "Bacon",
    priceInCents: 500,
    maxQuantity: 3,
  });
  await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);
  return { restaurant, produto, grupo, bacon };
}

/** Uma pizza com "Sabores" obrigatório, para exercitar highest e average. */
async function cenarioComSabores(priceRule: "highest" | "average") {
  const restaurant = await createRestaurant(app);
  const produto = await createProduct(app, restaurant, {
    name: "Pizza",
    priceInCents: 3000,
    stock: 50,
  });
  const grupo = await createOptionGroup(app, restaurant, {
    name: "Sabores",
    minOptions: 1,
    maxOptions: 2,
    priceRule,
  });
  const calabresa = await createOption(app, restaurant, grupo.id, {
    name: "Calabresa",
    priceInCents: 4505,
  });
  const portuguesa = await createOption(app, restaurant, grupo.id, {
    name: "Portuguesa",
    priceInCents: 5000,
  });
  await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);
  return { restaurant, produto, grupo, calabresa, portuguesa };
}
```

Exemplo do caso 7, para fixar o estilo:

```ts
/**
 * A regra de fusão de linhas mudou por causa disto. Fundir por `productId`
 * transformaria "um com bacon" e "um sem bacon" em "dois hambúrgueres", e o
 * cliente receberia dois iguais.
 */
it("mesmo produto com opções diferentes gera DUAS linhas", async () => {
  const { restaurant, produto, bacon } = await cenarioComAdicionais();

  const order = await createOrder(app, restaurant.id, [
    { productId: produto.id, quantity: 1, options: [{ optionId: bacon.id, quantity: 1 }] },
    { productId: produto.id, quantity: 1 },
  ]);

  const detalhe = await app.inject({
    method: "GET",
    url: `/restaurants/${restaurant.id}/orders/${order.id}`,
    headers: restaurant.headers,
  });

  const items = detalhe.json().items;
  expect(items).toHaveLength(2);
  expect(items.map((i: { quantity: number }) => i.quantity).sort()).toEqual([1, 1]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @menuclick/api exec vitest run test/orders-options.test.ts
```

Esperado: FAIL — o schema do corpo rejeita `options` (`additionalProperties: false`).

- [ ] **Step 3: Estender os tipos e o schema**

`domain/order.ts`:

```ts
export type CreateOrderItemInput = {
  productId: string;
  quantity: number;
  /** Ausente = nenhuma opção. Produto sem grupo obrigatório aceita assim. */
  options?: { optionId: string; quantity: number }[];
};

/** Uma opção escolhida, congelada no item. */
export type OrderItemOption = {
  optionId: string;
  /** Cópia: sem ela não dá para reconstruir o agrupamento no recibo. */
  groupName: string;
  name: string;
  priceInCents: number;
  quantity: number;
};
```

`OrderItem` ganha `unitPriceInCents: number` e `options: OrderItemOption[]`.

Em `routes/orders.ts`, o item do corpo ganha:

```ts
options: {
  type: "array",
  default: [],
  items: {
    type: "object",
    additionalProperties: false,
    required: ["optionId", "quantity"],
    properties: {
      optionId: { type: "string" },
      quantity: { type: "integer", minimum: 1 },
    },
  },
},
```

E o `orderItemResponseSchema` ganha `unitPriceInCents: { type: "integer" }` e o array `options`.

- [ ] **Step 4: Implementar a validação e a fusão no serviço**

Em `services/orders.ts`, dentro da transação de `create`, depois de resolver os produtos:

```ts
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
      escolhas: doGrupo.map(({ opcao, quantity }) => ({
        priceInCents: opcao.priceInCents,
        quantity,
      })),
    });
  }

  return { congeladas, grupos: precificados };
}
```

O laço que hoje monta `quantityByProduct` passa a montar um `Map<string, LinhaEmMontagem>` chaveado por `chaveDeFusao`, onde cada linha guarda `productId`, `quantity` e o `Map<optionId, quantity>` das escolhas (com as repetições **somadas antes** da validação, como já acontece com produtos repetidos).

O total do pedido passa a ser:

```ts
const totalInCents = items.reduce(
  (sum, item) => sum + item.unitPriceInCents * item.quantity,
  0,
);
```

- [ ] **Step 5: Gravar e ler as opções no repositório**

`insertItems` passa a receber `unitPriceInCents` e a devolver os ids gerados (`returning id`), para que as opções possam ser inseridas referenciando cada item. Acrescente `insertItemOptions(rows, db)` com o mesmo padrão de tuplas de `insertItems`, e faça `findItems` carregar as opções de todos os itens em **uma** query (`where order_item_id = any($1::uuid[])`), agrupando no mapper — nunca uma consulta por item.

- [ ] **Step 6: Rodar, type-check, lint**

```bash
pnpm --filter @menuclick/api build
pnpm --filter @menuclick/api exec vitest run test/orders-options.test.ts
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
```

Esperado: PASS, 15 testes.

- [ ] **Step 7: Verificar por mutação**

Volte a chave de fusão para só o `productId`.
Esperado: **FALHA** em "mesmo produto com opções diferentes gera DUAS linhas".

Troque o total para `Math.round` sobre o total do item em vez do unitário.
Esperado: **FALHA** no caso 3 (`average` com dois itens).

Remova a checagem de `available`.
Esperado: **FALHA** no caso 13.

- [ ] **Step 8: Suíte inteira, OpenAPI, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(orders)!: ✨ pedido com opções escolhidas

BREAKING CHANGE: itens do pedido ganham \`options\` no corpo e
\`unitPriceInCents\` na resposta.

A chave de fusão de linhas deixa de ser só o productId: com opções, ela
transformaria \"um hambúrguer com bacon\" e \"um sem bacon\" em \"dois
hambúrgueres\", e o cliente receberia dois iguais."
```

---

### Task 7: A conferência de estoque somada por produto

**Files:**
- Modify: `apps/api/src/services/orders.ts:393-417` (`debitarEstoque`)
- Modify: `apps/api/test/orders-confirm.test.ts`

**Interfaces:**
- Consumes: as linhas múltiplas por produto que a Task 6 tornou possíveis.
- Produces: nada novo — corrige comportamento.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente a `apps/api/test/orders-confirm.test.ts`:

```ts
/**
 * Consequência direta da Task 6: como o mesmo produto agora pode aparecer em
 * várias linhas (opções diferentes), conferir linha a linha deixa cada uma ver
 * o estoque inteiro. Duas linhas de 3 unidades passariam por uma checagem de
 * "tem 4?" que ambas consideram suficiente, e o débito levaria o estoque a -2.
 */
it("soma as linhas do mesmo produto antes de conferir o estoque", async () => {
  const restaurant = await createRestaurant(app);
  const grupo = await createOptionGroup(app, restaurant, {
    name: "Adicionais",
    maxOptions: 1,
    priceRule: "sum",
  });
  const bacon = await createOption(app, restaurant, grupo.id, { name: "Bacon" });
  const produto = await createProduct(app, restaurant, { stock: 4 });
  await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

  const order = await createOrder(app, restaurant.id, [
    { productId: produto.id, quantity: 3, options: [{ optionId: bacon.id, quantity: 1 }] },
    { productId: produto.id, quantity: 3 },
  ]);

  const response = await app.inject({
    method: "POST",
    url: `/restaurants/${restaurant.id}/orders/${order.id}/confirm`,
    headers: restaurant.headers,
  });

  expect(response.statusCode).toBe(409);

  // e o estoque não foi tocado
  const produtoDepois = await app.inject({
    method: "GET",
    url: `/restaurants/${restaurant.id}/products/${produto.id}`,
    headers: restaurant.headers,
  });
  expect(produtoDepois.json().stock).toBe(4);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
pnpm --filter @menuclick/api exec vitest run test/orders-confirm.test.ts
```

Esperado: FAIL — devolve 200, e o estoque fica em −2.

- [ ] **Step 3: Corrigir a conferência**

Substitua o primeiro laço de `debitarEstoque`:

```ts
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
```

- [ ] **Step 4: Rodar e ver passar**

```bash
pnpm --filter @menuclick/api exec vitest run test/orders-confirm.test.ts
```

Esperado: PASS, incluindo os testes de corrida que já existiam.

- [ ] **Step 5: Verificar por mutação**

Volte `stock < pedido` para `stock < item.quantity`.
Esperado: **FALHA** no teste novo, e os antigos continuam passando — o que mostra que ele cobre exatamente o buraco.

- [ ] **Step 6: Suíte inteira e commit**

```bash
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "fix(orders): 🐛 soma as linhas do mesmo produto ao conferir estoque

Com opções, o mesmo produto pode aparecer em mais de uma linha do pedido.
Conferindo linha a linha, cada uma enxergava o estoque inteiro: duas linhas
de 3 unidades passavam por uma checagem de \"tem 4?\" e o débito levava o
estoque a -2."
```

---

### Task 8: O cardápio público

**Files:**
- Modify: `apps/api/src/domain/menu.ts`, `apps/api/src/services/menu.ts`, `apps/api/src/routes/menu.ts`
- Modify: `apps/api/src/repositories/products.ts`, `apps/api/src/services/products.ts`
- Modify: `apps/api/test/menu-public.test.ts`

**Interfaces:**
- Consumes: `findGroupsByProductIds` (Task 5).
- Produces: `MenuOptionGroup`; `MenuProduct` ganha `optionGroupIds`; a página do cardápio ganha `optionGroups`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente a `apps/api/test/menu-public.test.ts`:

```ts
describe("grupos de opções no cardápio", () => {
  it("os grupos vêm normalizados, cada um uma vez", async () => {
    const restaurant = await createRestaurant(app, { slug: "pizzaria" });
    const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });
    await createOption(app, restaurant, grupo.id, { name: "Calabresa" });
    // DOIS produtos usando o MESMO grupo: é o que o formato normalizado evita
    // repetir
    for (const nome of ["Pizza Grande", "Pizza Média"]) {
      const produto = await createProduct(app, restaurant, {
        name: nome,
        categoryId: categoria.id,
        stock: 10,
      });
      await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);
    }

    const response = await app.inject({
      method: "GET",
      url: "/menu/pizzaria/products",
    });

    const body = response.json();
    expect(body.optionGroups).toHaveLength(1);
    expect(body.optionGroups[0].options[0].name).toBe("Calabresa");
    for (const produto of body.data[0].products) {
      expect(produto.optionGroupIds).toEqual([grupo.id]);
    }
  });

  it("opção indisponível não sai no cardápio", async () => {
    const restaurant = await createRestaurant(app, { slug: "pizzaria" });
    const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
    const grupo = await createOptionGroup(app, restaurant, { name: "Sabores" });
    await createOption(app, restaurant, grupo.id, { name: "Calabresa" });
    await createOption(app, restaurant, grupo.id, {
      name: "Fora de estoque",
      available: false,
    });
    const produto = await createProduct(app, restaurant, {
      categoryId: categoria.id,
      stock: 10,
    });
    await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

    const response = await app.inject({
      method: "GET",
      url: "/menu/pizzaria/products",
    });

    expect(
      response.json().optionGroups[0].options.map((o: { name: string }) => o.name),
    ).toEqual(["Calabresa"]);
  });

  /**
   * A regra do iFood: "o item não aparece à venda enquanto não houver opção
   * para o usuário selecionar". Sem isso o cliente montaria um carrinho que a
   * criação de pedido recusaria.
   */
  it("produto com grupo obrigatório sem opção disponível fica indisponível", async () => {
    const restaurant = await createRestaurant(app, { slug: "pizzaria" });
    const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Sabores",
      minOptions: 1,
      maxOptions: 2,
      priceRule: "highest",
    });
    await createOption(app, restaurant, grupo.id, {
      name: "Calabresa",
      available: false,
    });
    const produto = await createProduct(app, restaurant, {
      categoryId: categoria.id,
      stock: 10,
    });
    await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

    const response = await app.inject({
      method: "GET",
      url: "/menu/pizzaria/products",
    });

    expect(response.json().data[0].products[0].available).toBe(false);
  });

  it("grupo opcional sem opção não torna o produto indisponível", async () => {
    const restaurant = await createRestaurant(app, { slug: "pizzaria" });
    const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
    const grupo = await createOptionGroup(app, restaurant, {
      name: "Adicionais",
      minOptions: 0,
      maxOptions: 3,
      priceRule: "sum",
    });
    const produto = await createProduct(app, restaurant, {
      categoryId: categoria.id,
      stock: 10,
    });
    await linkOptionGroups(app, restaurant, produto.id, [grupo.id]);

    const response = await app.inject({
      method: "GET",
      url: "/menu/pizzaria/products",
    });

    expect(response.json().data[0].products[0].available).toBe(true);
  });

  it("cardápio sem grupo nenhum devolve optionGroups vazio", async () => {
    const restaurant = await createRestaurant(app, { slug: "pizzaria" });
    const categoria = await createCategory(app, restaurant, { name: "Pizzas" });
    await createProduct(app, restaurant, { categoryId: categoria.id, stock: 5 });

    const response = await app.inject({
      method: "GET",
      url: "/menu/pizzaria/products",
    });

    expect(response.json().optionGroups).toEqual([]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Esperado: FAIL — `optionGroups` é `undefined`.

- [ ] **Step 3: Implementar**

`domain/menu.ts`:

```ts
/**
 * Um grupo de opções como o público o vê.
 *
 * Vem **fora** dos produtos, uma vez cada. Embutir repetiria "Sabores" com
 * vinte opções dentro de cada pizza; como os grupos são reutilizáveis, eles são
 * poucos, e incluir cada um uma vez é barato.
 */
export type MenuOptionGroup = {
  id: string;
  name: string;
  minOptions: number;
  maxOptions: number;
  priceRule: PriceRule;
  options: {
    id: string;
    name: string;
    priceInCents: number;
    maxQuantity: number;
  }[];
};
```

`MenuProduct` ganha `optionGroupIds: string[]`.

Em `services/menu.ts`, `listProducts` passa a:

1. buscar os grupos de todos os produtos da página numa chamada só (`findGroupsByProductIds`);
2. filtrar as opções indisponíveis;
3. calcular `available` com a regra nova;
4. devolver `optionGroups` deduplicados no topo.

```ts
/**
 * O produto está à venda?
 *
 * Deixou de ser só `stock > 0`: um grupo obrigatório sem opção disponível
 * suficiente torna o produto impossível de pedir, e o cardápio precisa dizer
 * isso ANTES de a pessoa montar o carrinho — senão ela monta e a criação
 * recusa. É a regra do iFood.
 */
function estaDisponivel(product: Product, grupos: MenuOptionGroup[]): boolean {
  if (product.stock <= 0) return false;
  return grupos.every(
    (grupo) => grupo.minOptions === 0 || grupo.options.length >= grupo.minOptions,
  );
}
```

Em `routes/menu.ts`, o `menuSectionPageResponseSchema` ganha `optionGroups` ao lado de `data`, e `menuProductResponseSchema` ganha `optionGroupIds: { type: "array", items: { type: "string" } }`.

- [ ] **Step 4: Rodar, type-check, lint**

Esperado: PASS. Os testes antigos do cardápio continuam passando — `optionGroups` vazio não muda nada para quem não tem grupo.

- [ ] **Step 5: Verificar por mutação**

Faça `estaDisponivel` devolver só `product.stock > 0`.
Esperado: **FALHA** em "produto com grupo obrigatório sem opção disponível fica indisponível".

Pare de filtrar opção indisponível.
Esperado: **FALHA** em "opção indisponível não sai no cardápio".

- [ ] **Step 6: OpenAPI, suíte, commit**

```bash
pnpm --filter @menuclick/api openapi:generate
pnpm --filter @menuclick/api test
git add apps/api/ && git commit -m "feat(menu)!: ✨ cardápio público entrega os grupos de opções

BREAKING CHANGE: a resposta do cardápio ganha \`optionGroups\` no topo e
\`optionGroupIds\` em cada produto.

Normalizado, não embutido: como os grupos são reutilizáveis, eles são
poucos, e repeti-los dentro de cada produto multiplicaria a resposta.

\`available\` deixa de ser só \`stock > 0\` — grupo obrigatório sem opção
disponível torna o produto impossível de pedir, e o cliente precisa saber
disso antes de montar o carrinho."
```

---

### Task 9: Seed, verificação de ponta a ponta e documentação

**Files:**
- Modify: `apps/api/src/db/seed.sql`, `CLAUDE.md`

- [ ] **Step 1: Acrescentar grupos ao seed**

No `seed.sql`, depois do bloco de produtos, com ids fixos e `on conflict (id) do nothing` (o seed é idempotente, ao contrário das migrations):

- grupo "Tamanho" (`min 1`, `max 1`, `sum`) com "Média" R$ 0,00 e "Grande" R$ 1.200;
- grupo "Sabores" (`min 1`, `max 2`, `highest`) com dois sabores de preços diferentes — é o que torna o meio a meio testável à mão;
- grupo "Adicionais" (`min 0`, `max 3`, `sum`) com "Bacon" R$ 500 e `max_quantity: 3`;
- vínculos ligando os três ao produto de pizza do Tokyo.

- [ ] **Step 2: Verificar o seed num banco novo**

```bash
unset -f node pnpm
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_seed with (force)'
docker exec capstone-db psql -U postgres -q -c 'create database capstone_seed'
export DB_NAME=capstone_seed
pnpm --filter @menuclick/api migrate:up | tail -1
pnpm --filter @menuclick/api db:seed | tail -1
pnpm --filter @menuclick/api db:seed | tail -1   # idempotência
docker exec capstone-db psql -U postgres -q -c 'drop database capstone_seed with (force)'
unset DB_NAME
```

Esperado: as duas execuções do seed reportam os mesmos números.

- [ ] **Step 3: Verificar de ponta a ponta com a API no ar**

```bash
cd apps/api
lsof -ti:3399 | xargs -r kill -9
PORT=3399 node --env-file-if-exists=.env src/server.ts > /tmp/api-3399.log 2>&1 &
```

Cadastre um restaurante, crie uma pizza com os três grupos, faça um pedido meio a meio com 2 unidades e confira **à mão** que:

- `unitPriceInCents` bate com a conta da spec;
- `totalInCents === unitPriceInCents × 2`;
- a leitura do pedido traz `options[].groupName`;
- mudar o preço da opção depois **não** muda o pedido.

⚠️ Num DELETE sem corpo, **não** mande `content-type: application/json` — o Fastify recusa com 400, e isso já custou um falso alarme neste projeto.

- [ ] **Step 4: Documentar no `CLAUDE.md`**

Nova seção "Grupos de opções", depois de "Categorias e o cardápio agrupado", cobrindo: os quatro níveis, o grupo pertencer ao restaurante, as três regras de preço, **a aritmética de dinheiro** (arredondar uma vez no unitário, aritmética inteira, o `check >= 0` e por que ele não contradiz a ausência de `check (stock >= 0)`), a mudança na chave de fusão e a conferência somada por produto.

Atualize também a linha de abertura ("O que é") e a lista de tabelas na seção de banco.

- [ ] **Step 5: Verificação final e commit**

```bash
docker exec capstone-db psql -U postgres -q -c 'drop database if exists capstone_test with (force)'
cd /Users/guilhermepassarinho/Desktop/Projects/MenuClick && pnpm lint
cd apps/api && pnpm --filter @menuclick/api build && pnpm --filter @menuclick/api test
git add -A && git commit -m "docs: 📝 documenta os grupos de opções e a aritmética de dinheiro"
```

- [ ] **Step 6: Verificar cada commit isoladamente**

Numa worktree destacada com `node_modules` linkado, para cada commit do branch: `eslint`, `tsc --noEmit` e `vitest run`, com o banco de teste derrubado antes de cada um (as migrations mudam entre commits). Nenhum commit pode depender do seguinte.

---

## Ordem e dependências

```
Task 1 (preço, puro) ──┐
Task 2 (migration) ────┼─→ Task 3 (CRUD grupo) → Task 4 (CRUD opção) → Task 5 (vínculo)
                       │                                                      │
                       │                          ┌───────────────────────────┤
                       │                          ↓                           ↓
                       └────────────────────→ Task 6 (pedido) → Task 7 (estoque)
                                                                              │
                                              Task 8 (cardápio) ←─────────────┘
                                                      ↓
                                              Task 9 (seed e docs)
```

Tasks 1 e 2 são independentes entre si e podem ser feitas em qualquer ordem. Tudo depois delas é sequencial.

## Fora de escopo

Da spec, e nenhum bloqueia esta implementação: estoque por opção, a regra `menor`, módulo de pizza com matriz tamanho × sabor, grupos condicionais, e o trio taxa de entrega / horário de funcionamento / forma de pagamento — que é a PR seguinte.
