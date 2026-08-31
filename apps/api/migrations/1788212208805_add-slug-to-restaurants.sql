-- Up Migration
-- `slug`: o identificador público do restaurante, o que vai dentro do QR code.
--
-- Sem ele a URL do cardápio seria `/menu/cb95db58-0ea1-4157-a6fd-64f775f24a6e`
-- — um UUID não é endereço que alguém digita, imprime num cartaz ou reconhece.
--
-- A coluna nasce nulável porque a tabela já tem dado: adiciona, preenche,
-- e só então exige `not null`. Fazer os três passos numa migration só é o que
-- mantém o `up` aplicável em banco populado.

alter table restaurants add column slug text;

-- Backfill: slug a partir do nome, mais os 8 primeiros caracteres do id.
--
-- O sufixo do id garante unicidade sem depender de a geração ser esperta, e
-- sem precisar da extensão `unaccent` (que exigiria superusuário no banco).
-- O preço é que acento vira hífen aqui — "São Paulo" sai como `s-o-paulo`.
-- Vale só para as linhas antigas: slug NOVO é gerado no Node, onde
-- `String.normalize("NFD")` remove o acento direito e sem dependência nenhuma.
update restaurants
   set slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
              || '-' || left(id::text, 8);

alter table restaurants alter column slug set not null;

-- Unicidade parcial (D6): `unique (slug)` comum deixaria o slug de um
-- restaurante removido bloqueado para sempre, mesmo ninguém mais o usando.
create unique index restaurants_slug_active_key
  on restaurants (slug)
  where deleted_at is null;

-- Down Migration

drop index restaurants_slug_active_key;
alter table restaurants drop column slug;
