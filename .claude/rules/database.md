# Regras: Banco de dados (Postgres + `pg`)

Regras **obrigatórias** para todo SQL da API (`apps/api`). Não há ORM nem query builder: `apps/api/src/db/pool.ts` exporta um `Pool` singleton do driver `pg` e os **repositórios** (`apps/api/src/repositories/`) escrevem SQL na mão. SQL só existe lá — rota e serviço nunca escrevem query.

## 1. Soft delete — a regra que não pode ser quebrada

**Nada é apagado do banco.** Toda tabela do projeto tem uma coluna `deleted_at timestamptz` nulável:

- `deleted_at IS NULL` → registro **vivo**
- `deleted_at` preenchido → registro **removido** (invisível para a API, mas ainda no banco)

- **D1 — `DELETE` da API vira `UPDATE`.** Nunca escreva `delete from ...` no código da aplicação. Use:
  ```sql
  update products set deleted_at = now()
   where id = $1 and deleted_at is null
  ```
  O `and deleted_at is null` não é decoração: sem ele, apagar duas vezes devolveria sucesso na segunda e sobrescreveria a data original. Com ele, `rowCount === 0` significa "não existe **ou** já foi removido" → responda **404**, igual a um id inexistente.

- **D2 — Toda leitura filtra `deleted_at is null`.** `SELECT`, `UPDATE` e a checagem de existência. Um registro removido tem que se comportar como se nunca tivesse existido: 404 no `GET`, 404 no `PATCH`, fora da listagem, e não pode ser pai de novos filhos (não dá pra criar produto em restaurante removido).

- **D3 — Cascata é explícita e transacional.** Sem `on delete cascade` (ele nunca dispararia, já que não há DELETE de verdade). Remover um pai marca os filhos na **mesma transação**, com o helper `withTransaction()` de `db/pool.ts`:
  ```ts
  await withTransaction(async (client) => {
    await client.query(`update restaurants set deleted_at = now() where id = $1 and deleted_at is null`, [id]);
    await client.query(`update products set deleted_at = now() where restaurant_id = $1 and deleted_at is null`, [id]);
  });
  ```
  Dentro da transação use **sempre o `client`** recebido; usar o `pool` direto manda a query por outra conexão, fora da transação.

- **D4 — `deleted_at` não aparece na API.** Não entra em `schema.response` nem nos mappers. É detalhe de persistência, não do contrato.

- **D5 — Índice parcial, não índice comum.** Como toda consulta filtra vivos, os índices também filtram:
  ```sql
  create index if not exists products_active_by_restaurant_idx
    on products (restaurant_id, created_at, id)
    where deleted_at is null;
  ```
  O índice fica menor e não cresce junto com a lixeira.

- **D6 — Unicidade também é parcial.** `unique (email)` normal impediria recriar um registro que foi removido. Use índice único parcial:
  ```sql
  create unique index restaurants_slug_active_key
    on restaurants (slug) where deleted_at is null;
  ```

- **D7 — Restaurar é `set deleted_at = null`.** Ainda não há rota para isso (nem precisa); por enquanto é SQL na mão. Se um dia surgir uma rotina de expurgo (apagar de verdade o que está removido há X meses), ela é um script separado e explícito — nunca um efeito colateral de rota.

## 2. Queries

- **D8 — Sempre parametrizado** (`$1`, `$2`, ...). Nunca interpole valor vindo do cliente na string SQL. Em `UPDATE` com SET dinâmico, monte as atribuições percorrendo um **mapa fixo campo→coluna** (ver o `update()` em `repositories/restaurants.ts`), nunca as chaves do body.
- **D9 — `INSERT ... RETURNING *`** e devolva a linha retornada. `id`, `created_at` e `updated_at` vêm de defaults da tabela — não gere no Node.
- **D10 — `updated_at = now()` em todo UPDATE** de conteúdo.
- **D11 — Ordenação determinística:** `order by created_at, id` (só `created_at` empata se duas linhas nascerem no mesmo instante).

## 3. Tipos e convenções de schema

- **D12 — Colunas em `snake_case`; a API responde em `camelCase`.** A tradução é feita por um mapper `toX(row)` por tabela, que também converte `Date` → ISO string. Não use alias com aspas (`"createdAt"`) no SQL.
- **D13 — Timestamp é sempre `timestamptz`**, nunca `timestamp`. Coluna sem fuso é lida pelo `pg` no fuso da máquina, e o mesmo registro vira horários diferentes em máquinas diferentes.
- **D14 — `id` é `uuid`** com default `gen_random_uuid()`. Um id fora do formato faz o Postgres estourar `invalid input syntax for type uuid` (viraria 500), então valide com `isUuid()` **antes** de consultar e devolva 404.
- **D15 — Value object pode virar colunas planas.** Endereço é `street`/`number`/`neighborhood`/`city`/`state`/`zip_code`, não jsonb — dá pra filtrar por cidade depois. Quem monta o objeto aninhado da resposta é o mapper.

## 4. Migrações

Ferramenta: **`node-pg-migrate`**, com migrations em **SQL puro** (`.sql`) em `apps/api/migrations/`. Cada arquivo tem as seções `-- Up Migration` e `-- Down Migration`, e o que já rodou fica registrado na tabela `pgmigrations`.

```bash
pnpm --filter @menuclick/api migrate:create <nome>   # cria o arquivo com timestamp + template
pnpm --filter @menuclick/api migrate:up              # aplica as pendentes
pnpm --filter @menuclick/api migrate:down            # desfaz a última
pnpm --filter @menuclick/api db:seed                 # popula dados de exemplo (idempotente)
```

- **D16 — Toda mudança de schema é uma migration nova.** Nunca edite uma migration que já rodou (nem a inicial): quem já aplicou não vai aplicar de novo, e os bancos divergem em silêncio. Corrigiu algo? Migration nova por cima.
- **D17 — Toda migration tem `Down` que realmente desfaz o `Up`.** Sem isso o `migrate:down` mente. Se for irreversível de verdade (perda de dado), diga isso num comentário em vez de deixar a seção vazia.
- **D18 — Migration não usa `if not exists`.** Ela roda exatamente uma vez, controlada pelo `pgmigrations`; `if not exists` só mascara migration aplicada fora de ordem. (O `seed.sql` é o oposto: **precisa** ser idempotente, com ids fixos e `on conflict do nothing`.)
- **D19 — Banco que já tem as tabelas precisa de baseline**, não de `migrate:up`: crie a tabela `pgmigrations` e insira o nome da migration inicial (o nome do arquivo sem `.sql`) marcando-a como aplicada. Rodar `up` num banco já populado tentaria recriar tudo e falharia.
- **D20 — Migrations e código andam no mesmo commit.** Coluna nova sem a migration junto quebra o `pnpm dev` de quem der `git pull`.
- **D21 — Crie migration sempre pelo `migrate:create`**, nunca escrevendo o arquivo à mão: é ele que gera o prefixo de timestamp correto, que define a ordem de execução.
