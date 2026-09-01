-- Up Migration

-- O papel do usuário dentro do restaurante.
--
-- Existe por um risco concreto: a partir da rota de criação de usuário, o
-- restaurante deixa de ter um login só — e sem papel, o atendente convidado
-- herdaria o poder de **apagar o restaurante inteiro** (soft delete que
-- cascateia para produtos e categorias). Convidar alguém viraria um ato de
-- confiança total.
--
-- São dois papéis e nada além disso, de propósito. A checagem vale em duas
-- ações — remover o restaurante e administrar usuários —, que são exatamente
-- as destrutivas; cardápio, pedidos e configurações continuam iguais para os
-- dois. Um sistema de permissão por ação é escopo bem maior do que o buraco
-- que esta migration tapa, e meio implementado seria pior que ausente.
--
-- O default é `owner` porque ele cobre o banco existente: quem já está lá
-- entrou pelo /auth/register e é dono do próprio restaurante. Quem nasce
-- `staff` só nasce pela rota nova, que sempre informa o papel.
alter table restaurant_users
  add column role text not null default 'owner'
  check (role in ('owner', 'staff'));

-- Down Migration

-- Irreversível quanto ao dado: a distinção entre dono e atendente só existe
-- nesta coluna, então desfazer devolve todo mundo ao estado em que qualquer
-- usuário faz qualquer coisa.
alter table restaurant_users drop column role;
