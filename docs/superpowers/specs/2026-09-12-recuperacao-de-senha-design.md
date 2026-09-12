# Recuperação de senha — desenho

**Data:** 2026-09-12 · **Estado:** proposta, aguardando revisão

## O problema

O projeto viola uma regra que ele mesmo escreveu. O **S30** diz:

> **Toda conta precisa de caminho de volta.** (…) ao mexer em autenticação,
> pergunte sempre "e se a pessoa perder a credencial?" antes de considerar o
> fluxo pronto.

E hoje não há. Existe `POST /auth/change-password`, mas ele exige a senha atual
— serve para quem lembra dela. Quem esquece não tem rota nenhuma: o único
conserto é `UPDATE` na mão no banco, por alguém com acesso ao servidor.

Se o último `owner` de um restaurante esquecer a senha, o restaurante é
perdido: cardápio, grupos de opções, histórico de pedidos, tudo. **Não é lacuna
de funcionalidade, é perda de dado** — e é a única regra do projeto que o
próprio projeto descumpre. O `CLAUDE.md` e o `security.md` a registram como
buraco aberto, nos dois lugares.

O motivo de ter sido adiada por várias features é o mesmo desde o começo: exige
serviço de envio de e-mail, que é dependência e infraestrutura novas — e este
projeto trava dependência nova em decisão explícita.

## As decisões que já foram tomadas

| Decisão | Escolha |
| --- | --- |
| Envio | **SMTP via `nodemailer`** — um provedor qualquer, por configuração |
| Em dev e teste | driver de **console**, que escreve o link no log e não envia nada |
| Conteúdo do e-mail | link montado a partir de `PASSWORD_RESET_URL` |
| Validade do token | **1 hora**, uso único |
| Resposta a e-mail inexistente | **idêntica**, e no mesmo tempo |

`nodemailer` foi escolhido em vez de um SDK de provedor por não amarrar o
código a um fornecedor: qualquer serviço que fale SMTP (SES, Resend, Postmark,
até Gmail) entra por variável de ambiente, sem tocar em código.

## Arquitetura

### Duas rotas, ambas públicas

```
POST /auth/forgot-password   { email }                  -> 202
POST /auth/reset-password    { token, newPassword }     -> 200
```

Públicas por definição: quem as chama não consegue entrar. Entram na lista de
`config: { public: true }` e nas duas listas de rota pública que os testes de
garantia leem — `test/authorization.test.ts` e `test/openapi.test.ts`.

### A tabela espelha `sessions`

```sql
create table password_reset_tokens (
  id                 uuid        primary key default gen_random_uuid(),
  restaurant_user_id uuid        not null references restaurant_users (id),
  -- sha256 hex, nunca o token: mesma decisão de `sessions` e do trackingToken
  token_hash         text        not null,
  expires_at         timestamptz not null,
  -- consumido na troca. SEPARADO do deleted_at de propósito (ver abaixo)
  used_at            timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);
```

**O banco guarda o hash, nunca o token.** SHA-256 puro é o certo aqui e pelo
mesmo motivo de `sessions`: o token são bits sorteados, sem dicionário a que
seja vulnerável. Senha continua em bcrypt.

⚠️ **`used_at` e `deleted_at` são fatos diferentes, e por isso são colunas
diferentes.** `used_at` significa "esta recuperação aconteceu"; `deleted_at`
significa "este token foi invalidado sem ser usado" — porque a pessoa pediu
outro, ou porque a senha mudou por outro caminho. Colapsar os dois num só
apagaria justamente a distinção que importa se alguém precisar entender um
acesso indevido depois.

Um token vale quando `deleted_at is null and used_at is null and expires_at >
now()`.

**Pedir uma recuperação nova invalida as anteriores** (soft delete). Sem isso,
três tentativas deixariam três tokens vivos espalhados pela caixa de entrada, e
o mais antigo continuaria servindo por uma hora.

### O que impede enumeração de e-mail

Responder 404 para e-mail inexistente transformaria a rota num oráculo de quais
e-mails estão cadastrados. Por isso **a resposta é sempre 202**, com o mesmo
corpo.

⚠️ **Responder igual não basta: o tempo também entrega.** É o mesmo oráculo que
o `/auth/login` fecha rodando bcrypt contra um hash descartável (S22). Aqui a
saída é diferente e melhor: **a rota responde 202 primeiro e faz o trabalho
depois**. Buscar o usuário, criar o token e enviar o e-mail acontecem fora do
caminho da resposta, então o tempo de resposta não depende de o usuário existir
— e, de quebra, um provedor de SMTP lento deixa de segurar a requisição.

Falha no envio vai para o log (sem o token), nunca para o cliente: contar que o
envio falhou também diria que o e-mail existe.

⚠️ **A busca filtra removidos nos dois níveis.** Usuário com `deleted_at`
preenchido, ou usuário de restaurante removido, **não** recebe token — pelo
mesmo princípio que faz a sessão de um usuário removido morrer sozinha hoje
(a resolução do token junta `restaurant_users` filtrando vivos). Sem isso, a
recuperação viraria o caminho de volta para uma conta que alguém removeu de
propósito.

### A troca revoga TODAS as sessões

