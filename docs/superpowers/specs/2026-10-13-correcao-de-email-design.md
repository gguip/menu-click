# Correção do e-mail no cadastro não verificado — desenho

Data: 2026-10-13

## O problema

Quem se cadastra com o endereço errado — o `joao@gmial.com` que a spec da
verificação de e-mail já levantava — não tem saída pela API. O reenvio vai para
o mesmo endereço errado, não existe rota de troca de e-mail, e o `DELETE` do
próprio restaurante responde 403 como qualquer rota escopada. Sobra esperar os
7 dias da liberação de cadastro abandonado e se cadastrar de novo, ou
recadastrar antes com sufixo aleatório no slug, que é a URL do QR code.

O `CLAUDE.md` e o S30/S32 de `.claude/rules/security.md` registram isso como
pergunta de produto em aberto. A tela bloqueada do painel
(`EmailBlockedPage.tsx`) diz ao dono, com todas as letras, que não há botão.

## O que foi decidido

Decisões tomadas com o dono do projeto:

1. **Duas fases.** Esta spec cobre só a **loja não verificada** (fase A). A
   troca de e-mail em conta verificada, e a de `staff`, é a fase B, com spec
   própria.
2. **O relógio de abandono não muda.** Os 7 dias continuam contando do
   `restaurants.created_at`. Corrigir o e-mail não reinicia o prazo.
3. **Uma rota nova, `POST /auth/change-email`**, autenticada e fora do gate de
   verificação.
4. **A correção acontece na própria tela bloqueada**, sem tela nova.

Suposições, não perguntadas e assumidas aqui:

- A troca vale na hora, sem confirmação prévia no endereço novo. Ver "Por que
  é seguro trocar na hora".
- Não há limite de quantas vezes a loja corrige o e-mail, além do teto por
  minuto.
- O endereço antigo não recebe aviso.

## Por que é seguro trocar na hora

A troca de e-mail ficou fora de escopo na verificação por um motivo: sem
confirmar no endereço novo antes, ela vira um jeito de sequestrar conta. Esse
risco não existe na loja não verificada, por três razões que já estão no
código:

- **A conta está vazia.** Loja não verificada tem zero linha em toda tabela com
  `restaurant_id`, e exatamente um usuário, o dono. Essa garantia está presa
  por teste. Não há dado a roubar.
- **A verificação que vem depois é a confirmação.** O link novo vai para o
  endereço novo, e a loja só destrava quando ele for aberto. Um endereço que a
  pessoa não controla deixa a loja exatamente onde estava: bloqueada.
- **A rota exige a senha atual.** Uma sessão roubada, sozinha, não troca nada.

Em conta verificada nenhuma das duas primeiras vale, e por isso a fase B
precisa de troca pendente com confirmação.

## Abordagens consideradas

| Abordagem | Por que não |
| --- | --- |
| **`POST /auth/change-email`, autenticada, sem `:restaurantId`** | Escolhida |
| `PATCH /restaurants/:restaurantId/users/:id` | O gate responde 403 antes de a rota rodar. Abrir exceção no hook furaria a garantia de que loja bloqueada não escreve nada pelas rotas escopadas |
| Rota pública com e-mail antigo, senha e e-mail novo | Segunda rota anônima com bcrypt. Desnecessária: o login já funciona sem verificação |

A rota escolhida escapa do gate pelo mesmo motivo do
`POST /auth/resend-verification`: o gate chaveia pelo parâmetro `:restaurantId`
da URL, e ela não o tem. O nome é o da operação geral de propósito: na fase B a
mesma rota passa a atender conta verificada, trocando o 409 de hoje pelo fluxo
com confirmação.

## API

### Contrato

`POST /auth/change-email`, com sessão.

Corpo, com `additionalProperties: false`:

```json
{ "currentPassword": "…", "newEmail": "joao@gmail.com" }
```

- `newEmail`: `format: "email"`, com os mesmos limites do e-mail do cadastro.
- `currentPassword`: os mesmos limites do `change-password`.

Sucesso: **204**, sem corpo, como o `change-password`.

| Situação | Status | Mensagem |
| --- | --- | --- |
| Loja já verificada | 409 | A troca de e-mail de uma conta já verificada ainda não está disponível |
| Senha atual incorreta | 401 | a mesma do `change-password` |
| `newEmail` igual ao atual | 409 | Este já é o e-mail cadastrado |
| `newEmail` de outra conta viva | 409 | a mesma do cadastro: `O e-mail "…" já está cadastrado` |
| Teto estourado | 429 | com `Retry-After` |

