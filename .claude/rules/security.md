# Regras: Segurança

Regras **obrigatórias** para todo código da API (`apps/api`). Complementam `.claude/rules/database.md` (soft delete, SQL) e `.claude/rules/fastify.md` (schemas, logging).

O projeto já tem autenticação (seção 6); exposição pública ainda não.

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
- **S16 — Os limites são explícitos, e ficam em `src/limits.ts`.** `bodyLimit`, `keepAliveTimeout`, `connectionTimeout` e os tetos de rate limit já saíram do default (F27). Ao mexer em qualquer um, mexa lá e mantenha o porquê ao lado do número.

- **S24 — `TRUST_PROXY` tem que casar com a topologia real.** `false` atrás de um proxy faz todo cliente aparecer com o IP do proxy, e qualquer limite por IP vira teto compartilhado. `true` com a app exposta direto deixa qualquer um forjar o `X-Forwarded-For`. Os dois erros são silenciosos, então a variável é decisão de deploy, nunca default esperto.

- **S25 — Rota anônima e cara precisa de teto próprio.** O `/auth/login` é o caso: bcrypt custa centenas de milissegundos de propósito, e a defesa contra oráculo de timing faz e-mail inventado custar o mesmo que legítimo. Teto por IP, nunca por e-mail — por e-mail vira uma forma de trancar o dono da conta para fora.

- **S26 — CORS falha fechado.** `CORS_ORIGINS` vazio não libera ninguém. Nunca use `*`: a criação de pedido é pública, então `*` deixaria qualquer site fazer pedido em nome de quem o visita. E o CORS é registrado antes do hook de autenticação, porque o preflight `OPTIONS` é anônimo e seria recusado por ele.

## 6. Autenticação e autorização

Existe desde o commit que adicionou `restaurant_users` e `sessions`. As regras abaixo descrevem o que está no código — mudar qualquer uma delas é decisão consciente, não refatoração.

- **S17 — Fechado por padrão.** O hook `onRequest` de `routes/authenticate.ts` exige sessão em **toda** rota; pública é quem declara `config: { public: true }`. Nunca inverta isso para uma lista de rotas protegidas: com opt-in, esquecer uma linha expõe a rota em silêncio; com opt-out, o mesmo esquecimento a fecha e aparece no primeiro teste. `test/authorization.test.ts` lê a árvore de rotas do Fastify e exige 401 de tudo que não esteja na lista de públicas.

- **S18 — Toda rota escopada em restaurante chama o parâmetro de `restaurantId`.** É esse nome que o hook procura para comparar com a sessão. Uma rota que o chamasse de `id` ficaria autenticada mas **não** escopada — uma sessão operando sobre outro restaurante, sem erro nenhum.

- **S19 — Acesso a recurso de outro dono é 404, não 403.** "Proibido" confirma que o recurso existe. Do lado de fora, restaurante dos outros tem que ser indistinguível de restaurante que não existe.

- **S20 — Senha em bcrypt** (nunca hash próprio, nunca SHA puro). E o bcrypt **ignora tudo depois do byte 72, em silêncio**: duas senhas que só diferem do byte 73 conferem como iguais. `maxLength` do JSON Schema conta caracteres, não bytes (40 letras "ç" = 80 bytes), então o limite é checado com `Buffer.byteLength` no serviço.

- **S21 — Token de sessão é aleatório e o banco só guarda o hash.** SHA-256 puro é correto para o token — 256 bits sorteados não têm dicionário — e continua proibido para senha. O token viaja em `Authorization: Bearer`, nunca na URL (que vai para log de proxy, histórico e `Referer`), e o `logger.redact` do `app.ts` cobre o header.

- **S22 — Falha de login é sempre a mesma resposta, no mesmo tempo.** Mensagem única para e-mail inexistente e senha errada, e o bcrypt roda mesmo sem usuário (contra um hash descartável): sem isso, o tempo de resposta diz quais e-mails estão cadastrados.

- **S27 — Credencial em URL é sempre token descartável, nunca identificador.** O acompanhamento do pedido é por WebSocket, e navegador não manda header no handshake — a credencial vai na querystring, que entra em log de acesso, de proxy e no histórico. Por isso o `trackingToken` existe em vez de o UUID do pedido fazer esse papel: um token dá para revogar e expirar, e **não existe** onde não deve haver acesso (pedido de salão não recebe token). Segredo que também é identificador não tem como ser revogado.

- **S28 — Autorização de rota WebSocket vai em `preHandler`, não em `preValidation`.** Os dois rodam antes do upgrade, mas `preValidation` roda **antes** da validação do schema: um parâmetro obrigatório ainda pode ser `undefined` ali, e o que deveria ser 400 vira 500. Só use `preValidation` para credencial que não passa por schema (header).

