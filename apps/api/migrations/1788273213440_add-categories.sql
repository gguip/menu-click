-- Up Migration

-- Categoria vira entidade do restaurante. Até aqui ela era um texto livre em
-- `products.category`, o que aceitava "Bebidas" e "bebidas" como coisas
-- diferentes no mesmo cardápio — e tornava impossível ordenar as seções, ou
-- somar um relatório por categoria sem confiar na digitação.
--
-- Esta migration só cria a entidade. Ligar os produtos a ela (e apagar a coluna
-- de texto) é a migration seguinte.

create table categories (
  id            uuid        primary key default gen_random_uuid(),
  -- sem `on delete cascade`, como o resto do projeto: nada é apagado de
  -- verdade, e a cascata é feita marcando deleted_at na mesma transação (D3)
  restaurant_id uuid        not null references restaurants (id),
  name          text        not null,
  -- a ordem é do restaurante, não alfabética: "Entradas" vem antes de
  -- "Sobremesas" pela sequência da refeição. Default 0 porque o serviço
  -- resolve a posição de quem não a informa (vai para o fim).
  position      integer     not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Unicidade por nome dentro do restaurante, e **sem diferenciar maiúscula**:
-- "Bebidas" e "bebidas" no mesmo cardápio são a mesma seção digitada duas
-- vezes, que é exatamente o que a entidade existe para impedir.
-- Parcial (D6): categoria removida não pode bloquear a recriação do nome.
create unique index categories_name_active_key
  on categories (restaurant_id, lower(name))
  where deleted_at is null;

-- Casa com o `order by position, name, id` da listagem (D5/D11).
create index categories_active_by_restaurant_idx
  on categories (restaurant_id, position, name, id)
  where deleted_at is null;

-- Down Migration

drop index categories_active_by_restaurant_idx;
drop index categories_name_active_key;
drop table categories;