O 409 de e-mail ocupado não cria oráculo novo: `POST /auth/register`, que é
público, já responde a mesma coisa para o mesmo endereço.

A rota declara `tags`, `summary`, `description` e `operationId`, e o
`openapi.json` é regerado.

### Ordem das checagens no serviço

`changeEmail(auth, input)` em `services/auth.ts`:

1. **Loja verificada → `ConflictError`.** Lido de `auth.emailVerified`, sem ida
   ao banco. Vem antes da senha porque não revela nada: a loja é a da sessão.
2. **Senha atual.** `findByIdWithHash` e `bcrypt.compare`. Errada →
   `UnauthorizedError`.
3. **Mesmo e-mail → `ConflictError`.** A comparação segue a normalização que o
   cadastro já aplica; esta feature não muda regra de caixa.
4. **Transação única** (`withTransaction`), detalhada abaixo.
5. **Depois da resposta**, o token novo e o envio do link, em segundo plano.
   Ver "Depois da resposta".

### A transação

Tudo com o `client`, na mesma transação (D3):

1. **`update restaurant_users set email = $1, updated_at = now()`** no usuário
   da sessão, filtrando `deleted_at is null`. A colisão é detectada pelo índice
   único parcial `restaurant_users_email_active_key`, nunca por `select` antes.
   Cada tentativa ganha o seu **savepoint**: um comando que falha aborta o
   bloco inteiro, e a query seguinte estouraria `current transaction is
   aborted`. É o mesmo cuidado do `tryInsertUser`.
2. **Colisão com cadastro abandonado.** Se o endereço novo está preso por um
   cadastro não verificado com mais de 7 dias,
   `restaurantsService.releaseAbandonedRegistration` o libera e a troca tenta
   de novo. É a mesma regra do `register`, pela mesma função. Colisão com conta
   viva → `ConflictError`, e o rollback desfaz qualquer liberação.
3. **Tokens de verificação vivos do usuário são invalidados**
   (`emailVerificationRepository.softDeleteLiveForUser`). O link antigo foi
   para o endereço errado e não pode destravar a loja. O token novo **não**
   nasce aqui: ver "Depois da resposta".
4. **Tokens de recuperação de senha vivos do usuário são invalidados**
   (`passwordResetRepository.softDeleteLiveForUser`). Um link de recuperação
   pedido antes da correção está na caixa de entrada de um estranho, e ele abre
   a conta.
5. **As demais sessões do usuário são revogadas, poupando a atual**, como no
   `change-password` (S31).

O repositório `restaurant-users.ts` ganha `updateEmail(id, email, db)`, que
devolve `null` na violação de unicidade, no mesmo formato do `insert`.

### Depois da resposta

A rota responde 204 e só então chama `sendEmailVerification(user)` dentro de
`track()`, sem `await` — a mesma função e o mesmo caminho do cadastro. Ela cria
o token e manda o e-mail para o endereço novo. SMTP é rede e não pode segurar a
requisição nem uma conexão do pool.

Se a criação do token ou o envio falharem, a troca já valeu e o erro vai só
para o log. A loja fica sem link vivo, e o botão "Não recebi, reenviar" resolve:
ele agora manda para o endereço novo.

### Limite

Teto próprio **por usuário**, como o reenvio: cada chamada roda bcrypt e manda
um e-mail de verdade. A chave é `request.auth?.userId ?? request.ip`. O número
fica em `src/limits.ts` com o porquê ao lado: **3 por minuto**, o mesmo do
reenvio. Por IP, duas lojas atrás do mesmo CGNAT dividiriam o teto.

### O que a rota não faz

- **Não confere papel.** Loja não verificada tem exatamente um usuário, o dono.
  Na fase B, quando a rota atender conta verificada, a pergunta do papel volta.
- **Não entra na lista de rotas públicas.** Exige sessão.
- **Não muda o relógio de abandono.**
- **Não avisa o endereço antigo.** Ele nunca foi provado e pode ser de um
  terceiro.

### O conjunto das rotas fora do gate

As rotas autenticadas que escapam do gate passam de cinco para seis. A premissa
que protege a limpeza de cadastro abandonado continua valendo: a rota nova
escreve só na conta de quem chama (o e-mail do usuário, os tokens dele e as
sessões dele), e não cria filho de restaurante.

## Painel

Só a `EmailBlockedPage.tsx` muda.

- O bloco "O endereço está errado?" deixa de dizer que não há saída e ganha um
  formulário: campo **"E-mail correto"**, campo **"Senha atual"** e o botão
  **"Corrigir e-mail"**.
