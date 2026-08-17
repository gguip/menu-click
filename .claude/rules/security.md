# Regras: Segurança

Regras **obrigatórias** para todo código da API (`apps/api`). Complementam `.claude/rules/database.md` (soft delete, SQL) e `.claude/rules/fastify.md` (schemas, logging).

O projeto ainda não tem autenticação nem exposição pública — mas as decisões abaixo são baratas agora e caras depois.

## 1. SQL injection

- **S1 — Todo valor vindo do cliente vai como parâmetro (`$1`, `$2`, ...), sempre.** O driver manda valor e comando separados, então o texto nunca é lido como SQL. Verificado neste projeto: `where name = $1` com o payload `'; drop table products; --` faz uma busca literal por essa string e não apaga nada.

- **S2 — Nunca concatene ou interpole valor na string SQL.** Além do óbvio, tem um agravante concreto: query **sem** parâmetro usa o protocolo simples do Postgres, que **aceita vários comandos separados por `;`** — é o que permite uma migration ou o `seed.sql` rodarem inteiros de uma vez. Ou seja, numa query concatenada, um `; drop table ...` no meio do input **executa**. Com parâmetro o Postgres recusa (`cannot insert multiple commands into a prepared statement`), e essa recusa é a sua rede de proteção. Concatenar joga a rede fora.

  ```ts
  // ❌ nunca
  await pool.query(`select * from restaurants where city = '${city}'`);
  // ✅ sempre
  await pool.query("select * from restaurants where city = $1", [city]);
  ```

- **S3 — `$n` só serve para VALOR, não para identificador.** Nome de tabela/coluna, `asc`/`desc` e `order by` dinâmico não podem ser parametrizados — e é justamente aí que a injection costuma entrar (`?sort=`, `?orderBy=`). Resolva com **allowlist**: um mapa fixo no código traduz o que o cliente pede para o identificador real, e o que não estiver no mapa é rejeitado ou ignorado.

  ```ts
  const sortable = { name: "name", createdAt: "created_at" } as const;
  // se não estiver no mapa, cai no padrão — nunca no input cru
  const column = sortable[request.query.sort as keyof typeof sortable] ?? "created_at";
  const direction = request.query.order === "desc" ? "desc" : "asc"; // ternário, não input
  ```

  É o mesmo padrão do `SET` dinâmico do `update()` em `repositories/restaurants.ts`: **itere o mapa de colunas, nunca as chaves do body**. Se um dia precisar mesmo de identificador dinâmico de verdade, use `escapeIdentifier` do próprio `pg` — nunca aspas montadas à mão.

- **S4 — Lista `IN` vira array parametrizado.** Não monte `in (${ids.join(",")})`. Use um parâmetro só:

  ```ts
  await pool.query("select * from restaurants where id = any($1::uuid[])", [ids]);
  ```

- **S5 — Em busca com `LIKE`/`ILIKE`, escape os curingas do input.** `%` e `_` vindos do cliente não são injection, mas transformam "buscar por `%`" numa varredura da tabela inteira. Escape antes de interpolar no padrão (e mantenha o padrão como parâmetro).

- **S6 — Só execute SQL multi-statement a partir de arquivo do repositório.** `pool.query(textoInteiro)` sem parâmetros é permitido apenas para arquivos versionados — as migrations e o `seed.sql` (ver `db/seed.ts`). Nunca com string que passou perto de entrada do usuário.

## 2. Entrada: valide e não confie no shape

- **S7 — Toda rota com input declara `schema` com `additionalProperties: false`** (F9). Sem isso o cliente manda campo extra e você descobre quando ele chegar no banco.
- **S8 — Nada de mass assignment.** Nunca espalhe `...request.body` direto para dentro de um `INSERT`/`UPDATE` ou de um objeto que será persistido: campos como `id`, `createdAt` e (amanhã) `role` ou `restaurantId` viriam junto. Monte a query campo a campo, a partir do mapa fixo de colunas.
- **S9 — Valide o formato antes de consultar.** `isUuid()` antes de qualquer query por id: além de manter o 404 correto, evita transformar lixo do cliente em erro 500 e em ruído no log.

## 3. Saída: não vaze o que não foi pedido

- **S10 — `schema.response` por status code é obrigatório** (F10) e é uma regra de **segurança**, não só de performance: o `fast-json-stringify` só serializa os campos declarados. É o que impede uma coluna nova de vazar sozinha — hoje seria `deleted_at`, amanhã `password_hash`. Ao adicionar coluna, **não** a acrescente ao response schema por reflexo.
- **S11 — Resposta 5xx nunca carrega detalhe interno.** Mensagem do Postgres (que entrega nome de tabela, de coluna e constraint), stack e caminho de arquivo vão **só para o log**. O cliente recebe uma mensagem genérica. Isso está centralizado no `setErrorHandler()` do `app.ts` — não contorne mandando `error.message` direto de dentro de uma rota. É o mesmo handler que traduz os erros de negócio (`NotFoundError` → 404, `ConflictError` → 409): a mensagem deles é escrita pelo serviço para o cliente ler, então nunca carregue detalhe do Postgres dentro dela.

## 4. Segredos

- **S12 — `.env` nunca é commitado** (já está no `.gitignore`). O `.env.example` só carrega placeholder — nunca senha real, nem "só de dev".
- **S13 — Nunca logue segredo** (F20): senha, token, cartão, e **a connection string** (o `DATABASE_URL` tem a senha dentro). Não logue o objeto de configuração do pool.
- **S14 — Em produção, role dedicada com o mínimo de privilégio** — não o superusuário `postgres` (que é o que usamos em dev). E aproveite o soft delete: se a role da aplicação não tem `DELETE` nem `TRUNCATE` (`revoke delete on all tables in schema public from app_role`), um `delete from` esquecido no código falha no banco em vez de apagar dado de cliente. É a única defesa que não depende de alguém lembrar da regra.

## 5. Exposição

- **S15 — TLS termina no proxy** (F24); a app nunca fica direto na internet. Para banco gerenciado, exija TLS na conexão (`?sslmode=require` no `DATABASE_URL`).
- **S16 — Antes de abrir para a internet:** revise `bodyLimit`/`connectionTimeout` (F27) e adicione rate limit. Sem isso, qualquer um mantém o pool ocupado com requisições grandes.

## 6. Quando entrar autenticação

Nada disso existe ainda; ao implementar, valem desde o primeiro commit: senha com **argon2id** ou **bcrypt** (nunca hash próprio, nunca SHA puro); token/sessão fora do log e fora da URL; comparação de segredo com `crypto.timingSafeEqual`; e **autorização checada no banco, na mesma query** (`where id = $1 and restaurant_id = $2`, como as rotas de produto já fazem) — nunca só no cliente.