`POST /auth/reset-password` valida o token, grava o novo hash bcrypt, marca
`used_at` e chama `revokeAllForUser` **sem exceção**.

A troca comum (`change-password`) poupa a sessão atual, para não deslogar quem
acabou de trocar. Aqui não existe sessão atual — a pessoa está trancada para
fora —, e qualquer sessão viva pertence a quem tem a senha antiga, que é
exatamente de quem se está tomando o acesso de volta.

A senha nova passa pelas mesmas regras do cadastro: bcrypt, e o limite checado
com `Buffer.byteLength`, porque o bcrypt ignora tudo depois do byte 72 em
silêncio (S20).

⚠️ **A troca NÃO devolve sessão.** Quem acabou de recuperar faz login como
qualquer um. Devolver token ali transformaria um e-mail interceptado em acesso
imediato, sem a segunda barreira de precisar usar a senha nova — e a senha nova
é a única coisa que prova que quem trocou é quem vai entrar.

⚠️ **`change-password` passa a invalidar tokens de recuperação pendentes.** É a
outra ponta da mesma regra: se a pessoa lembrou da senha e a trocou, o token que
pediu por engano (ou que alguém pediu por ela) não pode continuar valendo uma
hora. É uma linha no serviço que já existe, e está listada nas superfícies.

### Teto próprio para a rota

`/auth/forgot-password` é anônima e cara: dispara e-mail, que custa dinheiro e
reputação de domínio. É o perfil que o **S25** descreve, e ganha teto por IP
mais apertado que os 100 req/min gerais, com o número e o porquê em
`src/limits.ts`.

Por IP e não por e-mail, pela mesma razão do login: por e-mail viraria uma
forma de impedir que o dono legítimo recupere a conta.

### A porta de e-mail, com dois drivers

`src/email.ts` expõe uma função de envio e nada mais. Dois drivers, escolhidos
por `EMAIL_DRIVER`:

- **`smtp`** — `nodemailer` apontando para `SMTP_URL`. É o de produção.
- **`console`** — escreve o link no log e não envia nada. É o de dev e o dos
  testes: a suíte roda sem rede e sem conta em serviço nenhum.

🚨 **O driver de console é recusado em produção, com erro de inicialização.**
Ele escreve o link no log, e o link **é** o token: rodar com ele em produção
derramaria credencial de troca de senha em log de aplicação, que é precisamente
o que o S13 proíbe. Falhar ao subir é a resposta certa — um aviso seria ignorado
até o dia em que fosse tarde.

Efeito colateral útil, e deliberado: com o driver de console, um operador
consegue ler o link do log e entregá-lo ao dono. Já é melhor que `UPDATE` na
mão no banco, e fecha o buraco operacionalmente antes mesmo de existir provedor
configurado.

### Variáveis novas

| Variável | Para quê |
| --- | --- |
| `EMAIL_DRIVER` | `smtp` ou `console`. Default `console`; `console` em produção **falha** |
| `SMTP_URL` | a conexão do provedor. ⚠️ **carrega senha** |
| `EMAIL_FROM` | o remetente |
| `PASSWORD_RESET_URL` | base do link; o token entra como querystring |

⚠️ **`SMTP_URL` entra no `logger.redact`**, junto do `DATABASE_URL` e pelo mesmo
motivo: tem senha dentro (S13). `.env.example` leva só placeholder (S12).

O token viaja na URL do e-mail, e isso é aceitável pela mesma regra que aceita o
`trackingToken` na querystring (S27): é credencial **descartável**, curta,
revogável e de uso único — nunca um identificador.

## 🚨 Todas as superfícies que isto toca

| Superfície | O que muda |
| --- | --- |
| `POST /auth/forgot-password` | **nova**, pública |
| `POST /auth/reset-password` | **nova**, pública |
| `test/authorization.test.ts` | as duas entram na lista de públicas |
| `test/openapi.test.ts` | idem, na sintaxe do documento |
| `CLAUDE.md` | a lista "Público hoje, e nada além disso" e a seção de acesso |
| `.claude/rules/security.md` | o S30 deixa de descrever um buraco aberto |
| `src/limits.ts` | o teto próprio da rota |
| `app.ts` | `logger.redact` ganha o `SMTP_URL` |
| `services/auth.ts` | `change-password` invalida tokens de recuperação pendentes |
| `.env.example` | as quatro variáveis, com placeholder |
| `openapi.json` | regerado |
| `package.json` | `nodemailer` — a decisão de dependência |

O restante da autenticação **não** muda: `login`, `logout`, `me`,
`change-password` e o hook de sessão ficam como estão.

## Fora de escopo, de propósito

- **Verificação de e-mail no cadastro.** É outro fluxo, com outro token e outra
  pergunta ("este e-mail é seu?" em vez de "você é o dono desta conta?").
- **Segundo fator.** Muda o modelo de autenticação inteiro.
- **Trocar o e-mail de um usuário.** Hoje não existe rota para isso, e criá-la
  sem confirmação no endereço novo abriria um jeito de sequestrar conta.
- **Fila de envio com retentativa.** O envio é o melhor esforço, e a pessoa pode
  pedir de novo. Fila é infraestrutura que este projeto ainda não tem.
- **Permissão por ação**, mais fina que `owner`/`staff` — citada junto no
  `security.md`, mas é outro problema.