- No sucesso, a query do `useMe` é invalidada: o card "Endereço cadastrado"
  passa a mostrar o endereço novo, o formulário é limpo, e a tela diz
  "E-mail corrigido. Enviamos o link de confirmação para o endereço novo."
- `changeEmail(currentPassword, newEmail)` em `api/auth.ts` passa
  `expireOn401: false`. O 401 desta rota é senha errada, não sessão expirada: é
  a mesma armadilha do `changePassword`, e sem a marca errar a senha deslogaria
  a pessoa.
- Erros ficam como texto na própria tela: 401 "Senha atual incorreta", 409 com
  a mensagem da API, e 429 travando o botão com a contagem regressiva do
  `useCountdown`, como no reenvio.
- "Falar com o suporte" e "Sair da conta" continuam onde estão.
- Sem dependência nova. Os campos seguem o padrão dos formulários de acesso.

O texto novo é desvio do handoff, e entra na tabela "Onde este desenho diverge
do handoff" da spec da parte 1 do painel.

## Testes

### API — `test/change-email.test.ts`

Integração de verdade, um `describe` de topo:

- Caminho feliz: 204, o login com o e-mail novo funciona e com o antigo
  responde 401.
- O token de verificação antigo deixa de valer; o novo verifica e libera a
  loja.
- Um token de recuperação de senha vivo deixa de valer depois da troca.
- As outras sessões caem; a sessão que fez a troca continua viva.
- 409 para loja verificada, 401 para senha errada, 409 para o mesmo e-mail e
  409 para e-mail de conta viva.
- E-mail preso por cadastro abandonado com mais de 7 dias: o cadastro antigo é
  liberado e a troca acontece.
- E-mail preso por cadastro não verificado **com menos de 7 dias**: 409, e nada
  é liberado.
- A colisão dentro da transação responde 409, não 500 (o savepoint).
- 429 por usuário: dois usuários no mesmo IP não dividem o teto.
- Depois da troca, a loja continua bloqueada (403 nas rotas escopadas) e com
  zero linha nas tabelas filhas.

`test/authorization.test.ts` e `test/openapi.test.ts` cobrem a rota sem mudança
nas listas: ela exige sessão e declara os quatro campos de documentação.

### Painel — `test/email-blocked.test.tsx`

- Enviar o formulário chama a rota com os dois campos, e a tela passa a mostrar
  o endereço novo.
- 401 mostra "Senha atual incorreta" e não encerra a sessão.
- 429 trava o botão com a contagem.

## Documentação

- `CLAUDE.md`, seção de acesso: o caso do endereço errado deixa de ser "sem
  saída pela API"; a lista das rotas fora do gate ganha a sexta; a seção de
  limites ganha o segundo teto por usuário.
- `.claude/rules/security.md`: o S30 e o S32 deixam de registrar o buraco como
  aberto para a loja não verificada, e passam a registrar o que sobra — a troca
  em conta verificada.
- A tabela de divergências do handoff, na spec da parte 1 do painel.

## Arquivos tocados

| Arquivo | Mudança |
| --- | --- |
| `apps/api/src/routes/auth.ts` | a rota e o schema |
| `apps/api/src/services/auth.ts` | `changeEmail` |
| `apps/api/src/repositories/restaurant-users.ts` | `updateEmail` |
| `apps/api/src/limits.ts` | o teto por usuário |
| `apps/api/openapi.json` | regerado |
| `apps/api/test/change-email.test.ts` | novo |
| `apps/panel/src/api/auth.ts` | `changeEmail` |
| `apps/panel/src/features/access/EmailBlockedPage.tsx` | o formulário |
| `apps/panel/test/email-blocked.test.tsx` | os casos novos |
| `CLAUDE.md`, `.claude/rules/security.md` | documentação |

Nenhuma migration e nenhuma dependência nova.

## Fora de escopo, de propósito

- **Troca de e-mail em conta verificada, e de `staff`** — fase B: troca
  pendente, confirmação no endereço novo e aviso ao antigo.
- **Reiniciar o relógio de abandono** — decidido acima. O custo assumido: quem
  corrige depois do sétimo dia pode perder o cadastro se alguém colidir com o
  slug ou com o e-mail antes de o link novo ser aberto.
- **Limite de quantas correções uma loja faz** — só o teto por minuto.
- **Editar o papel de um usuário** (`PATCH .../users/:id`) — outra pendência,
  sem relação com esta.
