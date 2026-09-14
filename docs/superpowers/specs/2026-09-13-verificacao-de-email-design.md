# Verificação de e-mail — desenho

**Data:** 2026-09-13 · **Estado:** proposta, aguardando revisão

## O problema

Hoje qualquer um se cadastra com qualquer endereço, e ninguém prova nada. Dois
danos, e o segundo é o que dói.

**Alguém pode cadastrar com o e-mail de outra pessoa.** O endereço fica ocupado
sem que o dono dele tenha pedido nada.

**E, pior, o erro de digitação.** Quem se cadastra como `joao@gmial.com` não
percebe, opera normalmente, e no dia em que esquecer a senha o link de
recuperação vai para um endereço que não existe. A pessoa fica trancada para
fora **exatamente pelo buraco que a PR #15 fechou** — só que agora sem saída
nenhuma, porque não há como provar quem ela é.

A recuperação de senha que acabamos de construir **só funciona se o e-mail for
real**. Construímos um caminho de volta que depende de um endereço que ninguém
nunca verificou.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Quem precisa verificar | **cadastro novo**; quem já existe nasce verificado |
| O que uma loja não verificada pode fazer | **nada** — nem operar, nem aparecer |
| Loja não verificada no lado do cliente | **some do ar**: cardápio, cotação e pedido respondem 404 |
| No painel | **403**, com mensagem dizendo o que falta |
| Validade do token | 24 horas, uso único |
| Cadastro abandonado | libera slug e e-mail na colisão seguinte |

## Arquitetura

### A coluna vai no RESTAURANTE, não no usuário

`restaurants.email_verified_at` — nulo é "não verificou".

A pergunta natural seria pôr a marca no usuário, já que é a pessoa que prova o
endereço. Mas quem fica bloqueado e invisível é a **loja**, e essa diferença
decide o desenho: com a marca no usuário, o hook precisaria descobrir se o DONO
verificou — não o usuário da sessão —, e um `staff` convidado ficaria bloqueado
por não ter verificado nada. Pior, o `getBySlug` do cardápio público passaria a
juntar com `restaurant_users` no caminho mais quente da API.

Com a coluna no restaurante, o hook lê o que já tem em mãos e o filtro público
é uma condição a mais na consulta que já existe.

**A regra é: o restaurante fica verificado quando QUALQUER usuário dele verifica
o próprio endereço.** Na prática isso significa o dono, e não por convenção — é
consequência: convidar usuário é rota escopada em restaurante, logo bloqueada,
logo o único usuário que existe no cadastro novo é o dono. O ovo e a galinha se
resolvem sozinhos.

O token aponta para o **usuário**, porque é a caixa de entrada dele que prova
algo; verificar marca o restaurante.

⚠️ **A migration marca como verificado todo restaurante que já está no banco.** É o default
sendo o backfill, como na taxa de entrega — ninguém muda de comportamento no
deploy, e não há migration de correção depois. A exigência vale só para
cadastro novo.

### A tabela espelha `password_reset_tokens`

```sql
create table email_verification_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  restaurant_user_id uuid        not null references restaurant_users (id),
  -- sha256 hex, nunca o token: a mesma decisão de `sessions`, do
  -- `trackingToken` e da recuperação de senha
  token_hash         text        not null,
  expires_at         timestamptz not null,
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
```

**24 horas, e não uma hora como a recuperação.** O perfil de risco é outro: um
token de recuperação vazado dá acesso a uma conta que existe e tem dado dentro;
um de verificação só destrava uma conta vazia, cuja senha o atacante continua
não tendo. Uma hora obrigaria a reenviar quem lê e-mail depois do almoço, e
isso é atrito sem contrapartida.

### Duas rotas

```
POST /auth/verify-email        { token }   -> 200    (pública)
POST /auth/resend-verification { }         -> 202    (exige sessão)
```

O reenvio manda para o **próprio endereço de quem chama**, não para o do dono —
não há ambiguidade porque, pelo parágrafo acima, quem consegue chamar isto num
restaurante não verificado é sempre o dono.

**O reenvio não é conveniência, é parte do desenho.** Se o envio falhar no
cadastro — SMTP fora do ar naquele minuto —, a loja fica com a conta criada e
nenhum caminho para dentro. É o mesmo raciocínio do S30 que motivou a
recuperação: uma verificação sem reenvio fecha um buraco e abre outro.

Por isso **o login funciona sem verificação**. É o que permite a pessoa chegar
até o botão de reenviar.

### O que fica bloqueado, e o que não fica

A checagem mora no **mesmo hook** que já resolve sessão, escopo e papel
(`routes/authenticate.ts`) — ele já tem o usuário em mãos, então não custa ida
a mais ao banco.

**Bloqueia toda rota escopada em restaurante, por padrão.** Rota nova nasce
bloqueada, pelo mesmo raciocínio do `public`: esquecer uma linha fecha em vez
de abrir, e os dois erros não custam a mesma coisa.

Ficam de fora, por necessidade lógica:

| Rota | Por quê |
| --- | --- |
| `POST /auth/login` | é como se chega até a mensagem |
| `POST /auth/logout` | sair sempre funciona |
| `GET /auth/me` | o painel precisa do estado para mostrar o que falta |
| `POST /auth/change-password` | higiene de conta, não operação de loja |
| `POST /auth/resend-verification` | seria circular |
| `POST /auth/forgot-password` e `/auth/reset-password` | quem esqueceu a senha não consegue logar para verificar |

**403 e não 404.** É a segunda situação do projeto em que 403 é o certo, pela
mesma razão do `ownerOnly` (S32): a sessão é válida e o restaurante É o da
sessão — esconder mandaria quem está no painel procurar o problema no lugar
errado.

### No lado do cliente, a loja não existe

`findBySlug` passa a filtrar não verificado **do mesmo jeito que já filtra
removido** — e disso o cardápio e a cotação de frete herdam.

⚠️ **A criação de pedido NÃO herda, e a diferença é real.** Ela resolve o
restaurante por `getById` (pelo id da rota, não pelo slug), e `getById` também
serve mais de vinte caminhos de painel. Filtrar lá dentro mudaria o significado
de todos eles — inofensivo hoje só porque o hook bloqueia antes, o que é
raciocínio frágil demais para virar desenho. Então a criação ganha um **assert
próprio**, ao lado das outras recusas públicas de pedido. São dois lugares, e
está escrito para ninguém "consolidar" os dois num filtro só e quebrar o painel.

**404, não 403.** Do lado de fora, uma loja que ainda não provou o e-mail tem
que ser indistinguível de uma que não existe. 403 diria "existe, mas não
verificou", entregando que o slug está ocupado.

⚠️ Uma consequência boa da decisão: **não existe pedido de loja não
verificada**, porque ela nunca recebeu nenhum. Então não há recibo órfão para o
cliente, que era a borda mais feia — matar o recibo de quem já pediu deixaria a
pessoa sem nada.

### Cadastro abandonado libera slug e e-mail

Quem se cadastra e nunca verifica segura duas coisas escassas: o slug e o
e-mail. Hoje isso já acontece com cadastro abandonado; a verificação torna o
abandono mais provável, porque cria um passo a mais onde desistir.

O dano prático é mudo. A segunda "Pizzaria do João" ganha sufixo por causa de
uma primeira que nunca existiu de fato. E — pior — quem não recebeu o e-mail e
tenta se cadastrar de novo com o mesmo endereço bate em "e-mail já usado", sem
caminho nenhum.

**A limpeza é preguiçosa, na colisão.** Ao inserir e colidir, o serviço olha se
quem segura é um cadastro abandonado — não verificado e criado há mais de
**7 dias**. Se for, marca-o como removido — **o restaurante e o usuário dele, na mesma
transação**, porque é o usuário que segura o e-mail — e tenta de novo.

⚠️ **Isso é seguro por uma razão específica, e ela precisa continuar
verdadeira:** um restaurante não verificado está bloqueado de todas as rotas de
gestão, então não tem cardápio, categoria, produto nem pedido. **Apagar um é
apagar uma linha vazia.** Se um dia alguma rota de gestão deixar de exigir
verificação, esta limpeza deixa de ser inofensiva.

**Por que não no índice único:** o Postgres recusa — `functions in index
predicate must be marked IMMUTABLE`, e `now()` não é. Verificado. **Por que não
numa rotina agendada:** o projeto não tem agendador, e trazer um para isto seria
infraestrutura nova para um caso de borda. Na colisão o trabalho acontece
exatamente quando importa, e custa uma consulta a mais só quando há colisão.

## 🚨 Todas as superfícies que isto toca

| Superfície | O que muda |
| --- | --- |
| `POST /auth/register` | dispara o e-mail de verificação; libera cadastro abandonado na colisão |
| `POST /auth/verify-email` | **nova**, pública |
| `POST /auth/resend-verification` | **nova**, exige sessão e funciona não verificado |
| `GET /auth/me` | passa a dizer se o restaurante está verificado |
| `routes/authenticate.ts` | o hook ganha a terceira checagem |
| `services/restaurants.ts` | `getBySlug` filtra não verificado |
| `GET /menu/:slug` e `/products` | 404 para loja não verificada, por herança do filtro |
| `POST /menu/:slug/delivery-quote` | idem |
| `POST /restaurants/:restaurantId/orders` | idem |
| `test/authorization.test.ts` | a rota pública nova entra na lista |
| `test/openapi.test.ts` | idem |
| `CLAUDE.md` | a tabela de rotas públicas e a seção de acesso |
| `.claude/rules/security.md` | o S32 ganha a segunda situação de 403 |
| `openapi.json` | regerado |

O WebSocket de acompanhamento **não** muda: não existe pedido de loja não
verificada, então não há o que acompanhar.

## Fora de escopo, de propósito

- **Trocar o e-mail de um usuário** — exigiria confirmar no endereço novo antes
  de trocar, senão vira um jeito de sequestrar conta. Continua sem rota.
- **Verificar o e-mail de um `staff` convidado.** Quem destrava a loja é o dono;
  exigir de cada convidado é outro fluxo, com outra pergunta.
- **Expurgo geral de cadastro abandonado.** A limpeza aqui é só a da colisão.
- **Segundo fator**, e **permissão por ação** mais fina que os dois papéis.
