-- Up Migration

-- O fuso do restaurante. Sem ele, "pedidos de hoje" não tem resposta: o dia de
-- um restaurante em Manaus começa uma hora depois do de um em São Paulo, e o
-- painel precisa que "hoje" signifique a mesma coisa para todo mundo que o
-- abre — o dono em casa e o gerente no salão.
--
-- É nome IANA (`America/Sao_Paulo`), não offset fixo (`-03:00`): offset não
-- sabe de horário de verão, e o Brasil já mudou o dele por município. Quem
-- sabe disso é o banco de fusos do sistema, e tanto o Postgres quanto o Node
-- consultam o mesmo.
--
-- O default cobre o banco existente e o cadastro que não informa nada; ele é
-- decisão de produto (o projeto é brasileiro), não um palpite técnico.
alter table restaurants
  add column timezone text not null default 'America/Sao_Paulo';

-- Down Migration

-- Irreversível quanto ao dado: quem tiver escolhido um fuso diferente do
-- default perde a escolha, e um `up` depois deste `down` traz todo mundo de
-- volta para America/Sao_Paulo (verificado). Não há onde guardar — a coluna é o
-- único lugar em que o fuso existe.
alter table restaurants drop column timezone;