- **S29 — Ordenação e filtro dinâmicos passam por allowlist, sempre.** É o S3 aplicado onde ele mais aparece: `?sort=` e `?order=` da listagem de pedidos. `order by` não aceita `$n` (nome de coluna é identificador, não valor), então o que protege não é o driver — é o mapa fixo campo→coluna no repositório, mais um ternário para a direção. Validar por `enum` no JSON Schema é a primeira barreira, não a última: interpolar a string recebida deixaria a proteção dependendo de um schema que alguém pode afrouxar depois.

- **S23 — Autorização é checada no banco, na mesma query** (`where id = $1 and restaurant_id = $2`, como as rotas de produto já fazem) — nunca só no cliente, nunca só no hook.

- **S30 — Toda conta precisa de caminho de volta.** O projeto passou um tempo com um buraco sério: o restaurante tinha exatamente um login (criado no `/auth/register`), nenhuma rota de troca de senha e nenhuma de recuperação. Quem esquecesse a senha **perdia o restaurante** — o único conserto era `UPDATE` na mão no banco. Hoje existem `POST /auth/change-password`, o CRUD de usuários e, para quem não tem sessão nenhuma para provar quem é, `POST /auth/forgot-password`/`POST /auth/reset-password`: um token de uso único, válido por uma hora, com só o **hash** dele no banco (a mesma decisão de S21). `/auth/forgot-password` sempre responde 202 e faz o trabalho (achar o usuário, criar o token, mandar o e-mail) **depois** de responder — mesmo corpo não bastaria sozinho se o tempo de resposta ainda denunciasse qual e-mail existe, e falha de envio vai só para o log, nunca para o cliente. `/auth/reset-password` revoga **todas** as sessões do usuário (aqui não há sessão atual a poupar, diferente do S31) e não devolve sessão — quem recuperou entra por `/auth/login`, provando que conhece a senha nova. O driver de e-mail de console (dev e teste, sem provedor nenhum) é recusado em produção com erro de inicialização: ele escreve o link no log, e o link é o próprio token — exatamente o que o S13 proíbe. Ao mexer em autenticação, continue perguntando "e se a pessoa perder a credencial?" antes de considerar o fluxo pronto — foi essa pergunta não feita a tempo que deixou este projeto descumprindo a própria regra por várias PRs.

- **S31 — Trocar a senha exige a senha atual, e revoga as outras sessões.** A senha atual é exigida mesmo já havendo sessão válida: sem isso, um token roubado trocaria a senha e trancaria o dono para fora da própria conta — o pior resultado possível de um vazamento. E a troca revoga as demais sessões (poupando a atual, para não deslogar quem acabou de trocar): trocar senha é o que se faz ao desconfiar de vazamento, e sessões antigas ainda válidas esvaziariam o gesto. É para isso que a sessão mora no banco — revogar é apagar linhas.

- **S32 — Papel restringe só o que é destrutivo, e o padrão é o menos poderoso.** `restaurant_users.role` é `owner` ou `staff`, e a checagem (`config: { ownerOnly: true }`, no mesmo hook da autenticação) vale em duas ações: remover o restaurante e administrar usuários. Usuário criado sem papel informado nasce `staff` — esquecer o campo não pode dar a alguém o poder de apagar o negócio. **403 aqui, não 404**: o restaurante É o da sessão, então a existência já é conhecida e esconder mandaria quem está no painel procurar o problema no lugar errado. O 404 do S19 continua valendo para restaurante alheio.

  São **duas** as situações do projeto em que 403 é a resposta certa, e a segunda é a loja que ainda não provou o e-mail (`restaurants.email_verified_at`, conferido no mesmo hook): a razão é a mesma — a sessão é válida e o restaurante É o da sessão, então o que falta é permissão, não existência. A diferença entre as duas é o padrão: o `ownerOnly` restringe só o que é destrutivo e por isso **abre** por padrão; a verificação **fecha** por padrão, como o `public`, e vale para toda rota escopada em `:restaurantId` — rota nova nasce bloqueada, e esquecer uma linha fecha em vez de abrir. Do lado do cliente a mesma loja responde **404** em tudo (cardápio, cotação e criação de pedido): ali ela precisa ser indistinguível de uma loja que não existe, e 403 entregaria que o slug está ocupado. ⚠️ A ordem dentro do hook é escopo primeiro, verificação depois — invertida, uma sessão descobriria o restaurante de outra pessoa só por receber 403 em vez de 404. E o bloqueio tem caminho de volta, como o S30 exige: o login, o `GET /auth/me` e o `POST /auth/resend-verification` funcionam com a loja bloqueada — sem isso, quem nunca recebeu o e-mail ficaria trancado para fora de um jeito novo, que é exatamente o buraco que a verificação foi fechar.

Ainda **não** existe, e ao implementar vale desde o primeiro commit: **permissão por ação**, mais fina que os dois papéis de hoje.
